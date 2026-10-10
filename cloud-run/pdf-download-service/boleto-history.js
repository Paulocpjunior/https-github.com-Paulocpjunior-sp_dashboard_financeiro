const { eligible, amount, money } = require('./boleto-cloud');
const { InviteError, prepareInvite, sendInvite } = require('./boleto-invite');
const { createHash } = require('node:crypto');
const { permitted } = require('./itau-statements');
const idFor = token => createHash('sha256').update(token).digest('hex');
const day = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const isDate = s => /^\d{4}-\d{2}-\d{2}$/.test(s || '') && !Number.isNaN(Date.parse(s)) && new Date(s).toISOString().slice(0,10) === s;
class HistoryError extends Error { constructor(message, status = 400) { super(message); this.status = status; } }
function statusOf(r) { return r.paidAt ? 'paid' : r.cancelledAt ? 'cancelled' : 'open'; }
function totals(rows) {
  return { count: rows.length, amountCents: rows.reduce((n,r) => n+r.amountCents,0), paidCents: rows.reduce((n,r) => n+(r.paidCents || 0),0),
    payers: new Set(rows.map(r=>r.payerDocument).filter(Boolean)).size,
    beneficiaries: new Set(rows.map(r=>r.beneficiaryDocument).filter(Boolean)).size,
    unidentifiedBeneficiaries: rows.filter(r=>!r.beneficiaryDocument).length };
}
function selections(rows, month, today) {
  const opened = r => statusOf(r) === 'open';
  const dueMonth = r => r.dueDate?.startsWith(month);
  return {
    all: rows, open: rows.filter(opened), overdue: rows.filter(r=>opened(r) && r.dueDate<today),
    createdToday: rows.filter(r=>r.createdAt===today), dueToday: rows.filter(r=>r.dueDate===today), paidToday: rows.filter(r=>r.paidAt===today),
    createdMonth: rows.filter(r=>r.createdAt?.startsWith(month)), dueMonth: rows.filter(dueMonth),
    openMonth: rows.filter(r=>opened(r) && dueMonth(r)), overdueMonth: rows.filter(r=>opened(r) && dueMonth(r) && r.dueDate<today),
    paidMonth: rows.filter(r=>r.paidAt?.startsWith(month)), cancelled: rows.filter(r=>statusOf(r)==='cancelled'),
  };
}
function report(rows, params, today = day()) {
  const month = params.get('month') || today.slice(0,7);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new HistoryError('Mês inválido.');
  const beneficiary = params.get('beneficiary') || '';
  const scoped = rows.filter(r=>!beneficiary || r.beneficiaryDocument===beneficiary);
  const groups = selections(scoped, month, today), view = params.get('view') || 'dueMonth';
  if (!Object.hasOwn(groups,view)) throw new HistoryError('Consulta inválida.');
  const text = (params.get('q') || '').trim().toLocaleLowerCase('pt-BR').slice(0,200);
  const filtered = groups[view].filter(r=>!text || [r.payerName,r.payerDocument,r.number,r.document].join(' ').toLocaleLowerCase('pt-BR').includes(text));
  filtered.sort((a,b)=>(b.dueDate || '').localeCompare(a.dueDate || '') || a.id.localeCompare(b.id));
  const page = Number(params.get('page') || 1);
  if (!Number.isSafeInteger(page) || page<1) throw new HistoryError('Página inválida.');
  const pages = Math.max(1,Math.ceil(filtered.length/30)), current = Math.min(page,pages);
  return { today, month, view, page:current, pages, selected:totals(filtered), metrics:Object.fromEntries(Object.entries(groups).map(([k,v])=>[k,totals(v)])),
    beneficiaries:[...new Map(rows.filter(r=>r.beneficiaryDocument).map(r=>[r.beneficiaryDocument,{document:r.beneficiaryDocument,name:r.beneficiaryName}])).values()],
    rows:filtered.slice((current-1)*30,current*30).map(({token,...r})=>({...r,status:statusOf(r),overdue:statusOf(r)==='open' && r.dueDate<today})) };
}
function validateImport(input) {
  if (input?.schemaVersion!==1 || input.environment!=='production' || !Array.isArray(input.records) || !input.records.length || input.records.length>100000)
    throw new HistoryError('Histórico inválido.');
  const seen=new Set();
  for(const r of input.records) {
    if (!/^[A-Za-z0-9_=\-]{10,200}$/.test(r.token || '') || seen.has(r.token) || !isDate(r.createdAt) || !isDate(r.dueDate) ||
      !Number.isSafeInteger(r.amountCents) || r.amountCents<0 || !/^\d{14}$/.test(r.beneficiaryDocument || '') || !r.payerName ||
      (r.paidCents!==null && (!Number.isSafeInteger(r.paidCents) || r.paidCents<0)) ||
      ['paidAt','creditedAt','cancelledAt'].some(k=>r[k]!==null && !isDate(r[k]))) throw new HistoryError('Registro incompleto, repetido ou inválido.');
    seen.add(r.token);
  }
  if (!Number.isFinite(Date.parse(input.exportedAt))) throw new HistoryError('Data da carga inválida.');
  for (const [fingerprint, account] of Object.entries(input.issuanceAccounts || {})) {
    if (!/^[a-f0-9]{64}$/.test(fingerprint) || !/^\d{14}$/.test(account.beneficiaryDocument || '') || !account.beneficiaryName || !/^\d{3}$/.test(account.bank || '')) throw new HistoryError('Vínculo de beneficiário inválido.');
  }
  const computed=totals(input.records);
  for(const key of ['count','amountCents','paidCents']) if(computed[key]!==input.totals?.[key]) throw new HistoryError('Totais de controle divergentes.');
  if (!Array.isArray(input.sources) || input.sources.reduce((n,s)=>n+s.count,0)!==computed.count || input.sources.some(s=>!/^[a-f0-9]{64}$/.test(s.sha256))) throw new HistoryError('Fontes incompletas.');
  return computed;
}
function mergeSituation(old, body, at) {
  const b=body?.boleto;
  if (!b || b.token!==old.token || !['PAGO','BAIXADO','EM_ABERTO'].includes(b.situacao) || !isDate(b.vencimento) || !Number.isFinite(b.valor)) throw new HistoryError('Resposta inconsistente do emissor.',502);
  const date = v => v == null ? null : isDate(v) ? v : (()=>{throw new HistoryError('Data inválida no emissor.',502);})();
  const paidAt=date(b.pagamento?.data), cancelledAt=date(b.baixa?.dataBanco || b.baixa?.dataSistema);
  if ((b.situacao==='PAGO' && !paidAt) || (b.situacao==='BAIXADO' && !cancelledAt) || (b.pagamento?.valor!=null && !Number.isFinite(b.pagamento.valor))) throw new HistoryError('Situação incompleta no emissor.',502);
  return {...old, number:String(b.numero || old.number),document:String(b.documento || ''), amountCents:Math.round(b.valor*100),dueDate:b.vencimento,
    payerName:b.pagador?.nome || old.payerName,payerDocument:String(b.pagador?.cprf || old.payerDocument).replace(/\D/g,''),
    paidAt,paidCents:b.pagamento?.valor==null?null:Math.round(b.pagamento.valor*100), creditedAt:date(b.pagamento?.dataCredito),cancelledAt,
    registeredAt:date(b.registro?.data),registrationStatus:b.registro?.situacao || null,registrationError:b.registro?.erro || null,
    cancellationReason:b.baixa?.motivo || '',cancellationDescription:b.baixa?.descricao || '',
    protestedAt:date(b.protesto?.dataBanco || b.protesto?.dataSistema),protestStatus:b.protesto?.situacao || null,
    protestDescription:b.protesto?.descricao || '',paymentOrigin:b.pagamento?.origem || null,manuallyPaid:b.pagamento?.marcadoComoPago === true, detailsSource:'api',syncedAt:at};
}
function createHistoryHandler({getServices, sendJson, env=process.env, fetchImpl=fetch}) {
  let cached=null;
  async function load(db) {
    const pointer=(await db.collection('boletoHistory').doc('production').get()).data();
    if(!pointer?.snapshot) throw new HistoryError('Histórico ainda não importado.',503);
    if(!cached || cached.snapshot!==pointer.snapshot || Date.now()-cached.at>30000) {
      const ref=db.collection('boletoHistorySnapshots').doc(pointer.snapshot);
      const meta=(await ref.get()).data();
      if(!meta?.complete) throw new HistoryError('Importação ainda não concluída.',503);
      const chunks=await ref.collection('chunks').get();
      const rows=chunks.docs.flatMap(d=>d.data().records).map(r=>({...r,id:idFor(r.token)}));
      if(rows.length!==meta.totals.count) throw new HistoryError('Histórico incompleto. Atualização interrompida.',503);
      const changes=await db.collection('boletoHistoryUpdates').get();
      const updates=new Map(changes.docs.map(d=>[d.id,d.data()]));
      const merged=rows.map(r=>updates.get(r.id)?.syncedAt>meta.exportedAt?{...r,...updates.get(r.id).record}:r);
      const known=new Set(rows.map(r=>r.token));
      const issued=await db.collection('boletoIssues').where('environment','==','production').get();
      for(const d of issued.docs) {
        const issue=d.data(), f=issue.fields || {};
        if(issue.state!=='issued' || !issue.token)continue;
        if(known.has(issue.token)){
          const imported=merged.find(r=>r.token===issue.token);
          if(imported && issue.transactionId)imported.transactionId=issue.transactionId;
          continue;
        }
        known.add(issue.token);
        const account=meta.issuanceAccounts?.[issue.accountFingerprint];
        const id=idFor(issue.token), row={id,token:issue.token,transactionId:issue.transactionId || null,createdAt:f['boleto.emissao'],dueDate:f['boleto.vencimento'],
          amountCents:Math.round(Number(f['boleto.valor'])*100),number:issue.number || '',document:f['boleto.documento'] || '',
          payerName:f['boleto.pagador.nome'],payerDocument:String(f['boleto.pagador.cprf']||'').replace(/\D/g,''),
          bank:account?.bank || '',beneficiaryDocument:account?.beneficiaryDocument || null,beneficiaryName:account?.beneficiaryName || 'Emissão pelo app — beneficiário a conferir',paidAt:null,paidCents:null,creditedAt:null,
          cancelledAt:null,cancellationReason:'',cancellationDescription:'',registeredAt:issue.registration?.registeredAt || null,protestedAt:null,detailsSource:'app',syncedAt:null};
        if(!isDate(row.createdAt)||!isDate(row.dueDate)||!Number.isSafeInteger(row.amountCents))throw new HistoryError('Emissão recente com dados incompletos.',503);
        merged.push({...row,...updates.get(id)?.record,transactionId:issue.transactionId || null});
      }
      cached={snapshot:pointer.snapshot,at:Date.now(),rows:merged,meta};
    }
    return cached;
  }
  return async (req,res)=>{
    const url=new URL(req.url,'http://localhost');
    if(!url.pathname.startsWith('/api/boleto-cloud/history')) return false;
    try {
      const {adminAuth,adminDb:db}=getServices();
      const bearer=String(req.headers.authorization||'').match(/^Bearer (\S+)$/);
      if(!bearer) throw new HistoryError('Entre novamente para consultar boletos.',401);
      let uid;try{uid=(await adminAuth.verifyIdToken(bearer[1],true)).uid;}catch{throw new HistoryError('Sessão expirada.',401);}
      const profile=db.collection('users').doc(uid);
      const allowed=p=>permitted(p,'billing.boleto-cloud.history.read');
      const recheck=async()=>{if(!allowed((await profile.get()).data()))throw new HistoryError('Sem permissão para consultar o histórico Boleto Cloud.',403);};
      await recheck();
      if(env.BOLETO_CLOUD_ENVIRONMENT!=='production')throw new HistoryError('Histórico disponível somente na configuração de produção.',503);
      const data=await load(db);
      if(req.method==='GET' && url.pathname==='/api/boleto-cloud/history') {
        const result=report(data.rows,url.searchParams);
        const job=(await db.collection('boletoReturnJobs').doc('production').get()).data();
        const issues=await db.collection('boletoIssues').where('environment','==','production').get();
        const attention=issues.docs.map(d=>{const r=d.data();return {number:r.number || 'Emissão sem número',state:r.returnSync?.state,reason:r.returnSync?.reason,checkedAt:r.returnSync?.checkedAt};})
          .filter(r=>['review','error'].includes(r.state));
        const automation=job?{state:job.state,lastSuccessAt:job.lastSuccessAt || null,finishedAt:job.finishedAt || null,
          settlementEnabled:job.settlementEnabled===true,counts:job.counts || null,
          stale:!job.startedAt || Date.now()-Date.parse(job.startedAt)>45*60*1000,
          attentionCount:attention.length,attention:attention.slice(0,30)}:null;
        const historyJob=(await db.collection('boletoReturnJobs').doc('history-production').get()).data();
        const historyAutomation=historyJob?{state:historyJob.state,lastSuccessAt:historyJob.lastSuccessAt || null,
          lastCycleSuccessfulAt:historyJob.lastCycleSuccessfulAt || null,remaining:historyJob.remaining ?? null,
          lastCycleErrors:historyJob.lastCycleErrors ?? null,counts:historyJob.counts || null,attention:historyJob.attention || [],
          stale:!historyJob.startedAt || Date.now()-Date.parse(historyJob.startedAt)>45*60*1000}:null;
        await recheck();sendJson(req,res,200,{...result,automation,historyAutomation,source:{exportedAt:data.meta.exportedAt,count:data.meta.totals.count,snapshot:data.snapshot}});return true;
      }
      const match=url.pathname.match(/^\/api\/boleto-cloud\/history\/([a-f0-9]{64})\/(sync|pdf|invite|invite-email|reconcile|reconcile-preview|reconcile-confirm)$/);
      if(!match || (['sync','reconcile-preview','reconcile-confirm'].includes(match[2])?req.method!=='POST':req.method!=='GET'))throw new HistoryError('Rota não encontrada.',404);
      const record=data.rows.find(r=>r.id===match[1]);
      if(!record)throw new HistoryError('Boleto não encontrado no histórico.',404);
      if(match[2].startsWith('reconcile')) {
        if(!require('./boleto-reconciliation').admin((await profile.get()).data()))throw new HistoryError('Somente administradores podem conciliar boletos antigos.',403);
        const cfg=require('./boleto-cloud').config(env);
        const account=data.meta.issuanceAccounts?.[cfg.accountFingerprint];
        if(!account || account.beneficiaryDocument!==record.beneficiaryDocument || account.bank!==record.bank)
          throw new HistoryError('Beneficiário fora da conta de emissão homologada.',409);
        await require('./boleto-reconciliation').handleReconciliation({req,res,db,uid,record,operation:match[2],sendJson,env,fetchImpl});
        cached=null;return true;
      }
      if(!env.BOLETO_CLOUD_API_KEY)throw new HistoryError('Credencial do emissor indisponível.',503);
      if (['invite','invite-email'].includes(match[2])) {
        const source=record.transactionId?db.collection('transactions').doc(record.transactionId):null;
        const sourceBefore=source?(await source.get()).data():null;
        if(source && (!sourceBefore || !eligible(sourceBefore) || money(sourceBefore.valueReceived)>0))
          throw new HistoryError('Cobrança excluída ou recebida: INVITE indisponível.',409);
        if(source && (Math.round(amount(sourceBefore)*100)!==record.amountCents || sourceBefore.dueDate!==record.dueDate || String(sourceBefore.cpfCnpj || '').replace(/\D/g,'')!==record.payerDocument))
          throw new HistoryError('Dados do lançamento divergiram do boleto. Confira a cobrança antes de preparar o INVITE.',409);
        const artifact=await prepareInvite({token:record.token,base:'https://app.boletocloud.com/api/v1',apiKey:env.BOLETO_CLOUD_API_KEY,expected:record,fetchImpl});
        await recheck();
        if(source && JSON.stringify((await source.get()).data())!==JSON.stringify(sourceBefore))throw new HistoryError('Cobrança alterada durante a preparação.',409);
        sendInvite(res,artifact,match[2]);return true;
      }
      const result=await fetchImpl(`https://app.boletocloud.com/api/v1/boletos/${encodeURIComponent(record.token)}${match[2]==='sync'?'/situacao':''}`,{
        method:'GET',headers:{Authorization:`Basic ${Buffer.from(`${env.BOLETO_CLOUD_API_KEY}:token`).toString('base64')}`,Accept:match[2]==='sync'?'application/json':'application/pdf'},signal:AbortSignal.timeout(20000),redirect:'error'});
      if(!result.ok)throw new HistoryError(`Consulta ao emissor não concluída (HTTP ${result.status}). O histórico anterior foi preservado.`,502);
      await recheck();
      if(match[2]==='sync') {
        const at=new Date().toISOString(), next=mergeSituation(record,await result.json(),at);
        await db.runTransaction(async tx=>{
          if(!allowed((await tx.get(profile)).data()))throw new HistoryError('Acesso revogado.',403);
          const ref=db.collection('boletoHistoryUpdates').doc(record.id), previous=(await tx.get(ref)).data();
          if(previous?.syncedAt>at)throw new HistoryError('Outra consulta mais recente já foi concluída.',409);
          tx.set(ref,{record:next,syncedAt:at});
          tx.set(db.collection('boletoHistoryAudit').doc(),{action:'sync',uid,boletoId:record.id,at});
        });
        cached=null;sendJson(req,res,200,{ok:true,syncedAt:at});
      } else {
        const bytes=Buffer.from(await result.arrayBuffer());
        if(bytes.length>10000000 || bytes.subarray(0,5).toString()!=='%PDF-')throw new HistoryError('PDF inválido.',502);
        await recheck();res.writeHead(200,{'Content-Type':'application/pdf','Content-Disposition':'attachment; filename="boleto.pdf"','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'});res.end(bytes);
      }
    }catch(e){sendJson(req,res,e.status || 502,{error:(e instanceof HistoryError || e instanceof InviteError || e.reconciliation)?e.message:'Não foi possível consultar o histórico. Tente novamente.'});}
    return true;
  };
}
module.exports={idFor,statusOf,totals,selections,report,validateImport,mergeSituation,createHistoryHandler};
