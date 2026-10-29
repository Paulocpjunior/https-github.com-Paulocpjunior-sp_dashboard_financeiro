import React, {useRef, useState} from 'react';
import {Transaction} from '../types';
import {getOriginalAmount, getOutstandingAmount, getPaidAmount} from '../utils/transactionAmounts';

type Props = {kind:'reversal'|'reopen'|'invoice'|'dueDate';id:string;version:string;row:Transaction;api:(path:string,body?:any)=>Promise<any>;onSaved:()=>void;onLock:(locked:boolean)=>void;hint?:string};
const brl=(n:number)=>n.toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const br=(d?:string)=>d?d.split('-').reverse().join('/'):'não informado';
export default function FinancialCorrection({kind,id,version,row,api,onSaved,onLock,hint}:Props){
 const [reason,setReason]=useState(''),[amount,setAmount]=useState(getOriginalAmount(row).toFixed(2)),[dueDate,setDueDate]=useState(row.dueDate||''),[review,setReview]=useState<any>(null),[busy,setBusy]=useState(false),[uncertain,setUncertain]=useState(false),[error,setError]=useState('');
 const attempt=useRef(crypto.randomUUID()),gate=useRef(false);
 const edit=(fn:()=>void)=>{fn();setReview(null);attempt.current=crypto.randomUUID();};
 async function submit(){
  if(gate.current)return;gate.current=true;setBusy(true);onLock(true);setError('');
  const committing=Boolean(review);let keepLocked=false;
  try{
   const result=await api(`${kind==='dueDate'?'due-date':kind}/${committing?'commit':'preview'}`,{id,version,requestId:attempt.current,...(kind==='invoice'?{invoice:{amount,reason}}:kind==='dueDate'?{amendment:{dueDate,reason}}:{reason}),...(review?{confirmHash:review.reviewHash}:{})});
   if(committing){setUncertain(false);onSaved();}else setReview(result);
  }catch(e){const err=e as Error&{status?:number};setError(err.message);keepLocked=committing&&(!err.status||err.status>=500);setUncertain(keepLocked);if(!keepLocked)setReview(null);}
  finally{gate.current=false;setBusy(false);onLock(keepLocked);}
 }
 return <section className="sp-card my-4" aria-label={kind==='invoice'?'Correção da fatura':kind==='dueDate'?'Correção do vencimento':kind==='reopen'?'Reabertura de conta quitada':'Estorno de recebimento'}>
  <h3 className="font-semibold">{kind==='invoice'?'Corrigir valor da fatura':kind==='dueDate'?'Corrigir vencimento':kind==='reopen'?'Reabrir conta quitada':'Estornar última baixa manual'}</h3>
  <p className="my-2">{hint?hint:kind==='invoice'?'Corrige o valor da obrigação, sem lançar juros ou descontos. Contas com baixas ativas precisam ser estornadas antes.':kind==='reopen'?`A baixa desta conta (pago em ${br(row.paymentDate)}, ${brl(getPaidAmount(row))}) foi registrada fora da tela de recebimentos. Reabrir volta a conta para pendente e guarda a baixa anterior no histórico. Depois, corrija o vencimento ou o valor se precisar e registre o recebimento com a data certa. Não altera o banco.`:kind==='dueDate'?'Corrige o vencimento lançado errado. Só vale para conta em aberto, sem recebimento e sem boleto emitido; o vencimento anterior fica no histórico.':'O recebimento original permanece no histórico. Após o estorno, reabra a conta e registre o recebimento com a data correta. Não altera o banco.'}</p>
  <form onSubmit={e=>{e.preventDefault();void submit();}}>
   <fieldset disabled={busy||uncertain||Boolean(review)} className="space-y-3">
    {kind==='invoice'&&<label className="block">Valor correto da fatura (R$)<input className="sp-field" type="number" step="0.01" min="0.01" required value={amount} onChange={e=>edit(()=>setAmount(e.target.value))}/></label>}
    {kind==='dueDate'&&<label className="block">Vencimento correto<input className="sp-field" type="date" required value={dueDate} onChange={e=>edit(()=>setDueDate(e.target.value))}/></label>}
    <label className="block">{kind==='invoice'?'Motivo e referência da fatura':kind==='dueDate'?'Motivo da correção':kind==='reopen'?'Motivo da reabertura':'Motivo do estorno'}<textarea className="sp-field" required minLength={10} maxLength={2000} value={reason} onChange={e=>edit(()=>setReason(e.target.value))}/></label>
   </fieldset>
   {review&&<div className="my-3" role="status"><p>{kind==='invoice'?`Valor da fatura: ${brl(getOriginalAmount(row))} → ${brl(getOriginalAmount(review.after))}`:kind==='dueDate'?`Vencimento: ${br(row.dueDate)} → ${br(review.after.dueDate)}`:`Saldo: ${brl(getOutstandingAmount(row))} → ${brl(getOutstandingAmount(review.after))}`}</p><p>Situação após a confirmação: {review.after.status}</p><p>Motivo: {reason}</p></div>}
   {error&&<p role="alert">{error}</p>}{uncertain&&<p role="alert">Resposta não confirmada. Consulte a mesma tentativa antes de sair ou iniciar outra operação.</p>}
   <button className="sp-button sp-button-primary mt-3" disabled={busy}>{busy?'Aguarde…':uncertain?'Consultar resultado da tentativa':review?'Confirmar alteração':kind==='invoice'?'Revisar correção da fatura':kind==='dueDate'?'Revisar correção do vencimento':kind==='reopen'?'Revisar reabertura':'Revisar estorno'}</button>
   {review&&!uncertain&&<button className="sp-button ml-2" type="button" disabled={busy} onClick={()=>edit(()=>{})}>Voltar e corrigir</button>}
  </form>
 </section>;
}
