import React, {useEffect, useState} from 'react';
import {auth} from '../firebase';
import BoletoReconciliation from './BoletoReconciliation';
type Candidate={id:string;name:string;cpfCnpj:string;dueDate:string;amountCents:number;receivedCents:number;paymentDate:string;method:string;bankAccount:string;status:string;differences:string[]};
type Row={eventId:string;fileId:string;boletoId:string;number:string;reason:string;paidCents:number;paymentDate:string;classification:string;truncated:boolean;candidates:Candidate[];record:null|{payerName:string;payerDocument:string;dueDate:string;amountCents:number}};
const money=(n:number)=>(n/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const date=(s:string)=>s?s.split('-').reverse().join('/'):'—';
export default function BoletoRetReview(){
 const [data,setData]=useState<{rows:Row[];nextCursor:string|null}|null>(null),[cursor,setCursor]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[selection,setSelection]=useState<{event:Row;candidate:Candidate}|null>(null),[revision,setRevision]=useState(0);
 useEffect(()=>{let live=true;setBusy(true);setError('');setSelection(null);setData(null);
 (async()=>{const user=auth.currentUser;if(!user)throw Error('Entre novamente.');const res=await fetch('/api/boleto-cloud/history/ret-review?'+new URLSearchParams({cursor}),{headers:{Authorization:`Bearer ${await user.getIdToken()}`}});const body=await res.json();if(!res.ok)throw Error(body.error||'Conferência indisponível.');if(live)setData(body);})().catch(e=>{if(live)setError(e.message);}).finally(()=>{if(live)setBusy(false);});return()=>{live=false;};},[cursor,revision]);
 const button='min-h-11 rounded-lg border px-3 py-2 disabled:opacity-40';
 return <section id="conferencia-ret" className="sp-tokens rounded-xl border p-5 space-y-4" aria-label="Conferência individual do RET" style={{borderColor:'var(--sp-border)',background:'var(--sp-surface)'}}>
 <h2 className="text-xl font-semibold">Conferência individual do RET</h2>
 <p>Compare cada liquidação com Contas a Receber. Sugestões não registram baixas. A confirmação consulta novamente o boleto e o lançamento.</p>
 <button className={button} disabled={busy} onClick={()=>{setCursor('');setRevision(x=>x+1);}}>Atualizar pendências</button>
 {busy&&<p role="status">Cruzando os recebimentos…</p>}{error&&<p role="alert">{error}</p>}
 {data?.rows.map(r=><article key={r.eventId} className="border rounded-lg p-4 space-y-3" style={{borderColor:'var(--sp-border)'}}>
 <h3 className="font-semibold">Boleto {r.number} · {r.record?.payerName||'Identificação pendente no histórico'}</h3>
 <p>{r.classification}</p><p>RET: {money(r.paidCents)} pagos em {date(r.paymentDate)} · CPF/CNPJ: {r.record?.payerDocument||'Não disponível'} · Vencimento: {date(r.record?.dueDate||'')}</p>
 <p className="text-sm break-all">Arquivo: {r.fileId} · Ocorrência: {r.eventId}</p>
 {!r.record&&<p>O boleto precisa ser incorporado ao histórico antes de permitir vínculo ou baixa. Não associe pelo nome ou pelo total do extrato.</p>}
 {r.truncated&&<p role="status">Consulta parcial. Há mais lançamentos; a lista não comprova correspondência única.</p>}
 <details><summary className="cursor-pointer">Ver {r.candidates.length} lançamento(s) candidato(s)</summary>
 <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr>{['Lançamento','Vencimento','Total','Recebido','Pagamento / método','Conferência'].map(x=><th className="p-2 text-left" key={x}>{x}</th>)}</tr></thead><tbody>{r.candidates.map(c=><tr key={c.id}><td className="p-2">{c.name}<br/>{c.cpfCnpj}<br/><small>{c.id}</small></td><td className="p-2">{date(c.dueDate)}</td><td className="p-2">{money(c.amountCents)}</td><td className="p-2">{money(c.receivedCents)} · {c.status}</td><td className="p-2">{date(c.paymentDate)}<br/>{c.method||'Método não informado'}<br/>{c.bankAccount||'Conta vazia — usar conta comprovada pelo RET na baixa'}</td><td className="p-2">{c.differences.map(d=><p key={d}>{d}</p>)}<button className={button} disabled={busy||!!c.differences.length} onClick={()=>setSelection({event:r,candidate:c})}>Revisar vínculo</button></td></tr>)}</tbody></table></div></details>
 {selection?.event.eventId===r.eventId&&<div><p className="font-semibold">Selecionado: {selection.candidate.name} · {selection.candidate.id}</p><BoletoReconciliation key={r.eventId+selection.candidate.id} boletoId={r.boletoId} retEventId={r.eventId} proposedTransactionId={selection.candidate.id}/><button className={button} onClick={()=>setSelection(null)}>Fechar conferência</button></div>}
 </article>)}
 {data&&!data.rows.length&&<p>Nenhuma pendência nesta página.</p>}
 <div className="flex gap-3"><button className={button} disabled={busy||!cursor} onClick={()=>setCursor('')}>Primeira página</button><button className={button} disabled={busy||!data?.nextCursor} onClick={()=>setCursor(data!.nextCursor!)}>Próximas pendências</button></div>
 </section>;
}
