// Jotform retired from Financeiro. Re-enabling requires a reviewed code release.
const JOTFORM_DISABLED = true;
const disabledResponse = {
  code: 'JOTFORM_INTEGRATION_DISABLED',
  error: 'A integração do Financeiro com o Jotform foi desativada. Use os lançamentos nativos. O histórico salvo foi preservado.',
  canCloseMonth: false,
};
function assertJotformAccess() {
  if (JOTFORM_DISABLED) throw new Error(disabledResponse.code);
}
function blockJotformIntegration(req, res, next) {
  // All legacy mutations and checklist reads must stop before authentication,
  // uploads, provider requests or Firestore writes. Health GET remains available.
  if (JOTFORM_DISABLED && req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'OPTIONS') {
    return res.status(410).set('Cache-Control', 'no-store').json(disabledResponse);
  }
  return next();
}
module.exports = { JOTFORM_DISABLED, disabledResponse, assertJotformAccess, blockJotformIntegration };
