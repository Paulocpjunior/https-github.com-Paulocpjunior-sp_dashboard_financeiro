import React,{useEffect,useRef,useState} from 'react';
import CommunicationQueue from './CommunicationQueue';
import {auth} from '../services/firebaseConfig';
export type CommunicationConfig={revision:number;offsets:number[];payableRecipients:string[];sender:string;replyTo:string;enabled:false;channel:{configured:boolean};activationAvailable:false};
export type CommunicationApi=(body?:unknown)=>Promise<CommunicationConfig>;
export const communicationRequest:CommunicationApi=async body=>{
 if(!auth.currentUser)throw Error('Entre novamente.');
 const r=await fetch('/api/financial-entries/communication-settings',{method:body?'POST':'GET',headers:{Authorization:`Bearer ${await auth.currentUser.getIdToken()}`,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
 const data=await r.json();if(!r.ok)throw Error(data.error||'Configuração indisponível.');return data;
};
export default function CommunicationSettings({api=communicationRequest,onBusy}:{api?:CommunicationApi;onBusy?:(busy:boolean)=>void}){
 const [data,setData]=useState<CommunicationConfig|null>(null),[days,setDays]=useState(''),[emails,setEmails]=useState(''),[reason,setReason]=useState(''),[review,setReview]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
 const [queueBusy,setQueueBusy]=useState(false);
 const mounted=useRef(true),gate=useRef(false);
 const apply=(d:CommunicationConfig)=>{setData(d);setDays(d.offsets.join(', '));setEmails(d.payableRecipients.join('\n'));setReview(false);};
 const toggle=(b:boolean)=>{setBusy(b);onBusy?.(b||queueBusy);};
 async function load(){if(gate.current)return;gate.current=true;toggle(true);setError('');try{const d=await api();if(mounted.current){apply(d);setMessage('');}}catch(e){if(mounted.current)setError((e as Error).message);}finally{gate.current=false;if(mounted.current)toggle(false);}}
 useEffect(()=>{mounted.current=true;void load();return()=>{mounted.current=false;};},[]);
 const field='block w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 p-3 mt-1';
 async function submit(e:React.FormEvent){e.preventDefault();if(gate.current||!data)return;setError('');setMessage('');
 const tokens=days.split(',').map(v=>v.trim());const offsets=tokens.map(Number);
 const payableRecipients=emails.split(/[\n;,]+/).map(v=>v.trim()).filter(Boolean);
 if(tokens.some(v=>! /^-?\d+$/.test(v))||offsets.length>5||offsets.some(n=>n< -30||n>0)||new Set(offsets).size!==offsets.length){setError('Informe de um a cinco dias distintos entre -30 e 0, separados por vírgula.');return;}
 if(payableRecipients.length>20||payableRecipients.some(v=>v.length>254||! /^[^\s<>@,;]+@[^\s<>@,;]+\.[^\s<>@,;]+$/.test(v))){setError('Confira os e-mails internos, no máximo 20.');return;}
 if(!review){setReview(true);return;}gate.current=true;toggle(true);
 try{const next=await api({revision:data.revision,offsets,payableRecipients,reason,enabled:false});if(mounted.current){apply(next);setReason('');setMessage('Configuração salva com histórico. Envio automático continua desativado.');}}
 catch(e){if(mounted.current){setError((e as Error).message+' Recarregue para conferir antes de repetir.');setReview(false);}}
 finally{gate.current=false;if(mounted.current)toggle(false);}
 }
 return <><fieldset disabled={queueBusy}><form onSubmit={submit} className="space-y-4">
 <div className="rounded-xl border border-amber-300 bg-amber-50 text-amber-950 p-4"><strong>Envio automático desativado</strong><p className="mt-1 text-sm">Prepare os parâmetros. Salvar não envia mensagens nem ativa agendamentos.</p></div>
 {error&&<p role="alert" className="rounded-lg bg-red-50 text-red-900 p-3">{error}</p>}{message&&<p role="status" className="rounded-lg bg-green-50 text-green-900 p-3">{message}</p>}
 <div className="text-sm space-y-1"><p><strong>Remetente e respostas:</strong> {data?.sender||'financeiro@spassessoriacontabil.com.br'}</p><p><strong>Canal Microsoft 365:</strong> {!data?'Consultando…':data.channel.configured?'Credenciais configuradas. Confira os resultados dos testes e do acompanhamento antes de ativar a automação.':'Credenciais do Financeiro ainda não configuradas.'}</p></div>
 <label className="block">Dias dos lembretes em relação ao vencimento<input className={field} required value={days} placeholder="Ex.: -3, 0" disabled={busy||review||!data} onChange={e=>setDays(e.target.value)}/><span className="text-sm text-slate-500">-3 = três dias antes; 0 = no vencimento. Até cinco etapas, às 09h de Brasília (12h UTC). Cobrança após o vencimento ainda não disponível.</span></label>
 <label className="block">Destinatários internos — contas a pagar<textarea className={field} rows={3} value={emails} placeholder="Um e-mail por linha" disabled={busy||review||!data} onChange={e=>setEmails(e.target.value)}/><span className="text-sm text-slate-500">Você define quem acompanha os vencimentos. Estes endereços não são usados para enviar cobranças aos clientes.</span></label>
 <p className="text-sm">Contas a receber: o destinatário deverá ser conferido por cobrança antes da ativação. O boleto PDF e o demonstrativo de extras, quando houver, deverão acompanhar o convite.</p>
 <label className="block">Motivo da configuração<textarea className={field} required minLength={5} maxLength={500} value={reason} disabled={busy||review||!data} onChange={e=>setReason(e.target.value)}/></label>
 {review&&<div className="border rounded-lg p-3"><strong>Conferir antes de salvar</strong><p>Etapas: {days}. Destinatários internos: {emails.trim()||'Nenhum definido'}.</p><p>Envio permanece desativado.</p></div>}
 <div className="flex flex-wrap gap-3"><button className="rounded-lg bg-blue-600 text-white px-4 py-3" disabled={busy||!data}>{busy?'Aguarde…':review?'Confirmar configuração':'Revisar configuração'}</button><button type="button" className="border rounded-lg px-4 py-3" disabled={busy} onClick={()=>review?setReview(false):void load()}>{review?'Voltar':'Recarregar configuração'}</button></div>
 </form></fieldset><fieldset disabled={busy}><CommunicationQueue onBusy={b=>{setQueueBusy(b);onBusy?.(b||busy);}}/></fieldset></>;
}
