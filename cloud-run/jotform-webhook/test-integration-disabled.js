const assert = require('node:assert/strict');
const originalFetch = global.fetch;
const { google } = require('googleapis');
let externalCalls = 0;
global.fetch = async () => { externalCalls++; throw new Error('No network permitted'); };
google.auth.GoogleAuth = class { constructor() { throw new Error('No credentials or Firestore access permitted'); } };
(async () => {
  const { app } = require('./index');
  const { loadChecklist } = require('./checklist');
  // O Checklist do Legal continua legível, mas só com a chave própria.
  await assert.rejects(loadChecklist({}), /CHECKLIST_CREDENTIAL_MISSING/);
  const server = await new Promise(resolve => { const s = app.listen(0,'127.0.0.1',()=>resolve(s)); });
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    let blocked = 0;
    for (const path of ['/', '/reconcile-jotform', '/jotform-update-submission', '/api/billing-checklist/review']) {
      for (const method of ['POST','PUT','PATCH','DELETE']) {
        if (path === '/api/billing-checklist/review' && method === 'POST') continue;
        const response = await originalFetch(base+path, {method,headers:{'Content-Type':'application/json'},body:'{"submissionID":"synthetic"}'});
        assert.equal(response.status,410);
        const body = await response.json();
        assert.equal(body.code,'JOTFORM_INTEGRATION_DISABLED');
        assert.equal(body.canCloseMonth,false);
        blocked++;
      }
    }
    // A leitura do checklist passa pela trava, mas exige sessão antes de qualquer chamada externa.
    const read = await originalFetch(base+'/api/billing-checklist/review', {method:'POST',headers:{'Content-Type':'application/json'},body:'{"force":true}'});
    assert.equal(read.status,401);
    const health = await (await originalFetch(base)).json();
    assert.equal(health.jotformEnabled,false);
    assert.equal(health.checklistReadEnabled,true);
    assert.equal(externalCalls,0);
    console.log(`PASS: cash form retired (${blocked} blocked requests); Legal checklist read open and authenticated; no provider calls or database writes.`);
  } finally { server.closeAllConnections(); await new Promise(resolve=>server.close(resolve)); global.fetch=originalFetch; }
})().catch(e=>{console.error(e);process.exitCode=1;});
