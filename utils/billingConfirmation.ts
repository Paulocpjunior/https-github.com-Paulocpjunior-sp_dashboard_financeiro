import type { ObligationReviewRow } from './billingObligations';
export type MonthlyDecision = 'needs_review' | 'charge';
export interface MonthlyTerms {
  month: string; identity: string; client: string; decision: MonthlyDecision; amount: number | null;
  dueDate: string; startDate: string; billingDay: number; lastChargeDate: string;
  evidence: string; event: string; sourceFingerprint: string;
}
export interface SavedMonthlyTerms extends MonthlyTerms { revision: number; actorUid: string; createdAt: unknown; updatedAt: unknown; auditId: string; schemaVersion: 1 }
const plain = (value: string) => value.replace(/<(script|style|iframe|object)\b[^>]*>[\s\S]*?<\/\1>/gi,'').replace(/<[^>]*>/g,' ').replace(/&nbsp;|&#160;/gi,' ').replace(/\s+/g,' ').trim();
const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && new Date(value+'T12:00:00Z').toISOString().slice(0,10) === value;
const iso = (value: string) => { const s=value.split('/').reverse().join('-'); try { return validDate(s)?s:null; } catch { return null; } };
export function proposeChecklistTerms(notes: string) {
  const source = plain(notes || '');
  const amounts = [...source.matchAll(/(?:valor da mensalidade|mensalidade|honor[aá]rios(?: mensais)?)\s*[:=]?\s*(?:R\$\s*)?([\d.]+,\d{2})(?!\d)/gi)].map(m => ({ value:Number(m[1].replace(/\./g,'').replace(',','.')), excerpt:m[0] }));
  const documents = [...source.matchAll(/\b(?:CNPJ|CPF)\s*[:=]?\s*([\d./-]{11,18})/gi)].map(m => ({value:m[1].replace(/\D/g,''),excerpt:m[0]})).filter(m=>[11,14].includes(m.value.length));
  const startDates = [...source.matchAll(/(?:responsabilidade a partir de|respons[aá]vel a partir de|in[ií]cio da responsabilidade)\s*[:=]?\s*(\d{2}\/\d{2}\/\d{4})/gi)].map(m=>({value:iso(m[1]),excerpt:m[0]})).filter(m=>m.value);
  const lastDates = [...source.matchAll(/(?:[uú]ltima cobran[cç]a(?: em| de| at[eé])?)\s*[:=]?\s*(\d{2}\/\d{2}\/\d{4})/gi)].map(m=>({value:iso(m[1]),excerpt:m[0]})).filter(m=>m.value);
  const days = [...source.matchAll(/(?:cobrar dia|dia de cobran[cç]a|vencimento dia)\s*[:=]?\s*(\d{1,2})\b/gi)].map(m=>({value:Number(m[1]),excerpt:m[0]})).filter(m=>m.value>=1&&m.value<=31);
  return { amounts, documents, startDates, lastDates, days, automaticallyConfirmed:false as const };
}
export function validateMonthlyTerms(value: MonthlyTerms, isAdmin: boolean) {
  const errors:string[]=[];
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(value.month)) errors.push('Competência inválida.');
  if (!/^(doc:\d{11}|doc:\d{14}|number:\d+)$/.test(value.identity)) errors.push('Resolver identificação antes de registrar obrigação.');
  if (!value.client?.trim()) errors.push('Cliente obrigatório.');
  if (!['entrada','saida','alteracao','suspensao','recorrencia','pendente','multiplos'].includes(value.event)) errors.push('Evento inválido.');
  if (!['needs_review','charge'].includes(value.decision)) errors.push('Decisão inválida; dispensa não está disponível nesta etapa.');
  if (!value.evidence?.trim() || value.evidence.length>4000) errors.push('Informe evidência ou motivo da revisão, até 4.000 caracteres.');
  if (!/^[a-f0-9]{64}$/.test(value.sourceFingerprint)) errors.push('Recarregue as fontes antes de registrar.');
  if (!Number.isInteger(value.billingDay)||value.billingDay<0||value.billingDay>31) errors.push('Dia de cobrança inválido.');
  for(const [label,date] of [['Vencimento',value.dueDate],['Início da responsabilidade',value.startDate],['Última cobrança',value.lastChargeDate]]) {
    if(date) { try { if(!validDate(date))errors.push(`${label}: data inválida.`); } catch { errors.push(`${label}: data inválida.`); } }
  }
  if(value.amount!=null&&(!Number.isFinite(value.amount)||value.amount<=0))errors.push('Valor deve ser positivo.');
  if(value.decision==='charge') {
    if(!isAdmin)errors.push('Somente administrador confirma obrigação.');
    if(value.amount==null||!value.dueDate||!value.startDate||!value.billingDay)errors.push('Confirme valor, vencimento, início da responsabilidade e dia de cobrança.');
    if(['saida','suspensao'].includes(value.event)&&!value.lastChargeDate)errors.push('Saída ou suspensão exige confirmar a última cobrança devida.');
    if(value.event==='pendente'||value.event==='multiplos')errors.push('Resolver evento e vigência antes de confirmar obrigação.');
  }
  return errors;
}
export async function fingerprintMonthlyRow(row: ObligationReviewRow, month: string, field: string) {
  const text=JSON.stringify({month,field,identity:row.identity,previousAmount:row.previousAmount,currentAmount:row.currentAmount,
    previousIds:[...row.previousIds].sort(),currentIds:[...row.currentIds].sort(),
    events:[...row.checklist].sort((a,b)=>a.submissionId.localeCompare(b.submissionId)).map(r=>[r.submissionId,r.status,r.amount,r.entryDate,r.exitDate,r.suspensionDate,r.notes,r.sourceUpdatedAt,r.sourceCreatedAt]),
    financialSource:row.financialSource, issues:[...row.issues].sort()});
  const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text));
  return [...new Uint8Array(bytes)].map(n=>n.toString(16).padStart(2,'0')).join('');
}
export const monthlyTermsId = (month:string,identity:string) => `${month}_${identity}`;
