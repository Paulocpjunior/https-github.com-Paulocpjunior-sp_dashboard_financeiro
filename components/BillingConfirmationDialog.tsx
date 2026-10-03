import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { ObligationReviewRow } from '../utils/billingObligations';
import { proposeChecklistTerms, validateMonthlyTerms, type MonthlyTerms, type SavedMonthlyTerms } from '../utils/billingConfirmation';
import { checklistEvent, checklistEventLabels } from '../utils/checklistStatus';
import { saveMonthlyTerms, saveIdentityLink, fetchMonthlyHistory, type IdentityLink } from '../services/billingConfirmationService';
import { createBillingOperationGate } from '../utils/billingAsync';
import { auth } from '../services/firebaseConfig';

export default function BillingConfirmationDialog({row,month,fingerprint,saved,isAdmin,onClose,onSaved,verifyCurrent,savedLink}:{row:ObligationReviewRow;month:string;fingerprint:string;saved?:SavedMonthlyTerms;isAdmin:boolean;onClose:()=>void;onSaved:()=>void;verifyCurrent?:()=>Promise<void>;savedLink?:IdentityLink}) {
  const proposals=useMemo(()=>row.checklist.map(r=>({id:r.submissionId,...proposeChecklistTerms(r.notes||'')})),[row]);
  const unique=(values:unknown[])=>[...new Set(values)];
  const amounts=unique([...row.checklist.filter(r=>r.amount!=null).map(r=>r.amount),...proposals.flatMap(p=>p.amounts.map(a=>a.value))]) as number[];
  const startDates=unique(proposals.flatMap(p=>p.startDates.map(d=>d.value))) as string[];
  const days=unique(proposals.flatMap(p=>p.days.map(d=>d.value))) as number[];
  const events=unique(row.checklist.map(r=>checklistEvent(r.status))) as string[];
  if(!events.length)events.push('recorrencia');
  const unresolved=row.situation==='identificacao';
  const [target,setTarget]=useState(savedLink?.targetIdentity||'');const [linkEvidence,setLinkEvidence]=useState(savedLink?.evidence||'');
  const [terms,setTerms]=useState<MonthlyTerms>({month,identity:row.identity,client:row.client,decision:'needs_review',amount:saved?.amount??(amounts.length===1?amounts[0]:null),dueDate:saved?.dueDate||'',startDate:saved?.startDate||(startDates.length===1?startDates[0]:''),billingDay:saved?.billingDay||(days.length===1?days[0]:0),lastChargeDate:saved?.lastChargeDate||'',evidence:saved?.evidence||'',event:events.length===1?events[0]:'multiplos',sourceFingerprint:fingerprint});
  const [history,setHistory]=useState<SavedMonthlyTerms[]>([]);
  const [historyBusy,setHistoryBusy]=useState(false);
  const [historyLoaded,setHistoryLoaded]=useState(false);
  const [historyError,setHistoryError]=useState('');
  const saveGate=useRef(createBillingOperationGate());
  const historyGate=useRef(createBillingOperationGate());
  useEffect(()=>{
    saveGate.current.activate();historyGate.current.activate();
    return ()=>{saveGate.current.dispose();historyGate.current.dispose();};
  },[]);
  const [checked,setChecked]=useState(false);const [busy,setBusy]=useState(false);const [error,setError]=useState('');
  const update=(key:keyof MonthlyTerms,value:unknown)=>{setTerms(t=>({...t,[key]:value}));setChecked(false);};
  const loadHistory=async()=>{
    const operation=historyGate.current.start();if(!operation)return;
    setHistoryBusy(true);setHistoryError('');setHistoryLoaded(false);setHistory([]);
    try{const result=await fetchMonthlyHistory(month,row.identity);if(operation.isCurrent()){setHistory(result);setHistoryLoaded(true);}}
    catch(e){if(operation.isCurrent())setHistoryError(e instanceof Error?e.message:'Não foi possível consultar o histórico.');}
    finally{if(operation.isCurrent())setHistoryBusy(false);operation.finish();}
  };
  const save=async()=>{const operation=saveGate.current.start();if(!operation)return;
    const user=auth.currentUser;
    const assertCurrent=()=>{operation.assertCurrent();if(!user||auth.currentUser!==user)throw new Error('Sessão alterada. Entre novamente antes de salvar.');};
    setError('');setBusy(true);try{
    assertCurrent();

    if(unresolved){if(!isAdmin)throw new Error('Somente administrador registra vínculo de identificação.');if(!/^(unidentified|checklist-unidentified):/.test(row.identity))throw new Error('Número ambíguo: corrigir os documentos na fonte antes de confirmar.');if(verifyCurrent)await verifyCurrent();assertCurrent();await saveIdentityLink({sourceIdentity:row.identity,targetIdentity:target,evidence:linkEvidence},savedLink?.revision||0,assertCurrent);}
    else {if(!checked)throw new Error('Confirme que revisou as informações e a evidência.');const errors=validateMonthlyTerms(terms,isAdmin);if(errors.length)throw new Error(errors.join(' '));if(verifyCurrent)await verifyCurrent();assertCurrent();await saveMonthlyTerms(terms,isAdmin,saved?.revision||0,assertCurrent);}
    if(operation.isCurrent())onSaved();
  }catch(e){if(operation.isCurrent())setError(e instanceof Error?e.message:'Não foi possível salvar.');}finally{if(operation.isCurrent())setBusy(false);operation.finish();}};
  const input='block w-full border rounded p-2 dark:bg-slate-950';
  return <div className="fixed inset-0 z-50 bg-black/60 overflow-y-auto p-4 flex items-start justify-center" role="dialog" aria-modal="true" aria-labelledby="confirm-heading"><div className="bg-white dark:bg-slate-900 rounded-xl p-5 max-w-3xl w-full space-y-4 my-6">
    <h2 id="confirm-heading" className="text-lg font-bold">Conferência de {row.client} • {month}</h2>
    <p className="text-sm">{row.identity}. Registro separado dos lançamentos. A confirmação registra obrigação para esta competência; não emite boleto nem aprova dispensa.</p>
    {saved&&<p className="text-sm">Última revisão: {saved.revision}, responsável {saved.actorUid}. {saved.sourceFingerprint!==fingerprint?'As fontes mudaram: a confirmação anterior exige nova revisão.':'Fontes correspondem à revisão salva.'}</p>}
    <details><summary>Propostas extraídas das observações — precisam de revisão</summary>{proposals.map(p=><div key={p.id} className="text-sm py-2"><strong>Resposta {p.id}</strong>{[...p.amounts,...p.documents,...p.startDates,...p.lastDates,...p.days].map((x,i)=><p key={i}>{x.excerpt}</p>)}</div>)}<p className="text-sm">Valor anterior de referência: {row.previousAmount.toLocaleString('pt-BR',{style:'currency',currency:'BRL'})}. Valores divergentes não são escolhidos automaticamente.</p></details>
    {saved&&<div className="text-sm" aria-busy={historyBusy}><button type="button" disabled={historyBusy||busy} className="underline disabled:opacity-50" onClick={()=>void loadHistory()}>{historyBusy?'Consultando histórico...':'Consultar histórico (até 50 revisões recentes)'}</button>{historyError&&<p role="alert" className="text-red-600">{historyError}</p>}{historyLoaded&&!history.length&&<p role="status">Nenhuma revisão retornada. Isso não comprova inexistência de histórico; confira o registro antes de concluir.</p>}{history.map(h=><details key={h.revision}><summary>Revisão {h.revision} • {h.decision==='charge'?'Obrigação confirmada':'Revisão pendente'} • {h.actorUid}</summary><p>Valor: {h.amount??'Não informado'}; vencimento: {h.dueDate||'Não informado'}.</p><p>{h.evidence}</p><p>Data: {(h.updatedAt as {seconds?:number})?.seconds?new Date(Number((h.updatedAt as {seconds:number}).seconds)*1000).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'}):'Indisponível'}</p></details>)}</div>}
    <fieldset disabled={busy} className="min-w-0 space-y-3">
    {unresolved?<div className="space-y-3"><p className="text-sm">Vincular somente com evidência inequívoca. Números associados a documentos diferentes exigem correção na fonte.</p><label className="block text-sm">Identificação comprovada<select className={input} value={target.startsWith('number:')?'number':'doc'} onChange={e=>setTarget(e.target.value+':'+(target.split(':')[1]||''))}><option value="doc">CPF / CNPJ</option><option value="number">Nosso Número</option></select><input className={input} value={target.split(':')[1]||''} onChange={e=>setTarget((target.startsWith('number:')?'number:':'doc:')+e.target.value.replace(/\D/g,''))} placeholder="Informe a identificação comprovada"/></label><label className="block text-sm">Evidência do vínculo<textarea className={input} maxLength={4000} value={linkEvidence} onChange={e=>setLinkEvidence(e.target.value)}/></label></div>:<>
      <div className="grid sm:grid-cols-2 gap-3">
        <label className="text-sm">Decisão<select className={input} value={terms.decision} onChange={e=>update('decision',e.target.value)}><option value="needs_review">Revisão pendente</option>{isAdmin&&<option value="charge">Confirmar obrigação de cobrança</option>}</select></label>
        <label className="text-sm">Evento válido para a competência<select className={input} value={terms.event} onChange={e=>update('event',e.target.value)}>{events.length>1&&<option value="multiplos">Confirmar evento e vigência</option>}{events.map(event=><option key={event} value={event}>{event==='recorrencia'?'Recorrência — comprovar contrato':checklistEventLabels[event as keyof typeof checklistEventLabels]}</option>)}</select></label>
        <label className="text-sm">Valor confirmado (R$)<input type="number" min="0.01" step="0.01" className={input} value={terms.amount??''} onChange={e=>update('amount',e.target.value===''?null:Number(e.target.value))}/></label>
        <label className="text-sm">Vencimento<input type="date" className={input} value={terms.dueDate} onChange={e=>update('dueDate',e.target.value)}/></label>
        <label className="text-sm">Início da responsabilidade<input type="date" className={input} value={terms.startDate} onChange={e=>update('startDate',e.target.value)}/></label>
        <label className="text-sm">Dia de cobrança (1 a 31)<input type="number" min="1" max="31" className={input} value={terms.billingDay||''} onChange={e=>update('billingDay',Number(e.target.value))}/></label>
        <label className="text-sm">Última cobrança devida<input type="date" className={input} value={terms.lastChargeDate} onChange={e=>update('lastChargeDate',e.target.value)}/></label>
      </div>
      <label className="block text-sm">Evidência / motivo da revisão<textarea className={input} maxLength={4000} value={terms.evidence} onChange={e=>update('evidence',e.target.value)} placeholder="Informe documento, resposta do checklist, condição e vigência conferidas."/></label>
      <label className="flex gap-2 text-sm"><input type="checkbox" checked={checked} onChange={e=>setChecked(e.target.checked)}/>Revisei os campos, o evento e a evidência desta competência.</label>
    </>}
    </fieldset>
    {error&&<p role="alert" className="text-red-600">{error}</p>}
    <div className="flex gap-3"><button disabled={busy} onClick={save} className="bg-blue-700 text-white px-4 py-2 rounded disabled:opacity-50">{busy?'Revalidando e salvando...':unresolved?'Registrar vínculo comprovado':'Salvar conferência'}</button><button disabled={busy} onClick={onClose}>Cancelar</button></div>
  </div></div>;
}
