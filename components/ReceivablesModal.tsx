import FinancialCorrection from './FinancialCorrection';
import React, {useEffect, useRef, useState} from 'react';
import '../design-system/tokens.css';
import {auth} from '../services/firebaseConfig';
import {Transaction} from '../types';
import {getOriginalAmount, getOutstandingAmount, getPaidAmount} from '../utils/transactionAmounts';
import {toLocalISODate} from '../utils/dateUtils';
import {AccumulatedBalancesService} from '../services/accumulatedBalancesService';

type Receipt = {date:string;amount:string;interest:string;discount:string;bankAccount:string;method:string;note:string};
type Details = {transaction:Transaction;version:string;catalog:{banks:string[];receiptMethods:string[]};canReverse?:boolean;canSettle:boolean;blockedReason:string|null};
type Review = {reviewHash:string;after:Transaction};
async function defaultApi(path:string, body?:unknown) {
 if(!auth.currentUser) throw Error('Entre novamente.');
 const response=await fetch('/api/financial-entries/receivables/'+path,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${await auth.currentUser.getIdToken()}`,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
 const data=await response.json();
 if(!response.ok)throw Object.assign(Error(data.error||'Operação não confirmada.'),{status:response.status});
 return data;
}
const brl=(n:number)=>n.toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
export default function ReceivablesModal({id,onClose,onSaved,api=defaultApi}:{id:string;onClose:()=>void;onSaved:()=>void;api?:typeof defaultApi}) {
 const [data,setData]=useState<Details|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[review,setReview]=useState<Review|null>(null),[saved,setSaved]=useState(false),[uncertain,setUncertain]=useState(false);
 const [mode,setMode]=useState<'receipt'|'reversal'>('receipt'),[correctionLocked,setCorrectionLocked]=useState(false);
 const [receipt,setReceipt]=useState<Receipt>({date:toLocalISODate(new Date()),amount:'',interest:'0.00',discount:'0.00',bankAccount:'',method:'',note:''});
 const [requestId]=useState(()=>crypto.randomUUID());
 const dialog=useRef<HTMLDivElement>(null), sending=useRef(false);
 useEffect(()=>{let active=true;api('items/'+encodeURIComponent(id)).then((d:Details)=>{if(!active)return;setData(d);setReceipt(p=>({...p,amount:getOutstandingAmount(d.transaction).toFixed(2),bankAccount:d.catalog.banks.includes(d.transaction.bankAccount)?d.transaction.bankAccount:''}));}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[id,api]);
 useEffect(()=>{const previous=document.activeElement as HTMLElement|null;dialog.current?.focus();return()=>previous?.focus();},[]);
 const submit=async()=>{
  if(!data||sending.current)return;sending.current=true;setBusy(true);setError('');
  const committing=Boolean(review);
  try{
   const result=await api(committing?'receipt/commit':'receipt/preview',{id,requestId,version:data.version,receipt,...(review?{confirmHash:review.reviewHash}:{})});
   if(committing){setData({...data,transaction:result.transaction});setSaved(true);setUncertain(false);AccumulatedBalancesService.invalidate();onSaved();}
   else setReview(result);
  }catch(e){const err=e as Error&{status?:number};setError(err.message);if(committing&&(!err.status||err.status>=500))setUncertain(true);else if(committing){setUncertain(false);setReview(null);}}
  finally{sending.current=false;setBusy(false);}
 };
 const field=(key:keyof Receipt,value:string)=>setReceipt(p=>({...p,[key]:value}));
 const row=data?.transaction;
 return <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-3" role="presentation"><div ref={dialog} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="receivable-title" className="sp-ui w-full max-w-2xl max-h-[90vh] overflow-auto rounded-2xl p-6" onKeyDown={e=>{
  if(e.key==='Escape'&&!busy&&!uncertain&&!correctionLocked)onClose();
  if(e.key==='Tab'){const controls=dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled)');if(!controls?.length)return;const first=controls[0],last=controls[controls.length-1];if(e.shiftKey&&(document.activeElement===first||document.activeElement===dialog.current)){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}}
 }}>
  <div className="flex justify-between items-start gap-4"><h2 id="receivable-title">Recebimentos da conta</h2><button className="sp-button" disabled={busy||uncertain||correctionLocked} onClick={onClose} aria-label="Fechar recebimentos">Fechar</button></div>
  <p className="sp-muted my-3">Registre valores já recebidos. Esta operação atualiza o Financeiro; não movimenta dinheiro nem cancela boletos no banco.</p>
  {error&&<p role="alert" className="my-3" style={{color:'var(--sp-danger)'}}>{error}</p>}
  {!data&&!error&&<p role="status">Consultando a conta…</p>}
  {row&&<>
   <section className="sp-card my-4"><h3 className="font-semibold">{row.client||row.description}</h3><p>Vencimento: {row.dueDate} · {row.status}</p><p>Valor original: {brl(getOriginalAmount(row))}</p><p>Recebido: {brl(getPaidAmount(row))} · Saldo: {brl(getOutstandingAmount(row))}</p></section>
   {data.canReverse&&row.receivableSettlement&&!saved&&<nav className="flex gap-2 my-3"><button className="sp-button" disabled={busy||uncertain||correctionLocked} onClick={()=>setMode('receipt')}>Registrar recebimento</button><button className="sp-button" disabled={busy||uncertain||correctionLocked} onClick={()=>setMode('reversal')}>Estornar baixa manual</button></nav>}
   {mode==='reversal'?<FinancialCorrection kind="reversal" id={id} version={data.version} row={row} api={api} onLock={setCorrectionLocked} onSaved={()=>{AccumulatedBalancesService.invalidate();onSaved();onClose();}}/>:saved?<p role="status" style={{color:'var(--sp-success)'}}>Recebimento registrado com histórico. {row.status==='Pago'?'Conta quitada.':'A conta permanece em aberto pelo saldo restante.'}</p>:data.blockedReason?<p role="status">{data.blockedReason}</p>:!data.canSettle?<p>Seu acesso permite consultar o histórico. Solicite ao administrador a permissão de registrar recebimentos.</p>:<form onSubmit={e=>{e.preventDefault();void submit();}}>
    {uncertain&&<p role="alert">A confirmação não chegou. Use o botão abaixo para consultar ou concluir a mesma tentativa, sem registrar outra baixa.</p>}
    <fieldset disabled={busy||Boolean(review)||uncertain} className="grid grid-cols-1 sm:grid-cols-2 gap-4">
     <label>Data do recebimento<input className="sp-field" required type="date" max={toLocalISODate(new Date())} value={receipt.date} onChange={e=>field('date',e.target.value)}/></label>
     <label>Valor recebido (R$)<input className="sp-field" required type="number" min="0.01" step="0.01" value={receipt.amount} onChange={e=>field('amount',e.target.value)}/></label>
     <label>Juros desta baixa (R$)<input className="sp-field" required type="number" min="0" step="0.01" value={receipt.interest} onChange={e=>field('interest',e.target.value)}/></label>
     <label>Desconto desta baixa (R$)<input className="sp-field" required type="number" min="0" step="0.01" value={receipt.discount} onChange={e=>field('discount',e.target.value)}/></label>
     <label>Conta que recebeu<select className="sp-field" required value={receipt.bankAccount} onChange={e=>field('bankAccount',e.target.value)}><option value="">Selecione</option>{data.catalog.banks.map(v=><option key={v} value={v}>{v}</option>)}</select></label>
     <label>Forma de recebimento<select className="sp-field" required value={receipt.method} onChange={e=>field('method',e.target.value)}><option value="">Selecione</option>{data.catalog.receiptMethods.map(v=><option key={v} value={v}>{v}</option>)}</select></label>
     <label className="sm:col-span-2">Observação / referência do comprovante<textarea className="sp-field" required minLength={5} maxLength={1000} value={receipt.note} onChange={e=>field('note',e.target.value)}/></label>
    </fieldset>
    {review&&<section className="sp-card my-4" aria-label="Revisão do recebimento"><h3 className="font-semibold">Confira antes de confirmar</h3><p>Recebimento: {brl(Number(receipt.amount))} em {receipt.date}</p><p>Juros: {brl(Number(receipt.interest))} · Desconto: {brl(Number(receipt.discount))}</p><p>Saldo após a baixa: {brl(getOutstandingAmount(review.after))}</p><p>{review.after.status==='Pago'?'A conta será quitada.':'A conta continuará pendente.'}</p></section>}
    <div className="flex flex-wrap gap-3 mt-4"><button className="sp-button sp-button-primary" disabled={busy}>{busy?'Aguarde…':uncertain?'Consultar resultado da tentativa':review?'Confirmar recebimento':'Revisar recebimento'}</button>{review&&!uncertain&&<button type="button" className="sp-button" disabled={busy} onClick={()=>setReview(null)}>Voltar e corrigir</button>}</div>
   </form>}
   {Boolean(row.receivableReceipts?.length)&&<section className="mt-6"><h3 className="font-semibold">Histórico de recebimentos</h3><p className="sp-muted">Filtros por data consideram a última baixa. Cada recebimento aparece abaixo.</p>{row.receivableReceipts!.map(p=><article key={p.requestId} className="sp-card my-3"><p>{row.receivableReversals?.some(r=>r.receiptRequestId===p.requestId)?'ESTORNADO · ':''}{p.date} · Recebido {brl(p.amountCents/100)} · Saldo {brl(p.remainingCents/100)}</p><p>Juros {brl(p.interestCents/100)} · Desconto {brl(p.discountCents/100)}</p><p>{p.bankAccount} · {p.method}</p><p>Registrado por {p.actor} · {p.note}</p></article>)}</section>}
   {!!row.receivableReversals?.length&&<section><h3>Histórico de estornos</h3>{row.receivableReversals.map(r=><p key={r.requestId}>{r.at} · {r.actor} · {brl(r.amountCents/100)} · {r.reason}</p>)}</section>}
  </>}
 </div></div>;
}
