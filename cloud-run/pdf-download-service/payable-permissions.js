const actions = ['read','amend','settle','reverse','recurrence','invite','approve','dueDate'];
// Regra do titular: correções valem para toda a equipe ativa; só a exclusão segue exclusiva dele.
const teamActions = ['dueDate'];
const active = user => Boolean(user) && user.active === true && !['blocked','deleted'].includes(user.status);
function permits(user, action) {
  if (!active(user)) return false;
  return user.role === 'admin' || teamActions.includes(action) || (actions.includes(action) && Array.isArray(user.financialPermissions) && user.financialPermissions.includes(`payables.${action}`));
}
function capabilities(user) {
  return Object.fromEntries(actions.map(action=>[action, action === 'read' ? actions.some(a=>!teamActions.includes(a)&&permits(user,a)) : permits(user,action)]));
}
function routeAllowed(user, method, path) {
  if (method === 'GET') {
    // Abrir a conta basta para corrigir o vencimento; relatórios e regras seguem nos direitos de Usuários.
    if (path.startsWith('items/')) return capabilities(user).read || permits(user,'dueDate');
    if (['rules','drafts','ledger'].includes(path)) return capabilities(user).read;
    return false;
  }
  if (method !== 'POST') return false;
  const action = path.startsWith('invoice/') ? 'amend' : ['due-date/preview','due-date/commit'].includes(path) ? 'dueDate' : path === 'approvals/decide' ? 'approve' : path === 'approvals/request' ? 'settle' : path.startsWith('payment/') ? 'settle' : path.startsWith('reversal/') ? 'reverse' : path.startsWith('rules/') ? 'recurrence' : path.startsWith('invite/') ? 'invite' : null;
  return action !== null && permits(user,action);
}
module.exports = {permits, capabilities, routeAllowed};
