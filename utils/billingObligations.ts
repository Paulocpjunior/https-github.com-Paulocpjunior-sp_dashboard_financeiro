import type { IdentityLink } from '../services/billingConfirmationService';
import type { Transaction } from '../types';
import type { ChecklistRecord } from '../services/checklistReviewService';
import { buildBillingCompleteness, type BillingPeriodField } from './billingCompleteness';
import { checklistEvent, checklistEventGuidance } from './checklistStatus';
import { isEntradaTransaction } from './transactionAmounts';

export type ObligationSituation = 'identificacao' | 'possivel_ausencia' | 'checklist_sem_lancamento' | 'lancamento_localizado';
export const obligationSituationLabels: Record<ObligationSituation, string> = {
  identificacao: 'Identificação a conferir', possivel_ausencia: 'Possível ausência de lançamento',
  checklist_sem_lancamento: 'Checklist sem lançamento nos dois meses', lancamento_localizado: 'Lançamento localizado',
};
export interface ObligationReviewRow {
  identity: string; client: string; previousAmount: number; currentAmount: number;
  previousIds: string[]; currentIds: string[]; checklist: ChecklistRecord[];
  situation: ObligationSituation; issues: string[]; financialSource?: string;
}
const documentKey = (value: unknown) => {
  const digits = String(value || '').replace(/\D/g, '');
  return [11, 14].includes(digits.length) ? `doc:${digits}` : '';
};
const numberKey = (value: unknown) => {
  const raw = String(value || '').trim();
  // Nosso Número é numérico; zeros de preenchimento não alteram seu valor.
  return /^\d+$/.test(raw) ? raw.replace(/^0+(?=\d)/, '') : raw;
};

/** Lista de conferência, sem concluir vigência, obrigação validada ou dispensa. */
export function buildBillingObligations(transactions: Transaction[], records: ChecklistRecord[], month: string, field: BillingPeriodField, linksSaved: IdentityLink[] = []) {
  const aliases = new Map(linksSaved.map(link => [link.sourceIdentity, link.targetIdentity]));
  const apply = (sourceIdentity: string, document: string | undefined, number: unknown) => {
    if (documentKey(document) || numberKey(number)) return { document, number };
    const target = aliases.get(sourceIdentity);
    return target?.startsWith('doc:') ? {document:target.slice(4),number} : target?.startsWith('number:') ? {document,number:target.slice(7)} : {document,number};
  };
  transactions = transactions.map(item => { const target=apply(`unidentified:${item.id}`,item.cpfCnpj,item.clientNumber); return {...item,cpfCnpj:target.document,clientNumber:target.number as string}; });
  records = records.map(item => { const target=apply(`checklist-unidentified:${item.submissionId}`,item.document,item.clientNumber); return {...item,document:target.document,clientNumber:target.number as string}; });
  const links = new Map<string, Set<string>>();
  const receivables = transactions.filter(item => !item.isExcluded && isEntradaTransaction(item));
  const addLink = (number: string, document: string) => {
    if (!number || !document) return;
    const docs = links.get(number) || new Set<string>(); docs.add(document); links.set(number, docs);
  };
  receivables.forEach(item => addLink(numberKey(item.clientNumber), documentKey(item.cpfCnpj)));
  records.forEach(item => addLink(numberKey(item.clientNumber), documentKey(item.document)));
  const conflictedDocuments = new Set([...links.values()].filter(docs => docs.size > 1).flatMap(docs => [...docs]));
  const resolve = (number: string, document: string) => {
    if (document) return document;
    const docs = links.get(number);
    return docs?.size === 1 ? [...docs][0] : number ? `number:${number}` : '';
  };
  const normalizedTransactions = transactions.map(item => {
    const number = numberKey(item.clientNumber);
    const resolved = resolve(number, documentKey(item.cpfCnpj));
    // Impede que a comparação financeira resolva um número ambíguo por uma só fonte.
    const comparisonNumber = (links.get(number)?.size || 0) > 1 && documentKey(item.cpfCnpj) ? '' : number;
    return { ...item, clientNumber: comparisonNumber, cpfCnpj: resolved.startsWith('doc:') ? resolved.slice(4) : item.cpfCnpj };
  });
  const comparison = buildBillingCompleteness(normalizedTransactions, month, field);
  const rows = new Map<string, ObligationReviewRow>(comparison.rows.map(row => [row.identity, { ...row, checklist: [], situation: 'identificacao' }]));
  records.forEach(record => {
    const identity = resolve(numberKey(record.clientNumber), documentKey(record.document)) || `checklist-unidentified:${record.submissionId}`;
    const row = rows.get(identity) || { identity, client: record.client || 'Cliente sem nome', previousAmount: 0, currentAmount: 0,
      previousIds: [], currentIds: [], checklist: [], situation: 'identificacao' as const, issues: [] };
    row.checklist.push(record); rows.set(identity, row);
  });
  const byId=new Map(transactions.map(item=>[item.id,item]));
  const result = [...rows.values()].map(row => {
    const number = row.identity.startsWith('number:') ? row.identity.slice(7) : '';
    const conflicted = (links.get(number)?.size || 0) > 1 || conflictedDocuments.has(row.identity);
    const identified = !row.identity.includes('unidentified:') && !conflicted;
    if (!identified) row.issues.push('Resolver identificação antes de confirmar ausência ou associar contrato. Não unir por nome.');
    if (conflicted) row.issues.push('Número vinculado a documentos diferentes nas fontes: associação automática bloqueada.');
    row.situation = !identified ? 'identificacao' : row.currentIds.length ? 'lancamento_localizado'
      : row.previousIds.length ? 'possivel_ausencia' : 'checklist_sem_lancamento';
    if (!row.checklist.length) row.issues.push('Nenhuma resposta do checklist vinculada por identificação.');
    if (row.checklist.length > 1) row.issues.push('Há vários eventos para este cliente: confirmar sequência e vigência; nenhum foi escolhido como contrato atual.');
    for (const record of row.checklist) {
      row.issues.push(checklistEventGuidance[checklistEvent(record.status)]);
      if (record.amount == null) row.issues.push('Honorários do checklist: conferir valor nas observações.');
      const createdMonth = record.sourceCreatedAt?.slice(0, 7);
      if (createdMonth && createdMonth > month) row.issues.push('Há resposta cadastrada após o mês escolhido: confirmar vigência, sem aplicar retroativamente.');
      if (record.issues.length) row.issues.push('Há campos originais a conferir no checklist.');
    }
    if (!row.previousIds.length && !row.currentIds.length) row.issues.push('Evento do checklist sem base financeira nos dois meses; confirmar se há cobrança devida para a competência.');
    row.issues = row.issues.map(issue => issue === 'Sem lançamento no mês atual: cobrar ou comprovar a dispensa contratual.' ? 'Sem lançamento com data válida no mês atual: conferir competência, contrato e eventual dispensa.' : issue);
    row.issues.push('Contrato, emissão e eventual dispensa ainda dependem de validação.');
    const ids=new Set([...row.previousIds,...row.currentIds]);
    return { ...row, financialSource:JSON.stringify([...ids].sort().map(id=>byId.get(id))), issues: [...new Set(row.issues)] };
  });
  const order: ObligationSituation[] = ['identificacao', 'possivel_ausencia', 'checklist_sem_lancamento', 'lancamento_localizado'];
  result.sort((a,b) => order.indexOf(a.situation)-order.indexOf(b.situation) || a.client.localeCompare(b.client, 'pt-BR'));
  const counts = Object.fromEntries(order.map(situation => [situation, result.filter(row => row.situation === situation).length])) as Record<ObligationSituation, number>;
  return { rows: result, counts, targetMonth: month, previousMonth: comparison.previousMonth, sourceIssues: comparison.sourceIssues,
    checklistRecords: records.length, linkedChecklistRecords: result.filter(row => row.previousIds.length || row.currentIds.length).reduce((sum,row) => sum+row.checklist.length,0),
    canCloseMonth: false as const, validatedObligations: null };
}
