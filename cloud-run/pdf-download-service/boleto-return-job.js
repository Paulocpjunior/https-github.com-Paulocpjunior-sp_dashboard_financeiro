const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { runReturns } = require('./boleto-returns');
const { runReconciliations } = require('./boleto-reconciliation');
const { runHistorySync } = require('./boleto-history-sync');
const { runRetFiles } = require('./boleto-ret-files');
const { runDeliverySweep } = require('./boleto-delivery-sweep');
const { runDailyAlert, recordRun } = require('./boleto-daily-alert');
initializeApp();
(async () => {
  const options = { db: getFirestore(), dryRun: process.argv.includes('--dry-run') };
  const deadline = Date.now() + 8 * 60000;
  const returns = await runRetFiles({ ...options, deadline: Math.min(deadline, Date.now()+120000) });
  // Only the RET pipeline may settle automatically. Status refresh cannot bypass a RET exception.
  const statusOnlyEnv = { ...process.env, BOLETO_CLOUD_RETURN_SETTLEMENT_ENABLED: 'false' };
  const native = await runReturns({ ...options, env: statusOnlyEnv, deadline: Math.min(deadline, Date.now()+120000) });
  const reconciliations = await runReconciliations({ ...options, env: statusOnlyEnv, deadline: Math.min(deadline,Date.now()+90000) });
  // Envio de boleto emitido que ficou sem e-mail; nunca reenvia o que já saiu.
  const deliveries = await runDeliverySweep({ ...options, deadline: Math.min(deadline, Date.now()+120000) }).catch(() => ({ errors: 1 }));
  const history = await runHistorySync({ ...options, deadline });
  // Alerta diário para o Paulo; conta as execuções com erro do dia anterior.
  const alert = await runDailyAlert(options).catch(() => ({ errors: 1 }));
  const errors = (returns.errors || 0) + (native.errors || 0) + (history.errors || 0) + (reconciliations.errors || 0) + (deliveries.errors || 0) + (alert.errors || 0);
  if (!options.dryRun) await recordRun(options.db, errors > 0).catch(() => {});
  return { ...native, returns, history, reconciliations, deliveries, alert, errors };
})()
  .then(result => { console.log(JSON.stringify(result)); if (result.errors) process.exitCode = 1; })
  .catch(() => { console.error('Consulta automática não concluída. Consulte o estado do job; nenhuma credencial é registrada em log.'); process.exitCode = 1; });
