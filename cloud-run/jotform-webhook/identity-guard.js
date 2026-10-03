// Do not turn an old identity-link conflict into a financial overwrite.
const text = field => String(field?.stringValue ?? '').trim();
const normalized = value => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();

function assertExistingIdentity(rows, incoming) {
  if (!['pagar', 'receber'].includes(incoming.kind)) throw new Error('IDENTITY_KIND_REQUIRED');
  for (const row of rows) {
    const fields = row.document?.fields || {};
    const direction = normalized(`${text(fields.movement)} ${text(fields.type)}`);
    const opposite = incoming.kind === 'pagar' ? /ENTRADA|RECEBER|RECEBIMENTO/ : /SAIDA|PAGAR/;
    const reasons = [];
    if (opposite.test(direction)) reasons.push('DIRECTION');
    for (const key of ['submissionId', 'submissionID']) {
      const existing = text(fields[key]);
      if (existing && incoming.submissionId && existing !== String(incoming.submissionId)) reasons.push('SUBMISSION');
    }
    const existingUnique = normalized(text(fields.identificacaoUnica));
    const incomingUnique = normalized(String(incoming.identificacaoUnica || '').trim());
    if (existingUnique && incomingUnique && existingUnique !== incomingUnique) reasons.push('UNIQUE_IDENTITY');
    if (reasons.length) {
      const error = new Error(`IDENTITY_CONFLICT:${[...new Set(reasons)].join(',')}`);
      error.code = 'IDENTITY_CONFLICT';
      throw error;
    }
  }
}

module.exports = { assertExistingIdentity };
