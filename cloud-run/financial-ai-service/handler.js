import { analyzeTransactions, businessDate, renderFinancialAnswer } from '../../shared/financialAnalysis.mjs';
import { validateFilters } from './openai-provider.js';

const MAX_SELECTION = 10000;
const MAX_BASE = 20000;
export class FinancialRequestError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
export const activeProfile = profile => profile?.active === true && ['admin', 'operacional'].includes(profile.role) && !['blocked', 'deleted', 'pending'].includes(profile.status);

function validateRequest(body) {
  if (!body || !['filter', 'analysis', 'forecast'].includes(body.mode)) throw new FinancialRequestError('Selecione uma consulta financeira válida.');
  if (typeof body.query !== 'string' || !body.query.trim() || body.query.length > 4000) throw new FinancialRequestError('Informe uma pergunta de até quatro mil caracteres.');
  if (!body.scope || !['all', 'selection'].includes(body.scope.kind)) throw new FinancialRequestError('Selecione toda a base ou os filtros atuais.');
  if (Object.keys(body).some(key => !['mode', 'query', 'scope'].includes(key))) throw new FinancialRequestError('Envie apenas a pergunta e o escopo; os valores são consultados no servidor.');
  if (body.scope.kind === 'selection') {
    const ids = body.scope.transactionIds;
    if (!Array.isArray(ids) || ids.length > MAX_SELECTION || ids.some(id => typeof id !== 'string' || !id || id.length > 300 || id.includes('/')) || new Set(ids).size !== ids.length) throw new FinancialRequestError('Seleção inválida ou acima de dez mil lançamentos. Reduza os filtros.');
  }
  return body;
}

async function readTransactions(db, scope) {
  const collection = db.collection('transactions');
  if (scope.kind === 'all') {
    const snapshot = await collection.limit(MAX_BASE + 1).get();
    if (snapshot.size > MAX_BASE) throw new FinancialRequestError('A base excede vinte mil registros. Selecione um recorte; nenhum total parcial foi calculado.', 413);
    return snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id }));
  }
  const snapshots = [];
  for (let i = 0; i < scope.transactionIds.length; i += 100) snapshots.push(...await db.getAll(...scope.transactionIds.slice(i, i + 100).map(id => collection.doc(id))));
  if (snapshots.some(doc => !doc.exists)) throw new FinancialRequestError('A seleção mudou. Atualize o Dashboard e consulte novamente.', 409);
  return snapshots.map(doc => ({ ...doc.data(), id: doc.id }));
}

function filterOptions(transactions) {
  const result = {};
  for (const key of ['bankAccount', 'type', 'paidBy']) {
    const values = [...new Set(transactions.filter(t => !t.isExcluded).map(t => t[key]).filter(v => typeof v === 'string' && v.length <= 180))];
    // Uma lista parcial nunca se apresenta como inventário completo.
    if (values.length > 200) throw new FinancialRequestError('Muitas opções de filtro. Use os filtros manuais para reduzir a seleção.', 413);
    result[key] = values.sort();
  }
  return result;
}

/** Apenas consulta dados financeiros. Não há ferramenta de escrita, baixa ou envio. */
export function createFinancialHandler({ getServices, readBody, sendJson, provider, env = process.env, now = () => new Date() }) {
  const limits = new Map();
  return async (request, response) => {
    const path = new URL(request.url, 'http://localhost').pathname;
    if (!path.startsWith('/api/financial-ai/')) return false;
    let uid, busy = false;
    try {
      const statusRoute = request.method === 'GET' && path === '/api/financial-ai/status';
      const queryRoute = request.method === 'POST' && path === '/api/financial-ai/query';
      if (!statusRoute && !queryRoute) throw new FinancialRequestError('Rota não encontrada.', 404);
      const bearer = String(request.headers.authorization || '').match(/^Bearer (\S+)$/);
      if (!bearer) throw new FinancialRequestError('Entre novamente para consultar o financeiro.', 401);
      const { auth, db } = getServices();
      try { uid = (await auth.verifyIdToken(bearer[1], true)).uid; } catch { throw new FinancialRequestError('Sessão expirada. Entre novamente.', 401); }
      const checkProfile = async () => {
        let current;
        try { current = await auth.verifyIdToken(bearer[1], true); } catch { throw new FinancialRequestError('Sessão expirada. Entre novamente.', 401); }
        if (current.uid !== uid) throw new FinancialRequestError('A sessão mudou. Entre novamente.', 401);
        const snapshot = await db.collection('users').doc(uid).get();
        if (!snapshot.exists || !activeProfile(snapshot.data())) throw new FinancialRequestError('Seu acesso ao financeiro não está ativo.', 403);
      };
      await checkProfile();
      const enabled = env.FINANCIAL_AI_ENABLED === 'true';
      if (statusRoute) {
        sendJson(response, 200, { available: enabled, languageModelAvailable: enabled && provider.configured(), readOnly: true });
        return true;
      }
      if (!enabled) throw new FinancialRequestError('Consultor Financeiro ainda não habilitado. Os filtros manuais continuam disponíveis.', 503);
      const time = now().getTime();
      for (const [key, limit] of limits) if (!limit.busy && time - limit.start >= 60000) limits.delete(key);
      const limit = limits.get(uid) || { start: time, count: 0, busy: false };
      if (limit.busy || limit.count >= 10 || (!limits.has(uid) && limits.size >= 2000)) throw new FinancialRequestError('Aguarde um instante antes de consultar novamente.', 429);
      limit.count++; limit.busy = true; limits.set(uid, limit); busy = true;
      let body;
      try { body = JSON.parse((await readBody(request)).toString('utf8')); } catch { throw new FinancialRequestError('A consulta é inválida ou excede o limite de tamanho.'); }
      validateRequest(body);
      const transactions = await readTransactions(db, body.scope);
      await checkProfile();
      let answer, analysis, filters, interpretation = 'not_requested';
      const today = businessDate(now());
      if (body.mode === 'filter') {
        if (!provider.configured()) throw new FinancialRequestError('A interpretação de filtros por IA ainda não está configurada. Use os filtros manuais.', 503);
        let result;
        try {
          const options = filterOptions(transactions);
          result = await provider.interpret(body.query, { today, timeZone: 'America/Sao_Paulo', options });
          filters = validateFilters(result.filters);
          for (const key of ['bankAccount', 'type', 'paidBy']) if (filters[key] && !options[key].includes(filters[key])) throw new Error('Opção não encontrada.');
          if (typeof result.explanation !== 'string') throw new Error('Explicação inválida.');
        } catch (error) {
          if (error instanceof FinancialRequestError) throw error;
          throw new FinancialRequestError('Não foi possível interpretar os filtros. Use os filtros manuais ou reformule a pergunta.', 502);
        }
        answer = result.explanation; interpretation = 'completed';
      } else {
        analysis = analyzeTransactions(transactions, { today, scope: body.scope.kind });
        answer = renderFinancialAnswer(analysis, body.mode);
        interpretation = provider.configured() ? 'unavailable' : 'not_configured';
        if (provider.configured()) {
          try {
            // Sem nomes, documentos, descrições ou transações brutas no provedor.
            const context = { referenceDate: today, scope: analysis.scope, count: analysis.analyzedCount, totals: analysis.totals, forecast: { start: analysis.forecast.start, end: analysis.forecast.end, expectedReceiptsCents: analysis.forecast.expectedReceiptsCents, expectedPaymentsCents: analysis.forecast.expectedPaymentsCents, openingBalance: null }, issues: analysis.issues };
            const result = await provider.explain(body.query, context);
            if (typeof result.explanation !== 'string' || /\d/.test(result.explanation) || result.explanation.length > 3000) throw new Error('Explicação inválida.');
            if (result.explanation.trim()) answer += `\n\nInterpretação da IA:\n${result.explanation}`;
            interpretation = 'completed';
          } catch { answer += '\n\nInterpretação por IA indisponível; os cálculos acima foram concluídos pelo sistema.'; }
        } else answer += '\n\nInterpretação por IA ainda não configurada; os cálculos acima foram concluídos pelo sistema.';
      }
      // Não entrega resultados se o acesso foi revogado durante a leitura ou chamada externa.
      await checkProfile();
      sendJson(response, 200, { answer, ...(analysis ? { analysis } : {}), ...(filters ? { filters } : {}), interpretation, readOnly: true, retrievedAt: now().toISOString() });
    } catch (error) {
      const status = error instanceof FinancialRequestError ? error.status : 500;
      if (status === 500) console.error('financial-ai failure', { code: 'internal' });
      sendJson(response, status, { error: status === 500 ? 'Não foi possível concluir a consulta financeira. Tente novamente.' : error.message });
    } finally {
      if (busy && uid) limits.get(uid).busy = false;
    }
    return true;
  };
}
