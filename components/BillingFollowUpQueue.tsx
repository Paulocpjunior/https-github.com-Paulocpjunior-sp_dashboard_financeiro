import React,{useEffect,useRef,useState} from 'react';
import { fetchBillingTasks,fetchBillingTaskAssignees,saveBillingTask,fetchBillingTaskHistory } from '../services/billingTaskService';
import { billingTaskOverdue,type BillingTask,type SavedBillingTask } from '../utils/billingTasks';
import { createBillingOperationGate } from '../utils/billingAsync';
import { auth } from '../services/firebaseConfig';

export default function BillingFollowUpQueue({month,rows,isAdmin}:{month:string;rows:{identity:string;client:string}[];isAdmin:boolean}){
  const [tasks,setTasks]=useState<SavedBillingTask[]>([]),[assignees,setAssignees]=useState<{uid:string;name:string}[]>([]);
  const [editing,setEditing]=useState<{value:BillingTask;revision:number}|null>(null);
  const [loading,setLoading]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
  const [owner,setOwner]=useState(''),[status,setStatus]=useState('open'),[history,setHistory]=useState<{client:string;items:SavedBillingTask[]}|null>(null);
  const [historyBusy,setHistoryBusy]=useState(false);
  const requests=useRef(0),saveGate=useRef(createBillingOperationGate()),historyGate=useRef(createBillingOperationGate());
  const today=new Intl.DateTimeFormat('sv-SE',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const load=async()=>{
    const version=++requests.current;setLoading(true);setError('');setTasks([]);setAssignees([]);
    try{const [list,users]=await Promise.all([fetchBillingTasks(month),isAdmin?fetchBillingTaskAssignees():Promise.resolve([])]);if(version===requests.current){setTasks(list);setAssignees(users);}}
    catch(e){if(version===requests.current)setError(e instanceof Error?e.message:'Não foi possível consultar a fila.');}
    finally{if(version===requests.current)setLoading(false);}
  };
  useEffect(()=>{saveGate.current.activate();historyGate.current.activate();void load();return()=>{requests.current++;saveGate.current.dispose();historyGate.current.dispose();};},[month,isAdmin]);
  const begin=(identity:string)=>{
    const saved=tasks.find(t=>t.identity===identity),row=rows.find(r=>r.identity===identity);
    if(!saved&&!row)return;setMessage('');setHistory(null);
    setEditing({revision:saved?.revision||0,value:saved?{month:saved.month,identity:saved.identity,client:saved.client,assigneeUid:saved.assigneeUid,assigneeName:saved.assigneeName,deadline:saved.deadline,state:saved.state,evidence:''}:{month,identity,client:row!.client,assigneeUid:'',assigneeName:'',deadline:'',state:'open',evidence:''}});
  };
  const update=(patch:Partial<BillingTask>)=>setEditing(old=>old?{...old,value:{...old.value,...patch}}:null);
  const save=async()=>{
    if(!editing)return;const op=saveGate.current.start();if(!op)return;const user=auth.currentUser;
    const check=()=>{op.assertCurrent();if(!user||auth.currentUser!==user)throw new Error('Sessão alterada.');};
    setBusy(true);setError('');try{if(!isAdmin)throw new Error('Somente administrador altera o acompanhamento.');check();await saveBillingTask(editing.value,editing.revision,check);if(op.isCurrent()){setEditing(null);setMessage('Acompanhamento salvo com histórico. Nenhuma cobrança foi alterada.');await load();}}
    catch(e){if(op.isCurrent())setError(e instanceof Error?e.message:'Não foi possível salvar.');}
    finally{if(op.isCurrent())setBusy(false);op.finish();}
  };
  const showHistory=async(task:SavedBillingTask)=>{
    const op=historyGate.current.start();if(!op)return;setHistoryBusy(true);setHistory(null);setError('');
    try{const items=await fetchBillingTaskHistory(month,task.identity);if(op.isCurrent())setHistory({client:task.client,items});}
    catch(e){if(op.isCurrent())setError(e instanceof Error?e.message:'Falha no histórico.');}
    finally{if(op.isCurrent())setHistoryBusy(false);op.finish();}
  };
  const owners=[...new Map(tasks.map(t=>[t.assigneeUid,t.assigneeName])).entries()];
  const shown=tasks.filter(t=>(!owner||t.assigneeUid===owner)&&(!status||(status==='overdue'?billingTaskOverdue(t,today):t.state===status)));
  const input='block border rounded p-2 dark:bg-slate-950 w-full';
  return <section aria-labelledby="followup-heading" className="border rounded-lg p-4 space-y-3">
    <h3 id="followup-heading" className="font-semibold">Acompanhamento das pendências • {month}</h3>
    <p className="text-sm">Responsável e prazo definidos pela equipe. Concluir acompanhamento não dá baixa, não aprova dispensa e não libera fechamento mensal.</p>
    <button type="button" disabled={loading||busy} className="underline disabled:opacity-50" onClick={()=>{setEditing(null);void load();}}>Atualizar fila</button>
    {loading&&<p role="status">Consultando acompanhamento...</p>}{error&&<p role="alert" className="text-red-600">{error}</p>}{message&&<p role="status">{message}</p>}
    {!loading&&!error&&<>
      <p className="text-sm">{tasks.length} acompanhamentos registrados; {tasks.filter(t=>billingTaskOverdue(t,today)).length} com prazo anterior a hoje (Brasília). Não são vencimentos de cobrança.</p>
      {isAdmin&&<label className="block text-sm">Criar ou revisar acompanhamento<select className={input} value={editing?.value.identity||''} disabled={busy} onChange={e=>{if(e.target.value)begin(e.target.value);else setEditing(null);}}><option value="">Selecione um item da lista mensal</option>{rows.map(r=><option key={r.identity} value={r.identity}>{r.client} • {r.identity}</option>)}</select></label>}
      <div className="flex flex-wrap gap-3"><label>Responsável<select className={input} value={owner} onChange={e=>setOwner(e.target.value)}><option value="">Todos</option>{owners.map(([uid,name])=><option key={uid} value={uid}>{name}</option>)}</select></label><label>Acompanhamento<select className={input} value={status} onChange={e=>setStatus(e.target.value)}><option value="open">Em aberto</option><option value="overdue">Prazo ultrapassado</option><option value="done">Concluídos</option><option value="">Todos</option></select></label></div>
      {!shown.length&&<p>Nenhum acompanhamento neste filtro. Isso não comprova ausência de obrigações.</p>}
      {shown.map(t=><div key={t.identity} className="border-t py-2 text-sm"><strong>{t.client}</strong> • {t.identity}<p>{t.assigneeName} • Prazo: {t.deadline.split('-').reverse().join('/')} • {t.state==='done'?'Concluído':billingTaskOverdue(t,today)?'Prazo ultrapassado':'Em aberto'} • Revisão {t.revision}</p><p>{t.evidence}</p>{!rows.some(r=>r.identity===t.identity)&&<p>Item não localizado na leitura atual; acompanhamento preservado.</p>}{isAdmin&&<button disabled={busy} className="underline mr-3" onClick={()=>begin(t.identity)}>Revisar acompanhamento</button>}<button disabled={historyBusy||busy} className="underline" onClick={()=>void showHistory(t)}>Histórico do acompanhamento</button></div>)}
    </>}
    {editing&&<fieldset disabled={busy} className="border rounded p-3 space-y-2"><legend>{editing.value.client} • {editing.value.identity}</legend><label className="block">Responsável ativo<select className={input} value={editing.value.assigneeUid} onChange={e=>update({assigneeUid:e.target.value,assigneeName:assignees.find(u=>u.uid===e.target.value)?.name||''})}><option value="">Selecione</option>{!assignees.some(u=>u.uid===editing.value.assigneeUid)&&editing.value.assigneeUid&&<option value={editing.value.assigneeUid} disabled>{editing.value.assigneeName} — indisponível</option>}{assignees.map(u=><option key={u.uid} value={u.uid}>{u.name}</option>)}</select></label><label className="block">Prazo do acompanhamento<input className={input} type="date" value={editing.value.deadline} onChange={e=>update({deadline:e.target.value})}/></label><label className="block">Situação<select className={input} value={editing.value.state} onChange={e=>update({state:e.target.value as 'open'|'done'})}><option value="open">Em aberto</option><option value="done">Acompanhamento concluído</option></select></label><label className="block">Motivo da alteração / resultado<textarea className={input} maxLength={4000} value={editing.value.evidence} onChange={e=>update({evidence:e.target.value})}/></label><button className="bg-blue-700 text-white rounded px-3 py-2" onClick={()=>void save()}>{busy?'Salvando...':'Salvar acompanhamento'}</button><button className="ml-3" onClick={()=>setEditing(null)}>Cancelar</button></fieldset>}
    {historyBusy&&<p role="status">Consultando histórico do acompanhamento...</p>}
    {history&&<details open><summary>{history.client} — até 50 revisões recentes</summary>{history.items.map(h=><p key={h.revision}>Revisão {h.revision}: {h.assigneeName} • {h.deadline} • {h.state==='done'?'Concluído':'Em aberto'} • Autor: {h.actorUid} • {h.evidence}</p>)}<p>Todas as revisões permanecem armazenadas; esta consulta mostra as 50 mais recentes.</p></details>}
  </section>;
}
