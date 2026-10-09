const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { runReturns } = require('./boleto-returns');
initializeApp();
runReturns({ db: getFirestore(), dryRun: process.argv.includes('--dry-run') })
  .then(result => { console.log(JSON.stringify(result)); if (result.errors) process.exitCode = 1; })
  .catch(() => { console.error('Consulta automática não concluída. Consulte o estado do job; nenhuma credencial é registrada em log.'); process.exitCode = 1; });
