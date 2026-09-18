const { handleReconciliation } = require('./reconciliation');
const { ACCOUNT, StatementError, parseOfx, classifyRows } = require('./itau-ofx');
const READ = 'itau.openfinance.read';
const IMPORT = 'itau.statement.import';
function permitted(profile, permission) {
  return profile?.active === true && profile.status !== 'deleted' && profile.status !== 'blocked' &&
    profile.role === 'admin';
}
function interval(start, end) {
  const valid = value => /^\d{4}-\d{2}-\d{2}$/.test(value || '') && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
  if (!valid(start) || !valid(end) || start > end || (Date.parse(end) - Date.parse(start)) / 86400000 > 92) throw new StatementError('Selecione um período válido de até 93 dias.');
}
function createStatementHandler({ getServices, readBody, sendJson }) {
  return async (request, response) => {
    const url = new URL(request.url, 'http://localhost');
    if (!url.pathname.startsWith('/api/itau/')) return false;
    let userId;
    try {
      const isReconciliation = ['GET', 'POST'].includes(request.method) && url.pathname === '/api/itau/reconciliation';
      const isRead = request.method === 'GET' && url.pathname === '/api/itau/statements';
      const isPreview = request.method === 'POST' && url.pathname === '/api/itau/preview';
      const isCommit = request.method === 'POST' && url.pathname === '/api/itau/import';
      if (!isRead && !isPreview && !isCommit && !isReconciliation) throw new StatementError('Rota não encontrada.', 404);
      const { adminAuth, adminDb: db } = getServices();
      const bearer = String(request.headers.authorization || '').match(/^Bearer (\S+)$/);
      if (!bearer) throw new StatementError('Entre novamente para consultar o extrato.', 401);
      let token;
      try { token = await adminAuth.verifyIdToken(bearer[1], true); } catch { throw new StatementError('Sessão expirada. Entre novamente.', 401); }
      userId = token.uid;
      const profile = await db.collection('users').doc(userId).get();
      const allowed = data => permitted(data, READ) && (isRead || permitted(data, IMPORT));
      if (!profile.exists || !allowed(profile.data())) throw new StatementError('Sem permissão para esta operação na conta Itaú 3145 / 99791-6.', 403);
      const account = db.collection('bankStatements').doc(ACCOUNT);
      const audit = db.collection('bankStatementAudit');
      const actor = { userId, accountId: ACCOUNT, at: new Date().toISOString() };
      if (isReconciliation) {
        if (request.method === 'GET') interval(url.searchParams.get('start'), url.searchParams.get('end'));
        const result = await handleReconciliation({ request, url, db, userId, readBody, allowed, actor });
        sendJson(request, response, 200, result);
      } else if (isRead) {
        const start = url.searchParams.get('start'), end = url.searchParams.get('end');
        interval(start, end);
        const [transactions, imports] = await Promise.all([
          account.collection('entries').where('date', '>=', start).where('date', '<=', end).orderBy('date').limit(1001).get(),
          account.collection('imports').orderBy('importedAt', 'desc').limit(20).get(),
        ]);
        if (transactions.size > 1000) throw new StatementError('Mais de 1.000 movimentações. Reduza o período para visualizar todas.');
        // Recheck immediately before releasing sensitive data, including revocation during a slow query.
        const current = await db.collection('users').doc(userId).get();
        if (!allowed(current.data())) throw new StatementError('Acesso revogado.', 403);
        await audit.add({ ...actor, action: 'read', start, end, count: transactions.size });
        sendJson(request, response, 200, { accountId: ACCOUNT, rows: transactions.docs.map(d => d.data()), imports: imports.docs.map(d => d.data()) });
      } else {
        let body;
        try { body = JSON.parse((await readBody(request)).toString('utf8')); } catch { throw new StatementError('Arquivo inválido ou maior que o limite.'); }
        if (typeof body.base64 !== 'string' || body.base64.length > 2800000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(body.base64)) throw new StatementError('Selecione um arquivo OFX válido de até 2 MB.');
        const statement = parseOfx(Buffer.from(body.base64, 'base64'));
        const fileName = String(body.fileName || 'extrato.ofx').replace(/[\r\n/\\]/g, '_').slice(0, 180);
        const refs = statement.rows.map(row => account.collection('entries').doc(row.id));
        const importRef = account.collection('imports').doc(statement.fileHash);
        if (isPreview) {
          const existing = refs.length ? await db.getAll(...refs) : [];
          const check = classifyRows(statement.rows, existing.map(s => s.exists ? s.data() : null));
          const imported = await importRef.get();
          const current = await db.collection('users').doc(userId).get();
          if (!allowed(current.data())) throw new StatementError('Acesso revogado.', 403);
          await audit.add({ ...actor, action: 'preview', fileHash: statement.fileHash, count: statement.rows.length });
          sendJson(request, response, 200, { ...statement, fileName, alreadyImported: imported.exists, newCount: check.fresh.length, duplicateCount: check.duplicates.length, conflicts: check.conflicts });
        } else {
          if (body.confirmHash !== statement.fileHash) throw new StatementError('Confira a prévia deste arquivo antes de confirmar.');
          const result = await db.runTransaction(async tx => {
            const currentProfile = await tx.get(db.collection('users').doc(userId));
            if (!allowed(currentProfile.data())) throw new StatementError('Acesso revogado.', 403);
            const imported = await tx.get(importRef);
            const snapshots = refs.length ? await tx.getAll(...refs) : [];
            const check = classifyRows(statement.rows, snapshots.map(s => s.exists ? s.data() : null));
            if (check.conflicts.length) throw new StatementError('FITID já importado com conteúdo diferente. Importação bloqueada para revisão.', 409);
            const result = { alreadyImported: imported.exists, inserted: imported.exists ? 0 : check.fresh.length, duplicates: check.duplicates.length };
            if (!imported.exists) {
              check.fresh.forEach(row => tx.create(account.collection('entries').doc(row.id), { ...row, accountId: ACCOUNT, importHash: statement.fileHash, importedAt: actor.at }));
              tx.create(importRef, { fileHash: statement.fileHash, fileName, start: statement.start, end: statement.end, ledgerBalance: statement.ledgerBalance, totals: statement.totals, rowCount: statement.rows.length, inserted: result.inserted, duplicates: result.duplicates, importedAt: actor.at, importedBy: userId });
            }
            tx.create(audit.doc(), { ...actor, action: 'import', fileHash: statement.fileHash, ...result });
            return result;
          });
          sendJson(request, response, 200, result);
        }
      }
    } catch (error) {
      const status = error instanceof StatementError ? error.status : 500;
      // Never log file contents, bank descriptions, tokens or balances.
      if (status === 500) console.error('itau-statement failure', { code: error.code || 'internal' });
      sendJson(request, response, status, { error: status === 500 ? 'Não foi possível concluir a operação. Tente novamente.' : error.message });
    }
    return true;
  };
}
module.exports = { createStatementHandler, permitted, interval };
