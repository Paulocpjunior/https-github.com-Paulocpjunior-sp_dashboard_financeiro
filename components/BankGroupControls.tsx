import React,{useEffect,useRef,useState} from 'react';
import {ItauStatements,type GroupPayment,type GroupPreview,type GroupLink,type StatementRow} from '../services/itauStatementService';
const money=(v:number)=>(v/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const date=(v:string)=>v.split('-').reverse().join('/');
const button='rounded-lg bg-blue-700 text-white px-4 py-3 font-semibold disabled:opacity-50';
const field='block w-full border border-slate-400 rounded-lg p-2 mt-1 bg-white dark:bg-slate-800';
export function BankGroupHistory({links,onUnlink}:{links:GroupLink[];onUnlink?:(link:GroupLink)=>void}){
 if(!links.length)return null;
 return <section aria-label="Histórico de grupos bancários" className="space-y-3 border-t pt-4"><h3 className="text-lg font-bold">Grupos bancários documentados</h3>{links.map(l=><article key={l.statementId} className="rounded-lg border p-4 space-y-2">
  <p className="font-semibold">{date(l.statement.date)} · {l.statement.name} · {money(l.statement.amountCents)}</p>
  <p>{{current:'Grupo ativo — fontes sem alterações nesta consulta',changed:'Revisão necessária — fonte alterada ou indisponível',missing:'Revisão necessária — fonte indisponível',inactive:'Grupo desfeito'}[l.validation]}</p>
  <ul>{l.payments.map(p=><li key={p.id}>{p.supplier} · {date(p.date)} · {money(p.amountCents)}</li>)}</ul>
  <details><summary className="cursor-pointer">Histórico ({l.history.length})</summary>{l.history.map((e,i)=><div key={i} className="mt-2 border-t pt-2 text-sm"><p>{e.action==='confirm'?'Confirmado':'Desfeito'} por {e.actor.name} · {new Date(e.at).toLocaleString('pt-BR')}</p><p>{e.reason}</p>{e.reference&&<p>Comprovante: {e.reference}</p>}{e.members?.map(m=><p className="break-all text-xs" key={`${m.transactionId}:${m.paymentRequestId}`}>{m.transactionId} · Baixa: {m.paymentRequestId}</p>)}{e.transactionId&&<p className="break-all text-xs">{e.transactionId} · {e.paymentRequestId}</p>}</div>)}</details>
  {l.active&&onUnlink&&<button className="rounded-lg border border-amber-600 p-2" onClick={()=>onUnlink(l)}>Desfazer grupo</button>}
 </article>)}</section>;
}
export default function BankGroupModal({statement,payments,unlink,onClose,onChanged,api=ItauStatements}:{statement:StatementRow|null;payments:GroupPayment[];unlink:GroupLink|null;onClose:()=>void;onChanged?:()=>Promise<void>;api?:Pick<typeof ItauStatements,'previewGroup'|'confirmGroup'|'unlinkGroup'>}){
 const [selected,setSelected]=useState<string[]>([]),[query,setQuery]=useState(''),[preview,setPreview]=useState<GroupPreview|null>(null);
 const [reason,setReason]=useState(''),[reference,setReference]=useState(''),[checked,setChecked]=useState(false),[busy,setBusy]=useState(false),[done,setDone]=useState(false),[error,setError]=useState('');
 const [requestId]=useState(()=>crypto.randomUUID());const dialog=useRef<HTMLElement>(null),alive=useRef(true);
 useEffect(()=>{alive.current=true;const previous=document.activeElement as HTMLElement|null;dialog.current?.focus();return()=>{alive.current=false;previous?.focus();};},[]);
 const available=statement?payments.filter(p=>p.amountCents>0&&p.amountCents<-statement.amountCents&&Math.abs(Date.parse(p.date)-Date.parse(statement.date))/86400000<=3):[];
 const chosen=available.filter(p=>selected.includes(p.id));const total=chosen.reduce((s,p)=>s+p.amountCents,0);
 const filtered=available.filter(p=>`${p.supplier} ${p.transactionId} ${p.paymentRequestId}`.toLowerCase().includes(query.toLowerCase()));
 const source=unlink||preview;
 async function review(){if(!statement)return;setBusy(true);setError('');try{const p=await api.previewGroup(statement.id,chosen.map(({transactionId,paymentRequestId})=>({transactionId,paymentRequestId})));if(alive.current){setPreview(p);setChecked(false);}}catch(e){if(alive.current)setError(e instanceof Error?e.message:'Falha na prévia.');}finally{if(alive.current)setBusy(false);}}
 async function submit(e:React.FormEvent){e.preventDefault();setBusy(true);setError('');try{
  if(unlink)await api.unlinkGroup({statementId:unlink.statementId,revision:unlink.revision,reason,requestId});
  else if(statement&&preview)await api.confirmGroup({statementId:statement.id,members:preview.members,fingerprint:preview.fingerprint,revision:preview.revision,reason,reference,checkedEvidence:checked,requestId});
  else throw Error('Revise a composição antes de confirmar.');
  if(alive.current)setDone(true);
 }catch(e){if(alive.current)setError(e instanceof Error?e.message:'Falha ao registrar grupo.');}finally{if(alive.current)setBusy(false);}}
 async function finish(){setBusy(true);try{await onChanged?.();onClose();}catch{if(alive.current)setError('Operação registrada. Não confirme novamente; atualize a consulta para carregar o resultado.');}finally{if(alive.current)setBusy(false);}}
 return <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"><section ref={dialog} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="group-title" className="w-full max-w-3xl max-h-[90vh] overflow-y-auto rounded-xl p-6 bg-white dark:bg-slate-900 text-slate-900 dark:text-white space-y-4" onKeyDown={e=>{
  if(e.key==='Escape'&&!busy){e.preventDefault();if(done)void finish();else onClose();}
  if(e.key==='Tab'){const nodes=Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),textarea:not(:disabled)')||[]),first=nodes[0],last=nodes.at(-1);if(!first){e.preventDefault();return;}if(e.shiftKey&&(document.activeElement===first||document.activeElement===dialog.current)){e.preventDefault();last?.focus();}else if(!e.shiftKey&&(document.activeElement===last||document.activeElement===dialog.current)){e.preventDefault();first.focus();}}
 }}>
  <div className="sticky top-0 z-10 bg-white dark:bg-slate-900 pb-3 flex justify-between gap-4"><h2 id="group-title" className="text-xl font-bold">{unlink?'Desfazer grupo bancário':'Conferir pagamento agrupado'}</h2><button className="border rounded-lg px-3" disabled={busy} onClick={done?()=>void finish():onClose}>Fechar</button></div>
  <p>O grupo registra a conferência de baixas existentes. Não paga contas, não altera valores e não gera outra baixa.</p>
  <p className="font-semibold">{(source?.statement||statement)?.name} · {money((source?.statement||statement)?.amountCents||0)}</p>
  {error&&<p role="alert" className="bg-red-100 text-red-900 rounded-lg p-3">{error}</p>}
  {!source&&<><p>Selecione de 2 a 25 baixas da conta Itaú, até três dias do débito. Confira cada favorecido no comprovante do lote. A soma exata, sozinha, não comprova o grupo.</p>
   <label className="block">Pesquisar baixa<input className={field} value={query} onChange={e=>setQuery(e.target.value)} disabled={busy}/></label>
   <p>{available.length} baixas encontradas neste recorte · exibindo {Math.min(50,filtered.length)} de {filtered.length}. Refine a pesquisa para localizar outras.</p>
   <div className="max-h-60 overflow-y-auto border rounded-lg">{filtered.slice(0,50).map(p=><label key={p.id} className="flex gap-3 p-3 border-b"><input type="checkbox" disabled={busy||(!selected.includes(p.id)&&selected.length>=25)} checked={selected.includes(p.id)} onChange={e=>setSelected(e.target.checked?[...selected,p.id]:selected.filter(id=>id!==p.id))}/><span>{p.supplier} · {date(p.date)} · {money(p.amountCents)}<span className="block text-xs break-all">{p.transactionId} · Baixa: {p.paymentRequestId}</span></span></label>)}</div>
   {chosen.length>0&&<div><p className="font-bold">Selecionadas ({chosen.length})</p>{chosen.map(p=><p key={p.id}>{p.supplier} · {money(p.amountCents)} <button className="underline" disabled={busy} onClick={()=>setSelected(selected.filter(id=>id!==p.id))} aria-label={`Remover ${p.supplier} ${p.paymentRequestId}`}>Remover</button></p>)}</div>}
   <p aria-live="polite" className="font-bold">Soma: {money(total)} · Diferença: {money(-(statement?.amountCents||0)-total)}</p>
   <button className={button} disabled={busy||chosen.length<2||chosen.length>25||total!==-(statement?.amountCents||0)} onClick={()=>void review()}>{busy?'Conferindo fontes…':'Revisar composição do grupo'}</button>
  </>}
  {source&&<><ul className="rounded-lg bg-slate-100 dark:bg-slate-800 p-4 space-y-2">{source.payments.map(p=><li key={p.id}>{p.supplier} · {date(p.date)} · {money(p.amountCents)}<span className="block text-xs break-all">{p.transactionId} · Baixa: {p.paymentRequestId}</span></li>)}</ul><p className="font-bold">Total conferido: {money(source.totalCents)}</p></>}
  {done?<><p role="status">Grupo registrado com histórico.</p><button className={button} disabled={busy} onClick={()=>void finish()}>Atualizar consulta e concluir</button></>:source&&<form className="space-y-4" onSubmit={submit}>
   <label className="block">Justificativa<textarea className={field} required minLength={10} maxLength={1000} disabled={busy} value={reason} onChange={e=>setReason(e.target.value)}/></label>
   {!unlink&&<><label className="block">Referência do comprovante do lote<input className={field} required minLength={5} maxLength={1000} disabled={busy} value={reference} onChange={e=>setReference(e.target.value)}/></label><label className="flex gap-3"><input type="checkbox" required disabled={busy} checked={checked} onChange={e=>setChecked(e.target.checked)}/>Conferi todos os favorecidos, a conta e o comprovante do lote. Estas baixas compõem este débito.</label></>}
   <div className="flex gap-3">{!unlink&&<button type="button" disabled={busy} className="rounded-lg border p-3" onClick={()=>{setPreview(null);setChecked(false);}}>Voltar à seleção</button>}<button className={button} disabled={busy||(!unlink&&!checked)}>{busy?'Registrando…':unlink?'Confirmar desfazimento do grupo':'Confirmar vínculo do grupo'}</button></div>
  </form>}
 </section></div>;
}
