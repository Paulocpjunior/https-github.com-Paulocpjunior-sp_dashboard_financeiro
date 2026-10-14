import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ReceivableGroups, ReceivableGroupList, ReceivableGroupPreview, StatementRequestError, StatementRow } from '../services/itauStatementService';
const money=(n:number)=>(n/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
export default function ReceivableBankGroup({statement,onClose}:{statement:StatementRow;onClose:()=>void}) {
  const [data,setData]=useState<ReceivableGroupList|null>(null),[selected,setSelected]=useState<string[]>([]);
  const [preview,setPreview]=useState<ReceivableGroupPreview|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
  const [reference,setReference]=useState(''),[checked,setChecked]=useState(false),[reason,setReason]=useState('');
  const generation=useRef(0),heading=useRef<HTMLHeadingElement>(null),inflight=useRef(false),requestId=useRef(crypto.randomUUID());
  async function run(action:()=>Promise<void>) {
    if(inflight.current)return;
    inflight.current=true;setBusy(true);setError('');const version=generation.current;
    try{await action();}catch(e){if(version===generation.current){if(e instanceof StatementRequestError && [401,403].includes(e.status)){setData(null);setPreview(null);setSelected([]);}setError(e instanceof Error?e.message:'Não foi possível conferir o grupo.');}}
    finally{if(version===generation.current){inflight.current=false;setBusy(false);}}
  }
  async function reload(){const version=generation.current;const next=await ReceivableGroups.list(statement.id);if(version===generation.current){setData(next);setSelected([]);setPreview(null);setChecked(false);requestId.current=crypto.randomUUID();}}
  useEffect(()=>{generation.current++;inflight.current=false;heading.current?.focus();void run(reload);return()=>{generation.current++;};},[statement.id]);
  const rows=data?.payments||[],members=rows.filter(r=>selected.includes(r.boletoId)&&r.transactionId).map(r=>({boletoId:r.boletoId,transactionId:r.transactionId!}));
  const total=rows.filter(r=>selected.includes(r.boletoId)).reduce((n,r)=>n+r.amountCents,0),difference=statement.amountCents-total;
  return <section className="sp-ui" aria-labelledby="receivable-group-title"><div className="sp-card space-y-4">
    <div className="flex justify-between gap-4"><h2 id="receivable-group-title" ref={heading} tabIndex={-1}>Composição do crédito de boletos</h2><button className="sp-button" disabled={busy} onClick={onClose}>Fechar</button></div>
    <button className="sp-button" disabled={busy} onClick={()=>void run(reload)}>Atualizar composição</button>
    <p>{statement.date.split('-').reverse().join('/')} · {statement.fitid} · <strong>{money(statement.amountCents)}</strong></p>
    <p>Confira o detalhamento bancário do lote e selecione cada boleto que o compõe. A mesma data e a soma dos valores não comprovam, sozinhas, a composição. Esta confirmação vincula baixas existentes ao extrato; não registra outra receita.</p>
    {error&&<p role="alert">{error}</p>}{message&&<p role="status">{message}</p>}{busy&&<p role="status">Conferindo…</p>}
    {data?.link?.active ? <>
      <p role="status"><strong>{data.link.validation==='current'?'Composição conciliada':'Composição requer revisão: uma fonte mudou'}</strong> · Referência: {data.link.reference}</p>
      <ul>{data.link.payments.map(p=><li key={p.boletoId}>{p.name} · Boleto {p.number} · {money(p.amountCents)}</li>)}</ul>
      {data.canConfirm&&<><label className="block">Motivo para desfazer somente a conciliação<input className="sp-field" value={reason} disabled={busy} onChange={e=>{setReason(e.target.value);requestId.current=crypto.randomUUID();}}/></label>
      <button className="sp-button" disabled={busy||reason.trim().length<10} onClick={()=>void run(async()=>{await ReceivableGroups.unlink({statementId:statement.id,revision:data.link!.revision,requestId:requestId.current,reason});setMessage('Vínculo desfeito. As baixas individuais foram preservadas.');await reload();})}>Desfazer vínculo do grupo</button></>}
    </> : data && <>
      <p><strong>{rows.length} boletos com crédito nesta data</strong>. Boletos sem data de crédito confirmada não podem compor este lote. Nenhuma seleção é automática.</p>
      {!rows.length&&<p role="status">Não há detalhamento suficiente no histórico consultado. Consulte o retorno individual no Boleto Cloud ou obtenha no Itaú o relatório de boletos liquidados que compõe este crédito. Não registre o total como recebimento de um único cliente.</p>}
      <div className="overflow-x-auto"><table className="w-full text-sm text-left"><thead><tr>{['Selecionar','Cliente / boleto','Pagamento / crédito','Recebido','Conferência'].map(t=><th className="p-3" key={t}>{t}</th>)}</tr></thead><tbody>{rows.map(r=><tr key={r.boletoId}><td className="p-3"><input type="checkbox" aria-label={`Incluir boleto ${r.number} de ${r.name}`} checked={selected.includes(r.boletoId)} disabled={busy||!r.eligible||!data.canConfirm} onChange={e=>{setSelected(old=>e.target.checked?[...old,r.boletoId]:old.filter(id=>id!==r.boletoId));setPreview(null);setChecked(false);requestId.current=crypto.randomUUID();}}/></td><td className="p-3">{r.name}<br/>{r.payerDocument} · Boleto {r.number}</td><td className="p-3 whitespace-nowrap">{r.paidAt}<br/>{r.creditedAt}</td><td className="p-3 whitespace-nowrap">{money(r.amountCents)}</td><td className="p-3 min-w-64">{r.reason}</td></tr>)}</tbody></table></div>
      <p>Selecionado: <strong>{money(total)}</strong> · Diferença para o crédito: <strong>{money(difference)}</strong></p>
      <p>Se houver diferença, confira boletos faltantes, tarifas e datas no detalhamento. O sistema não estima rateios nem cria juros ou descontos para fechar o lote.</p>
      <Link className="sp-button" to="/boletos">Conferir boletos e vínculos individuais</Link>
      {data.canConfirm&&<button className="sp-button sp-button-primary" disabled={busy||!members.length||difference!==0} onClick={()=>void run(async()=>{const version=generation.current;const value=await ReceivableGroups.preview(statement.id,members);if(version===generation.current){setPreview(value);setChecked(false);requestId.current=crypto.randomUUID();}})}>Revisar composição</button>}
      {preview&&<div className="space-y-3"><h3 className="font-semibold">Confirmar conciliação de {preview.members.length} baixas individuais</h3>
        <p>Total conferido: {money(preview.totalCents)}. As baixas permanecem nos respectivos clientes.</p>
        <label className="block">Referência do relatório / detalhamento bancário do lote<input className="sp-field" value={reference} disabled={busy} maxLength={1000} onChange={e=>{setReference(e.target.value);requestId.current=crypto.randomUUID();}}/></label>
        <label className="block"><input type="checkbox" checked={checked} disabled={busy} onChange={e=>setChecked(e.target.checked)}/> Conferi no detalhamento bancário que todos os boletos selecionados pertencem a este crédito.</label>
        <button className="sp-button sp-button-primary" disabled={busy||!checked||reference.trim().length<5} onClick={()=>void run(async()=>{await ReceivableGroups.confirm({statementId:statement.id,members:preview.members,revision:preview.revision,fingerprint:preview.fingerprint,requestId:requestId.current,reference,checkedEvidence:checked,reason:'Composição conferida com detalhamento bancário individual.'});setMessage('Crédito conciliado com as baixas individuais. Nenhuma nova receita foi criada.');await reload();})}>Confirmar vínculo com o extrato</button>
      </div>}
    </>}
  </div></section>;
}
