import React,{useEffect,useState,useRef} from 'react';
import {ItauStatements,type LegacyLink,type LegacyLinkPreview} from '../services/itauStatementService';
const money=(c:number)=>(c/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const date=(d:string)=>d.split('-').reverse().join('/');
const field='block w-full rounded-lg border border-slate-400 bg-white dark:bg-slate-800 p-2 mt-1';
export function LegacyLinkHistory({links,onUnlink}:{links:LegacyLink[];onUnlink?:(link:LegacyLink)=>void}){
 if(!links.length)return null;
 return <section className="border-t border-slate-300 dark:border-slate-700 pt-5 space-y-3" aria-label="Histórico de vínculos bancários">
  <h3 className="text-lg font-bold">Vínculos bancários documentados</h3>
  <p className="text-sm">Vínculo documenta a conferência. Desfazer o vínculo não estorna o pagamento.</p>
  {links.map(link=><article key={link.statementId} className="rounded-lg border border-slate-300 dark:border-slate-700 p-4 space-y-2">
   <p className="font-semibold">{date(link.statement.date)} · {link.statement.name} · {money(link.statement.amountCents)}</p>
   <p>{link.kind==='native'?'Baixa nativa':'Pagamento antigo'} · {link.payment.supplier} · Pagamento de {date(link.payment.date)} · {money(link.payment.amountCents)}</p>
   <p className={link.validation==='changed'||link.validation==='missing'?'font-semibold text-amber-700 dark:text-amber-300':'font-semibold'}>{{current:'Vínculo ativo — fontes sem alterações nesta consulta',changed:'Revisão necessária — os dados de origem mudaram',missing:'Revisão necessária — fonte indisponível',inactive:'Vínculo desfeito'}[link.validation]}</p>
   <p className="text-xs break-all">Lançamento: {link.transactionId} · FITID: {link.statement.fitid}</p>
   <details><summary className="cursor-pointer">Histórico ({link.history.length})</summary>{link.history.map((event,i)=><div key={i} className="border-t border-slate-200 dark:border-slate-700 mt-2 pt-2 text-sm"><p>{event.action==='confirm'?'Confirmado':'Desfeito'} por {event.actor.name} · {new Date(event.at).toLocaleString('pt-BR')}</p><p>{event.reason}</p>{event.reference&&<p>Comprovante: {event.reference}</p>}{event.members?.map(m=><p key={`${m.transactionId}:${m.paymentRequestId}`} className="text-xs break-all">{m.transactionId} · Baixa: {m.paymentRequestId}</p>)}<p className="text-xs break-all">Lançamento: {event.transactionId||'Grupo de baixas'}{event.paymentRequestId&&<> · Baixa: {event.paymentRequestId}</>}</p></div>)}</details>
   {link.active&&onUnlink&&<button className="rounded-lg border border-amber-600 px-3 py-2 font-semibold" onClick={()=>onUnlink(link)}>Desfazer vínculo</button>}
  </article>)}
 </section>;
}
export function LegacyLinkModal({target,unlink,onClose,onChanged,api=ItauStatements}:{target:{statementId:string;transactionId:string;paymentRequestId?:string}|null;unlink:LegacyLink|null;onClose:()=>void;onChanged?:()=>Promise<void>;api?:Pick<typeof ItauStatements,'previewLegacyLink'|'confirmLegacyLink'|'unlinkLegacyLink'>}){
 const [preview,setPreview]=useState<LegacyLinkPreview|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[done,setDone]=useState(false);
 const [reason,setReason]=useState(''),[reference,setReference]=useState(''),[checked,setChecked]=useState(false);
 const [requestId]=useState(()=>crypto.randomUUID());
 const dialog=useRef<HTMLElement>(null);
 useEffect(()=>{const previous=document.activeElement as HTMLElement|null;dialog.current?.focus();return()=>previous?.focus();},[]);
 useEffect(()=>{let alive=true;if(target){setBusy(true);api.previewLegacyLink(target.statementId,target.transactionId,target.paymentRequestId).then(p=>{if(alive)setPreview(p);}).catch(e=>{if(alive)setError(e.message);}).finally(()=>{if(alive)setBusy(false);});}return()=>{alive=false;};},[target]);
 async function submit(event:React.FormEvent){event.preventDefault();setBusy(true);setError('');try{
  if(unlink)await api.unlinkLegacyLink({kind:unlink.kind,statementId:unlink.statementId,revision:unlink.revision,requestId,reason});
  else if(preview&&target)await api.confirmLegacyLink({...target,revision:preview.revision,fingerprint:preview.fingerprint,requestId,reason,reference,checkedEvidence:checked});
  else throw Error('Aguarde a prévia.');
  setDone(true);
 }catch(e){setError(e instanceof Error?e.message:'Não foi possível concluir.');}finally{setBusy(false);}}
 async function refresh(){setBusy(true);setError('');try{await onChanged?.();onClose();}catch{setError('Operação registrada. Não repita a confirmação; atualize a consulta para carregar o resultado.');}finally{setBusy(false);}}
 const source=unlink||preview;
 return <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"><section ref={dialog} tabIndex={-1} onKeyDown={event=>{
   if(event.key==='Escape'&&!busy){event.preventDefault();if(done)void refresh();else onClose();}
   if(event.key==='Tab'){
    const nodes=Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),textarea:not(:disabled),[tabindex="0"]')||[]);
    const first=nodes[0],last=nodes[nodes.length-1];
    if(!first){event.preventDefault();return;}
    if(event.shiftKey&&(document.activeElement===first||document.activeElement===dialog.current)){event.preventDefault();last.focus();}
    else if(!event.shiftKey&&(document.activeElement===last||document.activeElement===dialog.current)){event.preventDefault();first.focus();}
   }
  }} role="dialog" aria-modal="true" aria-labelledby="legacy-link-title" className="max-h-[90vh] overflow-y-auto w-full max-w-2xl rounded-xl bg-white dark:bg-slate-900 text-slate-900 dark:text-white p-6 space-y-4">
  <div className="flex justify-between gap-4"><h2 id="legacy-link-title" className="text-xl font-bold">{unlink?'Desfazer vínculo bancário':target?.paymentRequestId?'Revisar vínculo de baixa nativa':'Revisar vínculo de pagamento antigo'}</h2><button disabled={busy} onClick={done?()=>void refresh():onClose} className="rounded-lg border px-3 py-2">Fechar</button></div>
  <p className="text-sm">Esta operação altera somente o vínculo de conferência. O lançamento, o saldo e a baixa permanecem preservados.</p>
  {busy&&!source&&<p role="status">Conferindo dados atuais…</p>}
  {error&&<p role="alert" className="rounded-lg bg-red-100 text-red-900 p-3">{error}</p>}
  {source&&<div className="rounded-lg bg-slate-100 dark:bg-slate-800 p-4 space-y-2"><p><strong>Extrato:</strong> {source.statement.name} · {date(source.statement.date)} · {money(source.statement.amountCents)}</p><p><strong>Pagamento:</strong> {source.payment.supplier} · {date(source.payment.date)} · {money(source.payment.amountCents)}</p><p className="text-xs break-all">FITID: {source.statement.fitid} · Lançamento: {source.payment.transactionId}{source.payment.paymentRequestId&&<> · Baixa: {source.payment.paymentRequestId}</>}</p>{source.payment.bankEvidence==='missing'&&<p className="font-semibold text-amber-700 dark:text-amber-300">Conta bancária não informada no lançamento. Comprove que este pagamento saiu da conta Itaú antes de confirmar.</p>}</div>}
  {done?<><p role="status" className="font-semibold">Operação registrada com histórico.</p><button disabled={busy} onClick={()=>void refresh()} className="rounded-lg bg-blue-700 text-white px-4 py-3">Atualizar consulta e concluir</button></>:source&&<form onSubmit={submit} className="space-y-4">
   <label className="block">Justificativa<textarea className={field} value={reason} onChange={e=>setReason(e.target.value)} minLength={10} maxLength={1000} required disabled={busy}/></label>
   {!unlink&&<><label className="block">Referência do comprovante<input className={field} value={reference} onChange={e=>setReference(e.target.value)} placeholder="Número ou localização do comprovante conferido" minLength={5} maxLength={1000} required disabled={busy}/></label><label className="flex gap-3 items-start"><input type="checkbox" checked={checked} onChange={e=>setChecked(e.target.checked)} required disabled={busy} className="mt-1"/>Conferi favorecido, conta bancária e comprovante. Confirmo que este débito corresponde ao pagamento selecionado.</label></>}
   <button disabled={busy||(!unlink&&!checked)} className="rounded-lg bg-blue-700 text-white px-4 py-3 font-semibold disabled:opacity-50">{busy?'Registrando…':unlink?'Confirmar desfazimento do vínculo':'Confirmar vínculo bancário'}</button>
  </form>}
 </section></div>;
}
