// Jotform retired from Financeiro. Re-enabling requires a reviewed code release.
const JOTFORM_DISABLED = true;
// O Checklist do Legal (formulário 210135417457653) é outro formulário: só leitura,
// com chave própria. O formulário de caixa continua desligado.
const CHECKLIST_READ_ENABLED = true;
const CHECKLIST_READ_PATH = '/api/billing-checklist/review';
const disabledResponse = {
  code: 'JOTFORM_INTEGRATION_DISABLED',
  error: 'A integração do Financeiro com o Jotform foi desativada. Use os lançamentos nativos. O histórico salvo foi preservado.',
  canCloseMonth: false,
};
function assertJotformAccess() {
  if (JOTFORM_DISABLED) throw new Error(disabledResponse.code);
}
function assertChecklistAccess() {
  if (!CHECKLIST_READ_ENABLED) throw new Error('CHECKLIST_READ_DISABLED');
}
function blockJotformIntegration(req, res, next) {
  // All legacy mutations must stop before authentication, uploads, provider
  // requests or Firestore writes. Health GET and the Legal checklist read remain.
  if (CHECKLIST_READ_ENABLED && req.method === 'POST' && req.path === CHECKLIST_READ_PATH) return next();
  if (JOTFORM_DISABLED && req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'OPTIONS') {
    return res.status(410).set('Cache-Control', 'no-store').json(disabledResponse);
  }
  return next();
}
module.exports = { JOTFORM_DISABLED, CHECKLIST_READ_ENABLED, disabledResponse, assertJotformAccess, assertChecklistAccess, blockJotformIntegration };
