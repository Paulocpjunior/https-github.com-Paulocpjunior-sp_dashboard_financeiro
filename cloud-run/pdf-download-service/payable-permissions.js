const actions = ['read','settle','reverse','recurrence','invite','approve'];
function permits(user, action) {
  if (!user || user.active !== true || ['blocked','deleted'].includes(user.status)) return false;
  return user.role === 'admin' || (actions.includes(action) && Array.isArray(user.financialPermissions) && user.financialPermissions.includes(`payables.${action}`));
}
function capabilities(user) {
  return Object.fromEntries(actions.map(action=>[action, action === 'read' ? actions.some(a=>permits(user,a)) : permits(user,action)]));
}
function routeAllowed(user, method, path) {
  if (method === 'GET') {
    if (path.startsWith('items/') || ['rules','drafts','ledger'].includes(path)) return capabilities(user).read;
    return false;
  }
  if (method !== 'POST') return false;
  const action = path === 'approvals/decide' ? 'approve' : path === 'approvals/request' ? 'settle' : path.startsWith('payment/') ? 'settle' : path.startsWith('reversal/') ? 'reverse' : path.startsWith('rules/') ? 'recurrence' : path.startsWith('invite/') ? 'invite' : null;
  return action !== null && permits(user,action);
}
module.exports = {permits, capabilities, routeAllowed};
