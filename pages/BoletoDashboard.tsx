import React, { useEffect, useRef, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { doc, onSnapshot } from 'firebase/firestore';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { ReceiptText, RefreshCw, Download, Search } from 'lucide-react';
import Layout from '../components/Layout';
import { auth, db } from '../firebase';

type Summary = { count:number; amountCents:number; paidCents:number; payers:number; beneficiaries:number; unidentifiedBeneficiaries:number };
type Boleto = { id:string; createdAt:string; bank:string; number:string; document:string; payerDocument:string; payerName:string; amountCents:number; dueDate:string;
  paidCents:number|null; paidAt:string|null; creditedAt:string|null; cancelledAt:string|null; cancellationReason:string; cancellationDescription:string;
  beneficiaryDocument:string; beneficiaryName:string; registeredAt:string|null; protestedAt:string|null; registrationStatus?:string; registrationError?:unknown;
  protestStatus?:string; protestDescription?:string; paymentOrigin?:string; manuallyPaid?:boolean; detailsSource:string; syncedAt:string|null; status:string; overdue:boolean };
type Result = { today:string; month:string; page:number; pages:number; selected:Summary; metrics:Record<string,Summary>; rows:Boleto[];
  automation?:{state:string;lastSuccessAt:string|null;finishedAt:string|null;settlementEnabled:boolean;stale:boolean;attentionCount:number;attention:{number:string;reason:string;checkedAt:string}[]}|null;
  beneficiaries:{document:string;name:string}[]; source:{exportedAt:string;count:number;snapshot:string} };
const money=(n:number)=> (n/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const date=(s:string|null)=>s?s.split('-').reverse().join('/'):'—';
const today=()=>new Date().toLocaleDateString('en-CA',{timeZone:'America/Sao_Paulo'});
const card='rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-5';
const input='rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-950 px-3 py-2 text-slate-900 dark:text-white';
const button='rounded-lg bg-blue-700 px-4 py-2 text-white font-semibold disabled:opacity-40 disabled:cursor-not-allowed';
const labels:Record<string,string>={all:'Todos os boletos',open:'Em aberto — total',overdue:'Em atraso — total',createdToday:'Criados hoje',dueToday:'Vencendo hoje',paidToday:'Pagos hoje',
  createdMonth:'Criados no mês',dueMonth:'Vencendo no mês',openMonth:'Em aberto no mês',overdueMonth:'Em atraso no mês',paidMonth:'Pagos no mês',cancelled:'Baixados da cobrança'};
function Counts({value}:{value:Summary}) {
  return <p className="text-xs text-slate-500 mt-2">{value.count.toLocaleString('pt-BR')} boletos · {value.payers} pagadores · {value.unidentifiedBeneficiaries?'Beneficiário pendente de identificação':`${value.beneficiaries} beneficiários`}</p>;
}
export default function BoletoDashboard() {
  const [access,setAccess]=useState({ready:false,allowed:false});
  const [month,setMonth]=useState(()=>today().slice(0,7)),[beneficiary,setBeneficiary]=useState(''),[view,setView]=useState('dueMonth');
  const [query,setQuery]=useState(''),[search,setSearch]=useState(''),[page,setPage]=useState(1),[revision,setRevision]=useState(0);
  const [result,setResult]=useState<Result|null>(null),[busy,setBusy]=useState(false),[action,setAction]=useState(''),[error,setError]=useState('');
  const [selected,setSelected]=useState<Boleto|null>(null);
  const epoch=useRef(0), requests=useRef(0);
  useEffect(()=>{
    let stop=()=>{};
    const unsub=onAuthStateChanged(auth,user=>{
      stop();epoch.current++;setResult(null);setSelected(null);setAccess({ready:!user,allowed:false});
      if(user)stop=onSnapshot(doc(db,'users',user.uid),snap=>{
        epoch.current++;setResult(null);setSelected(null);
        const p=snap.data();setAccess({ready:true,allowed:p?.active===true && !['blocked','deleted'].includes(p?.status) && (p?.role==='admin'||p?.financialPermissions?.includes('billing.boleto-cloud.history.read'))});
      },()=>{epoch.current++;setResult(null);setSelected(null);setAccess({ready:true,allowed:false});});
    });
    return()=>{epoch.current++;stop();unsub();};
  },[]);
  async function request(path:string,method='GET') {
    const user=auth.currentUser;if(!user)throw new Error('Entre novamente para consultar.');
    const response=await fetch(`/api/boleto-cloud/history${path}`,{method,headers:{Authorization:`Bearer ${await user.getIdToken()}`}});
    if(!response.ok){const body=await response.json();if([401,403].includes(response.status)){setResult(null);setSelected(null);}throw new Error(body.error||'Consulta indisponível.');}
    return response;
  }
  useEffect(()=>{
    if(!access.allowed)return;
    const current=++requests.current, generation=epoch.current;let live=true;
    setBusy(true);setError('');setResult(null);
    const params=new URLSearchParams({month,beneficiary,view,q:search,page:String(page)});
    request(`?${params}`).then(r=>r.json()).then(data=>{if(live&&current===requests.current&&generation===epoch.current)setResult(data);})
      .catch(e=>{if(live&&generation===epoch.current)setError(e.message);}).finally(()=>{if(live)setBusy(false);});
    return()=>{live=false;};
  },[access,month,beneficiary,view,search,page,revision]);
  async function act(row:Boleto,operation:'sync'|'pdf') {
    const generation=epoch.current;setAction(row.id);setError('');
    try {
      const response=await request(`/${row.id}/${operation}`,operation==='sync'?'POST':'GET');
      if(generation!==epoch.current)return;
      if(operation==='sync'){setSelected(null);setRevision(n=>n+1);}
      else{const blob=await response.blob();if(generation!==epoch.current)return;const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=`boleto-${row.number.replace(/[^\w-]/g,'')}.pdf`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
    }catch(e){if(generation===epoch.current)setError(e instanceof Error?e.message:'Consulta não concluída.');}
    finally{setAction('');}
  }
  function choose(value:string){setView(value);setPage(1);setSearch('');setQuery('');setTimeout(()=>document.getElementById('historico-boletos')?.scrollIntoView({behavior:'smooth'}),0);}
  const charts=result?[['openMonth','#2563eb','Em aberto'],['overdueMonth','#e11d48','Em atraso'],['paidMonth','#059669','Pago']].map(([key,color,name])=>({name,color,count:result.metrics[key].count,value:result.metrics[key].amountCents/100})):[];
  const metric=(key:string)=>result&&<div key={key} className={card}><h3 className="text-sm font-semibold text-slate-500">{labels[key]}</h3><p className="text-2xl font-bold mt-2">{money(result.metrics[key].amountCents)}</p><Counts value={result.metrics[key]}/><button className="text-blue-600 dark:text-blue-400 mt-3 text-sm underline" onClick={()=>choose(key)}>Consultar {labels[key].toLowerCase()}</button></div>;
  return <Layout><div className="space-y-6 text-slate-900 dark:text-slate-100">
    <header className="flex flex-wrap gap-4 justify-between"><div><h1 className="text-2xl font-bold flex gap-2 items-center"><ReceiptText/>Boletos Boleto Cloud</h1><p className="text-slate-500 mt-1">Histórico do emissor · Valores em reais</p></div><a className="text-blue-600 underline self-center" href="https://app.boletocloud.com/" target="_blank" rel="noreferrer">Abrir Boleto Cloud</a></header>
    {!access.ready?<p>Verificando acesso…</p>:!access.allowed?<p role="alert" className={card}>Seu usuário não tem permissão para consultar o histórico Boleto Cloud.</p>:<>
      <div className={`${card} flex flex-wrap gap-4 items-end`}><label>Mês de referência<input aria-label="Mês de referência" type="month" value={month} onChange={e=>{setMonth(e.target.value);setPage(1);}} className={`${input} block mt-1`}/></label>
        <label>Beneficiário<select aria-label="Beneficiário" value={beneficiary} onChange={e=>{setBeneficiary(e.target.value);setPage(1);}} className={`${input} block mt-1 max-w-full`}><option value="">Todos os beneficiários</option>{result?.beneficiaries.map(b=><option key={b.document} value={b.document}>{b.name} — {b.document}</option>)}</select></label>
        <button className={button} disabled={busy||!!action} onClick={()=>setRevision(n=>n+1)}><RefreshCw className="inline h-4 w-4 mr-2"/>Recarregar histórico</button></div>
      <p className="text-sm text-slate-500">A carga histórica inclui boletos emitidos no painel e pelo CSV antigo. Novos boletos criados fora do app exigem nova importação do relatório. “Atualizar situação” consulta o emissor para o boleto escolhido. Essa consulta individual não altera os lançamentos de Contas a Receber.</p>
      {error&&<p role="alert" className="rounded-lg bg-red-50 text-red-800 p-4">{error}</p>}
      {busy&&<p role="status">Consultando histórico…</p>}
      {result&&<>
        <section className={card} aria-label="Retorno bancário automático"><h2 className="font-semibold">Retorno bancário automático</h2>
          <p className="text-sm mt-2">{!result.automation?'A rotina automática ainda não registrou uma execução.':result.automation.stale?'A rotina está sem execução recente. Verifique o processamento antes de considerar os saldos atualizados.':result.automation.state==='error'?'A última execução apresentou falha; os lançamentos afetados foram preservados.':result.automation.state==='running'?'Consulta automática em andamento.':'Última consulta automática concluída.'}</p>
          {result.automation&&<p className="text-sm mt-2">Última execução sem falhas: {result.automation.lastSuccessAt?new Date(result.automation.lastSuccessAt).toLocaleString('pt-BR'):'Ainda não registrada'}. Baixa automática: {result.automation.settlementEnabled?'habilitada para recebíveis nativos vinculados, com pagamento bancário integral conferido':'desativada'}.</p>}
          <p className="text-xs text-slate-500 mt-2">A confirmação depende do retorno do banco ao Boleto Cloud. Boletos históricos sem vínculo explícito, pagamentos manuais, valores divergentes e lançamentos alterados exigem revisão.</p>
          {!!result.automation?.attentionCount&&<div role="status" className="mt-3 text-sm"><p className="font-semibold">{result.automation.attentionCount} boleto(s) precisam de atenção.</p><ul className="mt-2 space-y-2">{result.automation.attention.map((r,i)=><li key={i}>Boleto {r.number}: {r.reason} · {new Date(r.checkedAt).toLocaleString('pt-BR')}</li>)}</ul>{result.automation.attentionCount>30&&<p>Exibindo os primeiros 30 registros.</p>}</div>}
        </section>
        <p className="text-xs text-slate-500">Relatório de {new Date(result.source.exportedAt).toLocaleString('pt-BR')} · {result.source.count.toLocaleString('pt-BR')} boletos importados. Situações atualizadas individualmente indicam a data da consulta nos detalhes.</p>
        <h2 className="text-xl font-semibold">Total</h2><div className="grid sm:grid-cols-2 gap-4">{metric('open')}{metric('overdue')}</div>
        <h2 className="text-xl font-semibold">Hoje — {date(result.today)}</h2><div className="grid lg:grid-cols-3 gap-4">{['createdToday','dueToday','paidToday'].map(metric)}</div>
        <h2 className="text-xl font-semibold">Resumo do mês — {result.month.split('-').reverse().join('/')}</h2><div className="grid sm:grid-cols-2 gap-4">{['createdMonth','dueMonth'].map(metric)}</div>
        <div className="grid lg:grid-cols-2 gap-4">{(['count','value'] as const).map(key=><section className={card} key={key}><h3 className="font-semibold mb-4">Boletos por situação — {key==='count'?'quantidade':'valor nominal (R$)'}</h3><div className="h-56"><ResponsiveContainer width="100%" height="100%"><BarChart data={charts}><XAxis dataKey="name"/><YAxis width={85} tickFormatter={n=>Number(n).toLocaleString('pt-BR')}/><Tooltip formatter={n=>key==='count'?n:Number(n).toLocaleString('pt-BR',{style:'currency',currency:'BRL'})}/><Bar dataKey={key}>{charts.map(v=><Cell key={v.name} fill={v.color}/>)}</Bar></BarChart></ResponsiveContainer></div></section>)}</div>
        <p className="text-xs text-slate-500">Em atraso faz parte de Em aberto. Pagos no mês considera a data do pagamento e o valor nominal do boleto, conforme o painel do emissor. O valor efetivamente pago aparece no histórico.</p>
        <div className="grid lg:grid-cols-3 gap-4">{['openMonth','overdueMonth','paidMonth'].map(metric)}</div>
        <section id="historico-boletos" className={card}><h2 className="text-xl font-semibold mb-4">Histórico de boletos</h2><div className="flex flex-wrap gap-3 mb-4"><select aria-label="Consulta do histórico" className={input} value={view} onChange={e=>{setView(e.target.value);setPage(1);}}>{Object.entries(labels).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select>
          <form className="flex gap-2 flex-wrap" onSubmit={e=>{e.preventDefault();setSearch(query);setPage(1);}}><input aria-label="Pesquisar boletos" className={input} placeholder="Pagador, CPF/CNPJ, nosso número ou documento" value={query} onChange={e=>setQuery(e.target.value)}/><button className={button}><Search className="h-4 w-4 inline mr-1"/>Pesquisar</button></form></div>
          <div className="mb-4 text-sm">{result.selected.count.toLocaleString('pt-BR')} boletos · Valor nominal: <strong>{money(result.selected.amountCents)}</strong> · Efetivamente pago: <strong>{money(result.selected.paidCents)}</strong></div>
          <div className="overflow-x-auto"><table className="w-full text-sm text-left"><thead><tr>{['Criado em','Beneficiário / Banco','Nosso número / Documento','Pagador','Valor','Vencimento','Situação','Pagamento / Pago','Crédito','Baixa','Ações'].map(x=><th key={x} className="px-3 py-3 whitespace-nowrap bg-slate-100 dark:bg-slate-800">{x}</th>)}</tr></thead><tbody>{result.rows.map(row=><tr key={row.id} className="border-t border-slate-200 dark:border-slate-800"><td className="p-3 whitespace-nowrap">{date(row.createdAt)}</td><td className="p-3 min-w-48">{row.beneficiaryName}<div className="text-xs text-slate-500">{row.beneficiaryDocument} · {row.bank}</div></td><td className="p-3">{row.number}<div className="text-xs text-slate-500">{row.document}</div></td><td className="p-3 min-w-56">{row.payerName}<div className="text-xs text-slate-500">{row.payerDocument}</div></td><td className="p-3 whitespace-nowrap">{money(row.amountCents)}</td><td className="p-3 whitespace-nowrap">{date(row.dueDate)}</td><td className="p-3 whitespace-nowrap">{row.status==='paid'?'Pago':row.status==='cancelled'?'Baixado':row.overdue?'Em atraso':'Em aberto'}</td><td className="p-3 whitespace-nowrap">{date(row.paidAt)}<div>{row.paidCents===null?'—':money(row.paidCents)}</div></td><td className="p-3 whitespace-nowrap">{date(row.creditedAt)}</td><td className="p-3 whitespace-nowrap">{date(row.cancelledAt)}</td><td className="p-3"><button className="text-blue-600 underline" onClick={()=>setSelected(row)}>Detalhes</button></td></tr>)}</tbody></table></div>
          {!result.rows.length&&<p className="py-6">Nenhum boleto corresponde aos filtros.</p>}<div className="flex gap-4 items-center justify-end mt-4"><button className={button} disabled={result.page<=1} onClick={()=>setPage(result.page-1)}>Anterior</button><span>{result.page} de {result.pages}</span><button className={button} disabled={result.page>=result.pages} onClick={()=>setPage(result.page+1)}>Próxima</button></div>
        </section></>}
      {selected&&<div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"><section role="dialog" aria-modal="true" aria-labelledby="boleto-detail-title" className={`${card} max-w-2xl w-full max-h-[90vh] overflow-auto space-y-4`}><div className="flex justify-between gap-4"><h2 id="boleto-detail-title" className="font-bold text-xl">Boleto {selected.number}</h2><button aria-label="Fechar detalhes" onClick={()=>setSelected(null)}>Fechar</button></div><p>{selected.payerName} · {selected.payerDocument}</p><p>{money(selected.amountCents)} · Vencimento {date(selected.dueDate)}</p><p>Beneficiário: {selected.beneficiaryName}</p>
        <dl className="grid grid-cols-2 gap-3 text-sm"><dt>Registro</dt><dd>{selected.detailsSource==='api'?(selected.registrationStatus||'Não informado'):'Não consta no relatório; consulte a situação'}</dd><dt>Data do registro</dt><dd>{date(selected.registeredAt)}</dd><dt>Protesto</dt><dd>{selected.detailsSource==='api'?`${selected.protestStatus || 'Sem protesto informado'} · ${date(selected.protestedAt)} ${selected.protestDescription || ''}`:'Não consta no relatório'}</dd><dt>Pagamento</dt><dd>{date(selected.paidAt)} · {selected.paidCents===null?'—':money(selected.paidCents)}</dd><dt>Origem do pagamento</dt><dd>{selected.manuallyPaid?'Marcação manual':selected.paymentOrigin || 'Não informada'}</dd><dt>Crédito</dt><dd>{date(selected.creditedAt)}</dd><dt>Baixa</dt><dd>{date(selected.cancelledAt)} {selected.cancellationReason} {selected.cancellationDescription}</dd></dl>
        <p className="text-xs text-slate-500">{selected.syncedAt?`Consultado no emissor em ${new Date(selected.syncedAt).toLocaleString('pt-BR')}`:'Dados da carga histórica. Consulte o emissor para obter a situação atual.'}</p>
        <div className="flex flex-wrap gap-3"><button className={button} disabled={!!action} onClick={()=>act(selected,'sync')}><RefreshCw className="inline h-4 w-4 mr-2"/>{action?'Consultando…':'Atualizar situação'}</button><button className={button} disabled={!!action} onClick={()=>act(selected,'pdf')}><Download className="inline h-4 w-4 mr-2"/>Baixar PDF</button></div>{error&&<p role="alert" className="text-red-600">{error}</p>}</section></div>}
    </>}
  </div></Layout>;
}
