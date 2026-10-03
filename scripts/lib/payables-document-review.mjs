const normalized = value => String(value || '').trim().toUpperCase();

// Diagnostic only. Neither similarity nor a legacy submission link authorizes a write.
export function reviewPayableDocuments(payable, documents) {
  const active = documents.filter(document => document.data?.isExcluded !== true);
  const mismatches = [];
  for (const document of active) {
    const data = document.data || {};
    const fields = [];
    const amount = Number(data.valuePaid || data.valorOriginal || 0);
    if (String(data.dueDate || '') !== payable.dueDate) fields.push('dueDate');
    if (!Number.isFinite(amount) || Math.abs(amount - payable.amount) > 0.01) fields.push('amount');
    if (normalized(data.status) !== (payable.docPago === 'SIM' ? 'PAGO' : 'PENDENTE')) fields.push('status');
    if (normalized(data.description) !== normalized(payable.description)) fields.push('description');
    const directionConflict = normalized(data.movement).includes('ENTRADA') || /ENTRADA|RECEBER|RECEBIMENTO WIX/.test(normalized(data.type));
    if (directionConflict) fields.push('direction');
    if (!fields.length) continue;
    const identityReviewReasons = [];
    if (active.length > 1) identityReviewReasons.push('MULTIPLE_ACTIVE_DOCUMENTS');
    if (directionConflict) identityReviewReasons.push('PAYABLE_LINKED_TO_RECEIVABLE');
    const expectedIdentity = normalized(payable.identificacaoUnica);
    const existingIdentity = normalized(data.identificacaoUnica);
    if (expectedIdentity && existingIdentity && expectedIdentity !== existingIdentity) {
      identityReviewReasons.push('UNIQUE_IDENTITY_CONFLICT');
    } else if (document.id !== `trx-jf-${payable.submissionId}` && (!expectedIdentity || !existingIdentity)) {
      identityReviewReasons.push('LEGACY_LINK_WITHOUT_UNIQUE_IDENTITY');
    }
    mismatches.push({ ...payable, firestoreId: document.id, fields, identityReviewReasons,
      requiresIdentityReview: identityReviewReasons.length > 0,
      firestore: { dueDate: data.dueDate || '', amount: Number.isFinite(amount) ? amount : null,
        status: data.status || '', description: data.description || '', movement: data.movement || '',
        type: data.type || '', identificacaoUnica: data.identificacaoUnica || '' } });
  }
  return { mismatches, duplicate: active.length > 1 ? { ...payable, firestoreIds: active.map(document => document.id) } : null };
}
