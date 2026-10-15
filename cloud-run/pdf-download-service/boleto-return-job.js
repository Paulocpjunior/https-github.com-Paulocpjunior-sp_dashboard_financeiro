const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { runReturns } = require('./boleto-returns');
const { runReconciliations } = require('./boleto-reconciliation');
const { runHistorySync } = require('./boleto-history-sync');
const { runRetFiles } = require('./boleto-ret-files');
initializeApp();
(async () => {
  const options = { db: getFirestore(), dryRun: process.argv.includes('--dry-run') };
  const deadline = Date.now() + 8 * 60000;
  const returns = await runRetFiles({ ...options, deadline: Math.min(deadline, Date.now()+120000) });
  const native = await runReturns({ ...options, deadline: Math.min(deadline, Date.now()+120000) });
  const reconciliations = await runReconciliations({ ...options, deadline: Math.min(deadline,Date.now()+90000) });
  const history = await runHistorySync({ ...options, deadline });
  return { ...native, returns, history, reconciliations, errors: (returns.errors || 0) + (native.errors || 0) + (history.errors || 0) + (reconciliations.errors || 0) };
})()
  .then(result => { console.log(JSON.stringify(result)); if (result.errors) process.exitCode = 1; })
  .catch(() => { console.error('Consulta automática não concluída. Consulte o estado do job; nenhuma credencial é registrada em log.'); process.exitCode = 1; });
