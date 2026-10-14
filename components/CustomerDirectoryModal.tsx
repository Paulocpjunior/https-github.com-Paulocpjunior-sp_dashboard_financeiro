import React,{useEffect,useRef,useState} from 'react';
import {customerApi,CustomerProfile} from '../services/customerDirectory';
import {toLocalISODate} from '../utils/dateUtils';
import '../design-system/tokens.css';
type Customer={key:string;transactionId:string;source:CustomerProfile;sourceSystem:string;canonicalKey:string;profile:CustomerProfile;linked:boolean;count:number};
export default function CustomerDirectoryModal({onClose,api=customerApi}:{onClose:()=>void;api?:typeof customerApi}){
 const dialog=useRef<HTMLDialogElement>(null),gate=useRef(false),attempt=useRef(crypto.randomUUID());
 const [month,setMonth]=useState(toLocalISODate(new Date()).slice(0,7)),[data,setData]=useState<{revision:number;customers:Customer[]}|null>(null),[search,setSearch]=useState(''),[selected,setSelected]=useState<Customer|null>(null),[target,setTarget]=useState(''),[action,setAction]=useState('edit'),[profile,setProfile]=useState<CustomerProfile>({client:'',cpfCnpj:'',clientNumber:''}),[reason,setReason]=useState(''),[review,setReview]=useState<any>(null),[busy,setBusy]=useState(false),[uncertain,setUncertain]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
 async function load(){setBusy(true);setError('');setData(null);setSelected(null);setReview(null);try{setData(await api('list?month='+month));}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 useEffect(()=>{dialog.current?.showModal();void load();},[]);
 function edit(fn:()=>void){fn();setReview(null);attempt.current=crypto.randomUUID();setMessage('');}
 async function submit(){if(!selected||!data||gate.current)return;gate.current=true;setBusy(true);setError('');const committing=Boolean(review);
  try{const result=await api(committing?'commit':'preview',{requestId:attempt.current,revision:data.revision,sourceId:selected.transactionId,targetId:action==='merge'?target:undefined,action,profile:action==='edit'?profile:undefined,reason,...(review?{confirmHash:review.reviewHash}:{})});
   if(committing){setUncertain(false);setMessage('Cadastro atualizado com histórico. Atualize o painel para consultar a identificação atual. Valores e baixas foram preservados.');attempt.current=crypto.randomUUID();await load();}else setReview(result);
  }catch(e){const err=e as Error&{status?:number};setError(err.message);const unknown=committing&&(!err.status||err.status>=500);setUncertain(unknown);if(!unknown)setReview(null);}finally{gate.current=false;setBusy(false);}
 }
 return <dialog ref={dialog} className="sp-ui m-auto w-[min(1000px,95vw)] max-h-[90vh] overflow-auto rounded-2xl p-6" onCancel={e=>{e.preventDefault();if(!busy&&!uncertain)onClose();}} aria-labelledby="customer-directory-title">
  <div className="flex justify-between gap-4"><h2 id="customer-directory-title">Cadastros de clientes</h2><button className="sp-button" disabled={busy||uncertain} onClick={onClose}>Fechar</button></div>
  <p className="my-3">Revise os clientes com vencimentos no mês selecionado. A correção de nome e os vínculos são aplicados à consulta do histórico e à Base de Faturamento. Os registros financeiros originais são preservados.</p>
  <p className="sp-muted">E-mails e documentos bancários continuam usando os dados do Boleto Cloud ou Wix. Esta tela não altera esses serviços. Unificar clientes não exclui cobranças duplicadas.</p>
  <fieldset disabled={busy||uncertain} className="flex gap-3 my-4"><label>Mês de vencimento<input className="sp-field" type="month" value={month} onChange={e=>{setMonth(e.target.value);setData(null);setSelected(null);setReview(null);}}/></label><button className="sp-button" onClick={()=>void load()}>Consultar cadastros</button></fieldset>
  {message&&<p role="status">{message}</p>}{error&&<p role="alert">{error}</p>}{busy&&!data&&<p role="status">Consultando…</p>}
  {data&&<><label>Buscar cliente, documento ou número<input className="sp-field" value={search} disabled={busy||uncertain} onChange={e=>setSearch(e.target.value)}/></label>
  <div className="max-h-64 overflow-auto my-3"><table className="w-full text-left"><thead><tr><th>Cliente / identificação</th><th>Origem</th><th>Lançamentos</th><th>Ação</th></tr></thead><tbody>{data.customers.filter(c=>JSON.stringify([c.profile,c.source]).toLowerCase().includes(search.toLowerCase())).map(c=><tr key={c.key}><td className="p-2">{c.profile.client}<br/><small>{c.profile.cpfCnpj||'Sem documento'} · Nº {c.profile.clientNumber||'não informado'}{c.linked?' · Vinculado':''}</small></td><td>{c.sourceSystem}</td><td>{c.count}</td><td><button className="sp-button" disabled={busy||uncertain} onClick={()=>edit(()=>{setSelected(c);setProfile(c.profile);setTarget('');setAction('edit');setReason('');})}>Gerenciar</button></td></tr>)}</tbody></table></div>
  {selected&&<section className="sp-card"><h3>{selected.source.client}</h3><p className="sp-muted">Identificação original: {selected.source.cpfCnpj||'Sem documento'} · Nº {selected.source.clientNumber||'não informado'}</p>
   <form onSubmit={e=>{e.preventDefault();void submit();}}><fieldset disabled={busy||uncertain||Boolean(review)} className="space-y-3">
    <label className="block">Operação<select className="sp-field" value={action} onChange={e=>edit(()=>setAction(e.target.value))}><option value="edit">Corrigir nome do cadastro</option><option value="merge">Unificar com cadastro identificado</option>{selected.linked&&<option value="unlink">Desfazer vínculo deste registro</option>}</select></label>
    {action==='edit'&&<label className="block">Nome do cliente<input className="sp-field" required minLength={3} maxLength={300} value={profile.client} onChange={e=>edit(()=>setProfile({...profile,client:e.target.value}))}/></label>}
    {action==='merge'&&<label className="block">Cadastro de destino<select className="sp-field" required value={target} onChange={e=>edit(()=>setTarget(e.target.value))}><option value="">Selecione o cadastro correto</option>{data.customers.filter(c=>c.canonicalKey!==selected.canonicalKey).map(c=><option key={c.key} value={c.transactionId}>{c.profile.client} · {c.profile.cpfCnpj||'sem documento'} · Nº {c.profile.clientNumber||'—'}</option>)}</select></label>}
    <label className="block">Justificativa e evidência<textarea className="sp-field" required minLength={10} maxLength={2000} value={reason} onChange={e=>edit(()=>setReason(e.target.value))}/></label>
   </fieldset>
   {review&&<section className="my-3" role="status"><h4>Confira a identificação resultante</h4><p>{review.after.client} · {review.after.cpfCnpj||'Sem documento'} · Nº {review.after.clientNumber||'não informado'}</p><p>O vínculo alcança o histórico da mesma identificação. Nenhum valor, vencimento, recebimento ou boleto será apagado.</p></section>}
   {uncertain&&<p role="alert">Confirmação sem resposta. Consulte a mesma tentativa antes de sair.</p>}
   <button className="sp-button sp-button-primary mt-3" disabled={busy}>{busy?'Aguarde…':uncertain?'Consultar resultado da tentativa':review?'Confirmar cadastro':'Revisar alteração'}</button>
   {review&&!uncertain&&<button className="sp-button ml-2" type="button" disabled={busy} onClick={()=>edit(()=>{})}>Voltar e corrigir</button>}
   </form>
  </section>}
  <p className="my-3 sp-muted">Cadastros com histórico não são apagados nesta tela. A exclusão de um lançamento financeiro exige análise própria; não use exclusão para unificar clientes.</p></>}
 </dialog>;
}
