export interface BillingTask {
  month:string; identity:string; client:string; assigneeUid:string; assigneeName:string;
  deadline:string; state:'open'|'done'; evidence:string;
}
export interface SavedBillingTask extends BillingTask { revision:number; actorUid:string; auditId:string; createdAt:unknown; updatedAt:unknown }
export const billingTaskId=(month:string,identity:string)=>`${month}_${identity}`;
export function validateBillingTask(value:BillingTask) {
  const errors:string[]=[];
  if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(value.month))errors.push('Competência inválida.');
  if(!/^(doc:\d{11}|doc:\d{14}|number:\d+|(unidentified|checklist-unidentified):[^/]+)$/.test(value.identity))errors.push('Identificação inválida.');
  if(!value.client.trim()||value.client.length>300)errors.push('Cliente obrigatório, até 300 caracteres.');
  if(!value.assigneeUid||value.assigneeUid.includes('/')||!value.assigneeName.trim()||value.assigneeName.length>300)errors.push('Selecione um responsável ativo.');
  const date=new Date(value.deadline+'T12:00:00Z');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(value.deadline)||!Number.isFinite(date.getTime())||date.toISOString().slice(0,10)!==value.deadline)errors.push('Prazo inválido.');
  if(!['open','done'].includes(value.state))errors.push('Situação inválida.');
  if(!value.evidence.trim()||value.evidence.length>4000)errors.push('Informe o motivo/resultado, até 4.000 caracteres.');
  return errors;
}
export const billingTaskOverdue=(task:BillingTask,today:string)=>task.state==='open'&&task.deadline<today;
