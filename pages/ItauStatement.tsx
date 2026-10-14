import React, { useEffect, useRef, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { doc, onSnapshot } from 'firebase/firestore';
import { Landmark, Upload, ShieldCheck } from 'lucide-react';
import Layout from '../components/Layout';
import StatementPaymentComparison from '../components/StatementPaymentComparison';
import BankingFlowScope from '../components/BankingFlowScope';
import { auth, db } from '../firebase';
import { ItauStatements, PaymentComparison, StatementBalance, OfxFile, StatementImport, StatementPreview, StatementRequestError, StatementRow, readOfxFile } from '../services/itauStatementService';

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
  const [access, setAccess] = useState({ ready: false, read: false, import: false, compare:false,manageLinks:false });
  const [start, setStart] = useState(() => `${today().slice(0, 7)}-01`);
  const [end, setEnd] = useState(today);
  const [result, setResult] = useState<{ rows: StatementRow[]; imports: StatementImport[] } | null>(null);
  const [includeLegacy,setIncludeLegacy] = useState(false);
  const [comparison,setComparison] = useState<PaymentComparison|null>(null);
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
      setResult(null); setComparison(null); setPreview(null); setFile(null); setBusy(false);
      if (!user) { setAccess({ ready: true, read: false, import: false, compare:false,manageLinks:false }); return; }
      unsubscribeProfile = onSnapshot(doc(db, 'users', user.uid), snapshot => {
        const p = snapshot.data();
        const active = p?.active === true && !['deleted', 'blocked'].includes(p?.status);
        const read = active && (p?.role === 'admin' || p?.financialPermissions?.includes('itau.openfinance.read') === true);
        const write = read && (p?.role === 'admin' || p?.financialPermissions?.includes('itau.statement.import') === true);
        generation.current++; setBusy(false);
        setAccess({ ready: true, read: !!read, import: !!write, manageLinks:!!read && p?.role==='admin', compare:!!read && (p?.role==='admin' || p?.financialPermissions?.some((x:string)=>['payables.read','payables.settle','payables.reverse','payables.recurrence','payables.invite','payables.approve'].includes(x))) });
        setComparison(null);
        if (!read) setResult(null);
        // A pending response cannot resurrect data after profile revocation.
        setPreview(null); setFile(null);
      }, () => {
        generation.current++; setBusy(false); setResult(null); setComparison(null); setPreview(null); setFile(null);
        setAccess({ ready: true, read: false, import: false, compare:false,manageLinks:false });
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
        setResult(null); setComparison(null); setPreview(null); setFile(null);
      }
      setError(e instanceof Error ? e.message : 'Operação não concluída.');
    } finally { if (id === generation.current) setBusy(false); }
  }
  const validRange = start && end && start <= end && (Date.parse(end) - Date.parse(start)) / 86400000 <= 92;
  const totals = (result?.rows || []).reduce((a,r) => ({ credits: a.credits + Math.max(r.amountCents,0), debits: a.debits + Math.min(r.amountCents,0) }), { credits:0, debits:0 });
  return <Layout><div className="space-y-6 text-slate-800 dark:text-slate-100">
    <header className="flex gap-3 items-start"><Landmark className="h-8 w-8 text-blue-700 shrink-0"/><div><h1 className="text-2xl font-bold">Extrato Itaú</h1><p className="text-slate-500">Agência 3145 · Conta 99791-6 · Real (BRL)</p></div></header>
    {!access.ready ? <p role="status">Verificando acesso…</p> : !access.read ? <section className={card}><ShieldCheck className="mb-3"/><h2 className="font-semibold">Acesso restrito</h2><p>Solicite ao administrador a permissão Consultar Itaú para esta conta.</p></section> : <>
      <BankingFlowScope/>
      {error && <div role="alert" className="rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-300 p-4 text-red-700 dark:text-red-300">{error}</div>}
      {message && <div role="status" className="rounded-lg bg-emerald-50 dark:bg-emerald-950/30 p-4 text-emerald-700 dark:text-emerald-300">{message}</div>}
      <form className={`${card} flex flex-wrap gap-4 items-end`} onSubmit={event => { event.preventDefault(); const id = ++generation.current; setResult(null); setComparison(null); void run(async () => { const data = await ItauStatements.list(start,end); if(id === generation.current) setResult(data); }); }}>
        <label className="grid gap-1 text-sm font-medium">De<input className={input} type="date" required value={start} disabled={busy} onChange={e => { setStart(e.target.value); setResult(null); setComparison(null); }}/></label>
        <label className="grid gap-1 text-sm font-medium">Até<input className={input} type="date" required value={end} disabled={busy} onChange={e => { setEnd(e.target.value); setResult(null); setComparison(null); }}/></label>
        <button className={button} disabled={busy || !validRange}>Consultar extrato</button><span className="text-xs text-slate-500">Até 93 dias por consulta.</span>
      </form>
      {access.compare && <section className={card}><h2 className="font-semibold">Conferência de pagamentos</h2><p className="text-sm text-slate-500 my-2">Compare o extrato importado com as baixas nativas de contas a pagar. A consulta opcional de pagamentos antigos aparece separadamente. Nenhuma sugestão dá baixa ou confirma conciliação.</p><label className="flex items-center gap-2 my-3 text-sm"><input type="checkbox" checked={includeLegacy} disabled={busy} onChange={e=>{setIncludeLegacy(e.target.checked);setComparison(null);}}/> Incluir conferência separada de pagamentos antigos</label><button className={button} disabled={busy||!validRange} onClick={()=>{const id=++generation.current;setComparison(null);void run(async()=>{const data=await ItauStatements.compare(start,end,includeLegacy);if(id===generation.current)setComparison(data);});}}>Comparar baixas com o extrato</button></section>}
      {comparison && <StatementPaymentComparison key={comparison.generatedAt} comparison={comparison} canManageLinks={access.manageLinks} onLinksChanged={async()=>{const id=++generation.current;const data=await ItauStatements.compare(start,end,includeLegacy);if(id===generation.current)setComparison(data);}}/>}
      {access.import && <section className={card}><h2 className="font-semibold flex gap-2 items-center"><Upload size={19}/>Importar extrato bancário</h2><p className="text-sm text-slate-500 mt-1 mb-4">Selecione o arquivo original do Itaú. Confira a prévia antes de salvar. OFX, PDF com texto selecionável, XLS e XLSX. Até 2 MB e 400 movimentações por arquivo. Layouts não reconhecidos serão bloqueados para revisão.</p><label className="text-sm font-medium">Arquivo OFX, PDF ou Excel<input ref={uploadRef} type="file" accept=".ofx,.pdf,.xls,.xlsx" disabled={busy} className="block mt-2 max-w-full" onChange={event => {
        const selected = event.target.files?.[0]; const id = ++generation.current; setPreview(null); setFile(null);
        if (!selected) return;
        void run(async () => { const content = await readOfxFile(selected); if (id !== generation.current) return; const data = await ItauStatements.preview(content); if (id === generation.current) { setFile(content); setPreview(data); } });
      }}/></label></section>}
      {busy && <p role="status">Processando…</p>}
      {preview && <section className={`${card} space-y-4`}><h2 className="text-lg font-bold">Conferência antes de importar</h2><p className="text-sm break-all">{preview.fileName} · {displayDate(preview.start)} a {displayDate(preview.end)}</p><p>{preview.newCount} novas · {preview.duplicateCount} já importadas · {preview.conflicts.length} divergências</p><p className="text-sm">Entradas: {money(preview.totals.credits)} · Saídas: {money(preview.totals.debits)}</p>
        {preview.ledgerBalance && <p className="text-sm">Saldo informado pelo banco em {displayDate(preview.ledgerBalance.date)}: <strong>{money(preview.ledgerBalance.amountCents)}</strong></p>}
        {preview.alreadyImported && <p role="status">Este arquivo já foi importado. Nenhuma nova gravação é necessária.</p>}
        {preview.conflicts.length > 0 && <p role="alert" className="text-red-600">Identificadores com conteúdo diferente: {preview.conflicts.join(', ')}. Importação bloqueada para revisão.</p>}
        {preview.duplicateCount > 0 && <p className="text-sm">As movimentações idênticas já existentes serão preservadas e não serão gravadas novamente.</p>}
        <p className="text-sm text-slate-500">Em PDF e Excel, o identificador iniciado por ARQUIVO é gerado pelo sistema. Créditos agregados, como BOLETOS RECEBIDOS, exigem o detalhamento antes de baixar clientes individualmente.</p><BalanceReferences rows={preview.balanceRows}/><Movements rows={preview.rows}/><p className="text-sm text-slate-500">A importação alimenta somente o extrato bancário. Não cria lançamentos nem dá baixa nas contas a pagar ou receber.</p>
        <div className="flex gap-3"><button className={button} disabled={busy || preview.alreadyImported || preview.conflicts.length > 0 || !file} onClick={() => {
          const id = ++generation.current; void run(async () => { const saved = await ItauStatements.commit(file!, preview.fileHash); if (id !== generation.current) return; setMessage(saved.alreadyImported ? 'Arquivo já importado anteriormente.' : `Importação concluída: ${saved.inserted} novas movimentações; ${saved.duplicates} já existentes preservadas.`); setPreview(null); setFile(null); setResult(null); setComparison(null); if(uploadRef.current) uploadRef.current.value = ''; });
        }}>Confirmar importação</button><button className="rounded-lg border px-4 py-2" disabled={busy} onClick={() => { generation.current++; setPreview(null); setFile(null); if(uploadRef.current) uploadRef.current.value = ''; }}>Cancelar</button></div>
      </section>}
      {result && <><section className="grid sm:grid-cols-3 gap-4"><div className={card}><p className="text-sm text-slate-500">Entradas no período</p><strong className="text-xl text-emerald-700">{money(totals.credits)}</strong></div><div className={card}><p className="text-sm text-slate-500">Saídas no período</p><strong className="text-xl text-red-600">{money(totals.debits)}</strong></div><div className={card}><p className="text-sm text-slate-500">Variação das movimentações</p><strong className="text-xl">{money(totals.credits + totals.debits)}</strong><p className="text-xs text-slate-500">Não representa o saldo da conta.</p></div></section>
        <section className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 overflow-hidden"><h2 className="p-5 font-semibold">{result.rows.length} movimentações importadas</h2>{result.rows.length ? <Movements rows={result.rows}/> : <p className="px-5 pb-5 text-slate-500">Nenhuma movimentação importada neste período. Isso não confirma ausência de movimentação no banco.</p>}</section>
        <section className={card}><h2 className="font-semibold mb-3">Últimas 20 importações da conta</h2>{!result.imports.length && <p className="text-slate-500">Nenhum arquivo importado.</p>}{result.imports.map(item => <div key={item.fileHash} className="py-3 border-t border-slate-100 dark:border-slate-800 text-sm"><p className="font-medium break-all">{item.fileName}</p><p>Período: {displayDate(item.start)} a {displayDate(item.end)} · {item.rowCount} movimentações</p><p className="text-slate-500">Importado em {new Date(item.importedAt).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })} (Brasília)</p>{item.ledgerBalance && <p>Saldo do arquivo em {displayDate(item.ledgerBalance.date)}: {money(item.ledgerBalance.amountCents)}</p>}<BalanceReferences rows={item.balanceRows}/></div>)}</section></>}
    </>}
  </div></Layout>;
}
