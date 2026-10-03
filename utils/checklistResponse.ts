import type { ChecklistReview } from '../services/checklistReviewService';

const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const nullableText = (value: unknown) => value === null || typeof value === 'string';

/** Validate the transport contract, not whether a historical contract is valid. */
export function assertChecklistResponse(data: unknown): asserts data is ChecklistReview {
  const fail = () => { throw new Error('A fonte não confirmou uma leitura completa e válida.'); };
  if (!object(data)) return fail();
  const counts = ['expected','received','active','excluded','validRecords','conflictRecords','observationsToReview'];
  if (data.complete !== true || data.canCloseMonth !== false || data.formId !== '210135417457653' ||
      typeof data.title !== 'string' || !Array.isArray(data.records) ||
      counts.some(key => !Number.isSafeInteger(data[key]) || Number(data[key]) < 0) ||
      data.expected !== data.received || Number(data.active) + Number(data.excluded) !== data.received ||
      Number(data.validRecords) + Number(data.conflictRecords) !== data.active || data.records.length !== data.active ||
      typeof data.sourceFingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(data.sourceFingerprint) ||
      typeof data.readAt !== 'string' || !Number.isFinite(Date.parse(data.readAt))) return fail();
  const ids = new Set<string>();
  let valid = 0, observations = 0;
  for (const row of data.records) {
    if (!object(row) || typeof row.submissionId !== 'string' || !/^\d+$/.test(row.submissionId) || ids.has(row.submissionId) ||
        typeof row.identity !== 'string' ||
        ['client','clientNumber','entryDate','exitDate','suspensionDate','status','notes','sourceUpdatedAt'].some(key => !nullableText(row[key])) ||
        (row.document !== undefined && typeof row.document !== 'string') ||
        (row.sourceCreatedAt !== undefined && !nullableText(row.sourceCreatedAt)) ||
        (row.amount !== null && (typeof row.amount !== 'number' || !Number.isFinite(row.amount) || row.amount <= 0)) ||
        !Array.isArray(row.issues) || row.issues.some(issue => typeof issue !== 'string') ||
        typeof row.observationsRequireReview !== 'boolean' || row.contractValidated !== false) return fail();
    ids.add(row.submissionId);
    if (!row.issues.length) valid++;
    if (row.observationsRequireReview) observations++;
  }
  if (valid !== data.validRecords || observations !== data.observationsToReview) fail();
}
