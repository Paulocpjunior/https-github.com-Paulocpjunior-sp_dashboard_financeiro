const assert = require('node:assert/strict');
const originalFetch = global.fetch;
const { google } = require('googleapis');
let externalCalls = 0;
global.fetch = async () => { externalCalls++; throw new Error('No network permitted'); };
google.auth.GoogleAuth = class { constructor() { throw new Error('No credentials or Firestore access permitted'); } };
(async () => {
  const { app } = require('./index');
  const { loadChecklist } = require('./checklist');
  await assert.rejects(loadChecklist({apiKey:'synthetic-key'}), /JOTFORM_INTEGRATION_DISABLED/);
  const server = await new Promise(resolve => { const s = app.listen(0,'127.0.0.1',()=>resolve(s)); });
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    for (const path of ['/', '/reconcile-jotform', '/jotform-update-submission', '/api/billing-checklist/review']) {
      for (const method of ['POST','PUT','PATCH','DELETE']) {
        const response = await originalFetch(base+path, {method,headers:{'Content-Type':'application/json'},body:'{"submissionID":"synthetic"}'});
        assert.equal(response.status,410);
        const body = await response.json();
        assert.equal(body.code,'JOTFORM_INTEGRATION_DISABLED');
        assert.equal(body.canCloseMonth,false);
      }
    }
    const health = await (await originalFetch(base)).json();
    assert.equal(health.jotformEnabled,false);
    assert.equal(externalCalls,0);
    console.log('PASS: Jotform retired; 16 blocked requests, no provider calls or database writes; health remains available.');
  } finally { server.closeAllConnections(); await new Promise(resolve=>server.close(resolve)); global.fetch=originalFetch; }
})().catch(e=>{console.error(e);process.exitCode=1;});
