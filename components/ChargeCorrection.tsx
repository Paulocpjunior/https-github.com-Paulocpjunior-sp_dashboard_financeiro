import React, {useRef, useState} from 'react';
import {Transaction} from '../types';
import {getOriginalAmount} from '../utils/transactionAmounts';

type Item = {account:string;amount:string};
type Props = {id:string;version:string;row:Transaction;extras:string[];api:(path:string,body?:any)=>Promise<any>;onSaved:()=>void;onLock:(locked:boolean)=>void};
const brl=(n:number)=>n.toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const toCents=(v:string)=>/^\d{1,8}(\.\d{1,2})?$/.test(v)?Math.round(Number(v)*100):0;
// Edits honorários and extra services of an open native receivable; the backend recalculates the total and keeps the history.
export default function ChargeCorrection({id,version,row,extras,api,onSaved,onLock}:Props){
 const [honorarios,setHonorarios]=useState(Number(row.honorarios??getOriginalAmount(row)).toFixed(2));
 const [items,setItems]=useState<Item[]>(()=>(row.extraItems||[]).map(i=>({account:i.account,amount:Number(i.amount).toFixed(2)})));
 const [reason,setReason]=useState(''),[review,setReview]=useState<any>(null),[busy,setBusy]=useState(false),[uncertain,setUncertain]=useState(false),[error,setError]=useState('');
 const attempt=useRef(crypto.randomUUID()),gate=useRef(false);
 const edit=(fn:()=>void)=>{fn();setReview(null);attempt.current=crypto.randomUUID();};
 const setItem=(index:number,patch:Partial<Item>)=>edit(()=>setItems(list=>list.map((item,i)=>i===index?{...item,...patch}:item)));
 const total=(toCents(honorarios)+items.reduce((sum,i)=>sum+toCents(i.amount),0))/100;
 async function submit(){
  if(gate.current)return;gate.current=true;setBusy(true);onLock(true);setError('');
  const committing=Boolean(review);let keepLocked=false;
  try{
   const result=await api(`charge/${committing?'commit':'preview'}`,{id,version,requestId:attempt.current,charge:{honorarios,extraItems:items,reason},...(review?{confirmHash:review.reviewHash}:{})});
   if(committing){setUncertain(false);onSaved();}else setReview(result);
  }catch(e){const err=e as Error&{status?:number};setError(err.message);keepLocked=committing&&(!err.status||err.status>=500);setUncertain(keepLocked);if(!keepLocked)setReview(null);}
  finally{gate.current=false;setBusy(false);onLock(keepLocked);}
 }
 return <section className="sp-card my-4" aria-label="Correção de valores">
  <h3 className="font-semibold">Corrigir valores e extras</h3>
  <p className="my-2">Ajusta honorários e serviços extras de conta em aberto, sem recebimento e sem boleto emitido. Os valores anteriores, o motivo, o autor e o horário ficam no histórico.</p>
  <form onSubmit={e=>{e.preventDefault();void submit();}}>
   <fieldset disabled={busy||uncertain||Boolean(review)} className="space-y-3">
    <label className="block">Honorários (R$)<input className="sp-field" type="number" step="0.01" min="0" required value={honorarios} onChange={e=>edit(()=>setHonorarios(e.target.value))}/></label>
    {items.map((item,index)=><div key={index} className="grid grid-cols-1 sm:grid-cols-[1fr_10rem_auto] gap-2 items-end">
     <label className="block">Serviço extra<select className="sp-field" required value={item.account} onChange={e=>setItem(index,{account:e.target.value})}><option value="">Selecione</option>{[...new Set([...extras,...(item.account&&!extras.includes(item.account)?[item.account]:[])])].map(x=><option key={x} value={x}>{x}</option>)}</select></label>
     <label className="block">Valor (R$)<input className="sp-field" type="number" step="0.01" min="0.01" required value={item.amount} onChange={e=>setItem(index,{amount:e.target.value})}/></label>
     <button type="button" className="sp-button" onClick={()=>edit(()=>setItems(list=>list.filter((_,i)=>i!==index)))}>Remover</button>
    </div>)}
    {items.length<30&&<button type="button" className="sp-button" onClick={()=>edit(()=>setItems(list=>[...list,{account:'',amount:''}]))}>Adicionar valor extra</button>}
    <p>Novo total: <strong>{brl(total)}</strong></p>
    <label className="block">Motivo da correção<textarea className="sp-field" required minLength={10} maxLength={2000} value={reason} onChange={e=>edit(()=>setReason(e.target.value))}/></label>
   </fieldset>
   {review&&<div className="my-3" role="status"><p>Valor da cobrança: {brl(getOriginalAmount(row))} → {brl(getOriginalAmount(review.after))}</p>{!!review.after.extraItems?.length&&<p>Extras: {review.after.extraItems.map((i:{account:string;amount:number})=>`${i.account} ${brl(i.amount)}`).join(' · ')}</p>}<p>Situação após a confirmação: {review.after.status}</p><p>Motivo: {reason}</p></div>}
   {error&&<p role="alert">{error}</p>}{uncertain&&<p role="alert">Resposta não confirmada. Consulte a mesma tentativa antes de sair ou iniciar outra operação.</p>}
   <button className="sp-button sp-button-primary mt-3" disabled={busy}>{busy?'Aguarde…':uncertain?'Consultar resultado da tentativa':review?'Confirmar alteração':'Revisar correção de valores'}</button>
   {review&&!uncertain&&<button className="sp-button ml-2" type="button" disabled={busy} onClick={()=>edit(()=>{})}>Voltar e corrigir</button>}
  </form>
 </section>;
}
