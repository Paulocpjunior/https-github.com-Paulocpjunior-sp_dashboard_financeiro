import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { onAuthStateChanged } from 'firebase/auth';
import { doc, onSnapshot } from 'firebase/firestore';
import { Landmark, Upload, ShieldCheck } from 'lucide-react';
import Layout from '../components/Layout';
import BankingFlowScope from '../components/BankingFlowScope';
import { auth, db } from '../firebase';
import { ItauStatements, StatementBalance, OfxFile, StatementImport, StatementPreview, StatementRequestError, StatementRow, readOfxFile } from '../services/itauStatementService';

const money = (cents: number) => (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const displayDate = (value: string) => value.split('-').reverse().join('/');
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
const card = 'rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-5';
const button = 'rounded-lg bg-blue-700 px-4 py-2.5 text-white font-semibold disabled:opacity-40 disabled:cursor-not-allowed';
const input = 'rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-950 px-3 py-2 text-slate-900 dark:text-white';

function Movements({ rows }: { rows: StatementRow[] }) {
  return <div className="overflow-x-auto"><table className="w-full text-sm text-left"><thead className="bg-slate-50 dark:bg-slate-800"><tr>{['Data', 'Histórico do banco', 'Identificador da movimentação', 'Valor'].map(label => <th className="px-4 py-3" key={label}>{label}</th>)}</tr></thead><tbody>
    {rows.map(row => <tr key={row.id} className="border-t border-slate-100 dark:border-slate-800"><td className="px-4 py-3 whitespace-nowrap">{displayDate(row.date)}</td><td className="px-4 py-3 min-w-64"><div>{row.name || row.memo || 'Sem histórico informado'}</div>{row.name && row.memo && <div className="text-slate-500">{row.memo}</div>}<span className="text-xs text-slate-500">{row.type}{row.checknum ? ` · Documento ${row.checknum}` : ''}</span></td><td className="px-4 py-3 break-all">{row.fitid}</td><td className={`px-4 py-3 text-right whitespace-nowrap font-semibold ${row.amountCents < 0 ? 'text-red-600 dark:text-red-400' : 'text-emerald-700 dark:text-emerald-400'}`}>{money(row.amountCents)}</td></tr>)}
  </tbody></table></div>;
}
function BalanceReferences({ rows }: { rows?: StatementBalance[] }) {
  if (!rows?.length) return null;
  return <details className="rounded-lg border border-amber-300 dark:border-amber-800 p-3 text-sm my-3"><summary className="cursor-pointer font-medium">{rows.length} referências de saldo preservadas — fora das movimentações</summary>
    <p className="my-2">Saldo anterior e saldo disponível diário não são receitas. O saldo disponível pode ter composição e data diferentes do saldo do arquivo; nenhuma diferença será ajustada automaticamente.</p>
    <ul className="space-y-1">{rows.map(row=><li key={row.fitid}>{displayDate(row.date)} · {row.memo || row.name} · {money(row.amountCents)}</li>)}</ul>
  </details>;
}
export default function ItauStatement() {
  const [access, setAccess] = useState({ ready: false, read: false, import: false });
  const [start, setStart] = useState(() => `${today().slice(0, 7)}-01`);
  const [end, setEnd] = useState(today);
  const [result, setResult] = useState<{ rows: StatementRow[]; imports: StatementImport[] } | null>(null);
  const [preview, setPreview] = useState<StatementPreview | null>(null);
  const [file, setFile] = useState<OfxFile | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const generation = useRef(0);
  const uploadRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    let unsubscribeProfile = () => {};
    const unsubscribeAuth = onAuthStateChanged(auth, user => {
      unsubscribeProfile(); generation.current++;
      setResult(null);  setPreview(null); setFile(null); setBusy(false);
      if (!user) { setAccess({ ready: true, read: false, import: false }); return; }
      unsubscribeProfile = onSnapshot(doc(db, 'users', user.uid), snapshot => {
        const p = snapshot.data();
        const active = p?.active === true && !['deleted', 'blocked'].includes(p?.status);
        const read = active && (p?.role === 'admin' || p?.financialPermissions?.includes('itau.openfinance.read') === true);
        const write = read && (p?.role === 'admin' || p?.financialPermissions?.includes('itau.statement.import') === true);
        generation.current++; setBusy(false);
        setAccess({ ready: true, read: !!read, import: !!write });

        if (!read) setResult(null);
        // A pending response cannot resurrect data after profile revocation.
        setPreview(null); setFile(null);
      }, () => {
        generation.current++; setBusy(false); setResult(null);  setPreview(null); setFile(null);
        setAccess({ ready: true, read: false, import: false });
      });
    });
    return () => { generation.current++; unsubscribeAuth(); unsubscribeProfile(); };
  }, []);
  async function run(action: () => Promise<void>) {
    setBusy(true); setError(''); setMessage('');
    const id = generation.current;
    try { await action(); } catch (e) {
      if (id !== generation.current) return;
      if (e instanceof StatementRequestError && [401,403].includes(e.status)) {
        setResult(null);  setPreview(null); setFile(null);
      }
      setError(e instanceof Error ? e.message : 'Operação não concluída.');
    } finally { if (id === generation.current) setBusy(false); }
  }
  const validRange = start && end && start <= end && (Date.parse(end) - Date.parse(start)) / 86400000 <= 92;
  const credits = (result?.rows || []).filter(row => row.amountCents > 0);
  const creditTotal = credits.reduce((sum, row) => sum + row.amountCents, 0);
  return <Layout><div className="space-y-6 text-slate-800 dark:text-slate-100">
    <header className="flex gap-3 items-start"><Landmark className="h-8 w-8 text-blue-700 shrink-0"/><div><h1 className="text-2xl font-bold">Extrato Itaú</h1><p className="text-slate-500">Agência 3145 · Conta 99791-6 · Real (BRL)</p></div></header>
    {!access.ready ? <p role="status">Verificando acesso…</p> : !access.read ? <section className={card}><ShieldCheck className="mb-3"/><h2 className="font-semibold">Acesso restrito</h2><p>Solicite ao administrador a permissão Consultar Itaú para esta conta.</p></section> : <>
      <BankingFlowScope receivablesOnly/>
      {error && <div role="alert" className="rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-300 p-4 text-red-700 dark:text-red-300">{error}</div>}
      {message && <div role="status" className="rounded-lg bg-emerald-50 dark:bg-emerald-950/30 p-4 text-emerald-700 dark:text-emerald-300">{message}</div>}
      <form className={`${card} flex flex-wrap gap-4 items-end`} onSubmit={event => { event.preventDefault(); const id = ++generation.current; setResult(null);  void run(async () => { const data = await ItauStatements.list(start,end); if(id === generation.current) setResult(data); }); }}>
        <label className="grid gap-1 text-sm font-medium">De<input className={input} type="date" required value={start} disabled={busy} onChange={e => { setStart(e.target.value); setResult(null);  }}/></label>
        <label className="grid gap-1 text-sm font-medium">Até<input className={input} type="date" required value={end} disabled={busy} onChange={e => { setEnd(e.target.value); setResult(null);  }}/></label>
        <button className={button} disabled={busy || !validRange}>Consultar recebimentos</button><span className="text-xs text-slate-500">Até 93 dias por consulta.</span>
      </form>
      {access.import && <section className={card}><h2 className="font-semibold flex gap-2 items-center"><Upload size={19}/>Importar extrato bancário</h2><p className="text-sm text-slate-500 mt-1 mb-4">Selecione o arquivo original do Itaú. Confira a prévia antes de salvar. OFX, PDF com texto selecionável, XLS e XLSX. Até 2 MB e 400 movimentações por arquivo. Layouts não reconhecidos serão bloqueados para revisão.</p><div className="sp-ui"><button type="button" className="sp-button sp-button-primary" disabled={busy} onClick={() => { if (uploadRef.current) { uploadRef.current.value = ''; uploadRef.current.click(); } }}><Upload size={20} aria-hidden="true"/>Importar arquivo</button><span className="ml-3 text-sm sp-muted">{file?.fileName || 'OFX, PDF, XLS ou XLSX'}</span></div><input aria-label="Selecionar extrato bancário" ref={uploadRef} type="file" accept=".ofx,.pdf,.xls,.xlsx" disabled={busy} className="hidden" onChange={event => {
        const selected = event.target.files?.[0]; const id = ++generation.current; setPreview(null); setFile(null);
        if (!selected) return;
        void run(async () => { const content = await readOfxFile(selected); if (id !== generation.current) return; const data = await ItauStatements.preview(content); if (id === generation.current) { setFile(content); setPreview(data); } });
      }}/></section>}
      <section className={`${card} space-y-3`} aria-labelledby="statement-next-steps"><h2 id="statement-next-steps" className="font-semibold">Após importar: conferir e registrar a baixa</h2>
        <ol className="list-decimal pl-5 space-y-2 text-sm">
          <li>Selecione o período importado e clique em <strong>Consultar recebimentos</strong> para ver as movimentações.</li>
          <li>Para entradas, localize a conta em <strong>Lançamentos → A Receber</strong>. Confira cliente, valor, data, conta bancária e o histórico de recebimentos antes de registrar uma baixa manual.</li>
          <li>Se ainda houver saldo, registre somente o valor recebido, revise e confirme. Depois confira o histórico, o valor recebido e o saldo restante: uma baixa parcial mantém a conta em aberto.</li>
        </ol>
        <p className="text-sm">Se o Boleto Cloud já confirmou e baixou o recebimento, não registre outra baixa. Créditos agrupados como BOLETOS RECEBIDOS precisam do detalhamento por boleto para identificar cada cliente.</p>
        <div className="sp-ui"><Link className="sp-button" to="/lancamentos">Abrir Lançamentos</Link></div>
      </section>
      {busy && <p role="status">Processando…</p>}
      {preview && <section className={`${card} space-y-4`}><h2 className="text-lg font-bold">Conferência antes de importar</h2><p className="text-sm break-all">{preview.fileName} · {displayDate(preview.start)} a {displayDate(preview.end)}</p><p>{preview.newCount} novas · {preview.duplicateCount} já importadas · {preview.conflicts.length} divergências</p><p className="text-sm">Entradas para conferência: {money(preview.totals.credits)}</p>
        {preview.ledgerBalance && <p className="text-sm">Saldo informado pelo banco em {displayDate(preview.ledgerBalance.date)}: <strong>{money(preview.ledgerBalance.amountCents)}</strong></p>}
        {preview.alreadyImported && <p role="status">Este arquivo já foi importado. Nenhuma nova gravação é necessária.</p>}
        {preview.conflicts.length > 0 && <p role="alert" className="text-red-600">Identificadores com conteúdo diferente: {preview.conflicts.join(', ')}. Importação bloqueada para revisão.</p>}
        {preview.duplicateCount > 0 && <p className="text-sm">As movimentações idênticas já existentes serão preservadas e não serão gravadas novamente.</p>}
        <p className="text-sm text-slate-500">Em PDF e Excel, o identificador iniciado por ARQUIVO é gerado pelo sistema. Créditos agregados, como BOLETOS RECEBIDOS, exigem o detalhamento antes de baixar clientes individualmente.</p><BalanceReferences rows={preview.balanceRows}/><p className="text-sm">A prévia abaixo mostra somente os {preview.rows.filter(row => row.amountCents > 0).length} créditos. O arquivo completo será preservado no histórico bancário; débitos não serão tratados nesta etapa.</p><Movements rows={preview.rows.filter(row => row.amountCents > 0)}/><p className="text-sm text-slate-500">A importação alimenta somente o extrato bancário. Não cria lançamentos nem dá baixa nas contas a pagar ou receber.</p>
        <div className="flex gap-3"><button className={button} disabled={busy || preview.alreadyImported || preview.conflicts.length > 0 || !file} onClick={() => {
          const id = ++generation.current; void run(async () => { const saved = await ItauStatements.commit(file!, preview.fileHash); if (id !== generation.current) return; setMessage(saved.alreadyImported ? 'Arquivo já importado anteriormente.' : `Importação concluída: ${saved.inserted} novas movimentações; ${saved.duplicates} já existentes preservadas.`); setStart(preview.start); setEnd(preview.end); setPreview(null); setFile(null); setResult(null);  if(uploadRef.current) uploadRef.current.value = ''; });
        }}>Confirmar importação</button><button className="rounded-lg border px-4 py-2" disabled={busy} onClick={() => { generation.current++; setPreview(null); setFile(null); if(uploadRef.current) uploadRef.current.value = ''; }}>Cancelar</button></div>
      </section>}
      {result && <><section className="grid sm:grid-cols-2 gap-4"><div className={card}><p className="text-sm text-slate-500">Créditos importados no período</p><strong className="text-xl text-emerald-700">{money(creditTotal)}</strong><p className="text-xs text-slate-500">Entradas bancárias para conferência; não representam baixas confirmadas.</p></div><div className={card}><p className="text-sm text-slate-500">Entradas para conferir</p><strong className="text-xl">{credits.length}</strong><p className="text-xs text-slate-500">Confirme a origem e o vínculo com a conta a receber.</p></div></section>
        <section className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 overflow-hidden"><h2 className="p-5 font-semibold">Recebimentos — {credits.length} créditos importados</h2><p className="px-5 pb-3 text-sm text-slate-500">Somente entradas são exibidas nesta etapa. As demais movimentações permanecem preservadas no histórico do arquivo.</p>{credits.length ? <Movements rows={credits}/> : <p className="px-5 pb-5 text-slate-500">Nenhum crédito importado neste período. Isso não confirma ausência de recebimentos no banco.</p>}</section>
        <section className={card}><h2 className="font-semibold mb-3">Últimas 20 importações da conta</h2>{!result.imports.length && <p className="text-slate-500">Nenhum arquivo importado.</p>}{result.imports.map(item => <div key={item.fileHash} className="py-3 border-t border-slate-100 dark:border-slate-800 text-sm"><p className="font-medium break-all">{item.fileName}</p><p>Período: {displayDate(item.start)} a {displayDate(item.end)} · {item.rowCount} movimentações</p><p className="text-slate-500">Importado em {new Date(item.importedAt).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })} (Brasília)</p>{item.ledgerBalance && <p>Saldo do arquivo em {displayDate(item.ledgerBalance.date)}: {money(item.ledgerBalance.amountCents)}</p>}<BalanceReferences rows={item.balanceRows}/></div>)}</section></>}
    </>}
  </div></Layout>;
}
