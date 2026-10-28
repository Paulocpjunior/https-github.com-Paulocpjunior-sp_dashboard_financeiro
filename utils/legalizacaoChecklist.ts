import type { ChecklistRecord, ChecklistReview } from '../services/checklistReviewService';

/**
 * Checklist do Legal lido do APP Legalização pelo túnel do CFI
 * (GET /api/admin/cadastro/checklist-legalizacao). Paulo, 28/10: "todos apps
 * passam a ler o checklist do app legalizacao, jotform morre".
 *
 * O app guarda UMA linha por empresa (os envios antigos do Jotform já vieram
 * consolidados). Honorários só chegam com o token deste projeto: sem a
 * liberação, a leitura NÃO é completa e nada é mostrado como se fosse.
 */
export const LEGALIZACAO_FORM_ID = 'legalizacao:checklist';

const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
const isoDay = (v: unknown) => {
  const s = text(v);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T12:00:00Z`);
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === s ? s : null;
};
/** "1.200,50", "R$ 900" → número; ausente/ilegível → null (ausente ≠ zero). */
export function parseHonorarios(value: unknown): number | null {
  let s = text(value).replace(/R\$|\s/g, '');
  if (!s) return null;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export async function mapLegalizacaoChecklist(body: any, readAt: string): Promise<ChecklistReview> {
  if (!body || body.ok !== true || !Array.isArray(body.itens)) throw new Error('A fonte não confirmou uma leitura completa e válida.');
  if (body.cortado === true) throw new Error('O checklist da Legalização veio cortado no limite de leitura. Nenhuma conclusão mensal foi liberada.');
  if (body.honorarios !== true) throw new Error('O CFI não liberou os honorários para esta sessão. Entre novamente no Financeiro.');
  const records: ChecklistRecord[] = body.itens.map((it: any): ChecklistRecord => {
    const issues: string[] = [];
    const document = text(it.documento).replace(/\D/g, '');
    const rawNumber = text(it.nossoNumero);
    const clientNumber = /^\d+$/.test(rawNumber) ? rawNumber : '';
    if (rawNumber && !clientNumber) issues.push('Nosso número inválido; associação por esse número bloqueada.');
    const identity = [11, 14].includes(document.length) ? `doc:${document}` : clientNumber ? `number:${clientNumber}` : '';
    const client = text(it.empresaNome) || null;
    if (!client) issues.push('Nome do cliente ausente');
    if (!identity) issues.push('Identificação ausente: não unir por nome');
    const amount = parseHonorarios(it.honorarios);
    if (amount == null) issues.push(text(it.honorarios) ? 'Honorários: valor inválido' : 'Honorários ausentes ou inválidos');
    const entryDate = isoDay(it.datas?.cadastro), exitDate = isoDay(it.datas?.saida);
    if (entryDate && exitDate && exitDate < entryDate) issues.push('Saída anterior à entrada');
    return {
      submissionId: `legalizacao/${text(it.id)}`, identity, client, clientNumber: clientNumber || null, document,
      amount, entryDate, exitDate, suspensionDate: isoDay(it.datas?.suspensao),
      status: text(it.statusCliente) || null, notes: text(it.observacao?.texto) || null,
      sourceCreatedAt: null, sourceUpdatedAt: text(it.atualizadoEm) || null,
      // O app não tem "dia de cobrança" nem "última cobrança": seguem para conferência humana.
      observationsRequireReview: true, issues, contractValidated: false,
    };
  }).sort((a: ChecklistRecord, b: ChecklistRecord) => a.submissionId.localeCompare(b.submissionId));
  if (records.some(r => r.submissionId === 'legalizacao/') || new Set(records.map(r => r.submissionId)).size !== records.length)
    throw new Error('Registros repetidos ou sem id no checklist da Legalização.');
  const counts = new Map<string, number>();
  records.forEach(r => { if (r.identity) counts.set(r.identity, (counts.get(r.identity) || 0) + 1); });
  records.forEach(r => { if ((counts.get(r.identity) || 0) > 1) r.issues.push('Mais de uma empresa com a mesma identificação no checklist: conferir; não substituir automaticamente'); });
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(records)));
  const valid = records.filter(r => !r.issues.length).length;
  return {
    source: 'legalizacao', formId: LEGALIZACAO_FORM_ID, title: 'Checklist do Legal (app Legalização)', readAt,
    sourceFingerprint: Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join(''),
    complete: true, expected: records.length, received: records.length, active: records.length, excluded: 0,
    validRecords: valid, conflictRecords: records.length - valid,
    observationsToReview: records.filter(r => r.observationsRequireReview).length, canCloseMonth: false, records,
  };
}
