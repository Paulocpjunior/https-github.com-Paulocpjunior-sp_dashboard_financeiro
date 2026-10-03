// Financial similarity is not proof of identity and never authorizes recreation.
export function classifyFinancialMatches(documents) {
  if (!documents.length) return 'missing';
  if (documents.length !== 1) return 'ambiguous';
  const data = documents[0].data || {};
  return String(data.submissionId || data.submissionID || '').trim() ? 'ambiguous' : 'legacy';
}
