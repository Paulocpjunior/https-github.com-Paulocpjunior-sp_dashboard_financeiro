const test=require('node:test'),assert=require('node:assert/strict');
const {createProvider,configuration}=require('./communication-provider');
const {SENDER}=require('./communication-rule');
const env={FINANCEIRO_COMMUNICATION_SEND_ENABLED:'true',FINANCEIRO_GRAPH_TENANT_ID:'00000000-0000-0000-0000-000000000001',FINANCEIRO_GRAPH_CLIENT_ID:'00000000-0000-0000-0000-000000000002',FINANCEIRO_GRAPH_CLIENT_SECRET:'synthetic-secret'};
const message=()=>({from:SENDER,replyTo:SENDER,to:'synthetic@example.com',idempotencyKey:'a'.repeat(64),subject:'Fictício',text:'Teste',attachments:[{name:'boleto.pdf',type:'application/pdf',content:Buffer.from('%PDF-synthetic')}]});
test('provider stays disabled and never borrows other department credentials',async()=>{
 assert.equal(configuration({GRAPH_CLIENT_ID:env.FINANCEIRO_GRAPH_CLIENT_ID,GRAPH_TENANT_ID:env.FINANCEIRO_GRAPH_TENANT_ID,GRAPH_CLIENT_SECRET:'other'}).configured,false);
 for(const settings of [{},{...env,FINANCEIRO_COMMUNICATION_SEND_ENABLED:'false'},{...env,FINANCEIRO_GRAPH_TENANT_ID:'host/evil'}])await assert.rejects(()=>createProvider({env:settings,fetchImpl:async()=>{assert.fail('network must not run');}}).send(message()));
 assert(!JSON.stringify(configuration(env)).includes('secret'));
});
test('Graph sends one bounded request with PDFs and records acceptance, not delivery/message-id',async()=>{
 const calls=[];const provider=createProvider({env,fetchImpl:async(url,options)=>{calls.push({url,options});assert.equal(options.redirect,'error');assert(options.signal);return calls.length===1?{ok:true,json:async()=>({access_token:'synthetic-token'})}:{status:202};}});
 const result=await provider.send(message());assert.deepEqual(result,{accepted:true,correlationId:'a'.repeat(64),provider:'microsoft-graph'});assert.equal(calls.length,2);
 assert.match(calls[0].url,/^https:\/\/login.microsoftonline.com\/00000000/);assert.match(calls[1].url,/financeiro%40spassessoriacontabil.com.br\/sendMail$/);
 const payload=JSON.parse(calls[1].options.body);assert.equal(payload.saveToSentItems,true);assert.equal(payload.message.toRecipients.length,1);assert.equal(payload.message.attachments[0].contentBytes,message().attachments[0].content.toString('base64'));assert.equal(payload.message.replyTo[0].emailAddress.address,SENDER);
});
test('invalid envelope, PDF, and oversized payload are blocked before network',async()=>{
 for(const patch of [{from:'other@example.com'},{replyTo:'other@example.com'},{to:'a@example.com\r\nBcc:b@example.com'},{subject:'x\ny'},{attachments:[{name:'large.pdf',type:'application/pdf',content:Buffer.concat([Buffer.from('%PDF-'),Buffer.alloc(3000000)])}]}])await assert.rejects(()=>createProvider({env,fetchImpl:async()=>assert.fail('no network')}).send({...message(),...patch}));
});
test('network failure and 429 do not trigger hidden automatic retries or leak response secrets',async()=>{
 for(const status of [400,401,403,429,500]){let n=0;const p=createProvider({env,fetchImpl:async()=>++n===1?{ok:true,json:async()=>({access_token:'secret'})}:{status,text:async()=>assert.fail('must not expose provider body')}});await assert.rejects(()=>p.send(message()),/não confirmado/);assert.equal(n,2);}
 let n=0;await assert.rejects(()=>createProvider({env,fetchImpl:async()=>{n++;throw Error('timeout');}}).send(message()));assert.equal(n,1);
});

test('Graph receives every confirmed address exactly once; invalid list blocks the whole send',async()=>{
 const calls=[],provider=createProvider({env,fetchImpl:async(url,options)=>{calls.push(options);return calls.length===1?{ok:true,json:async()=>({access_token:'synthetic'})}:{status:202};}});
 await provider.send({...message(),to:['B@example.com','a@example.com','b@example.com']});
 assert.deepEqual(JSON.parse(calls[1].body).message.toRecipients.map(r=>r.emailAddress.address),['a@example.com','b@example.com']);
 for(const to of [[],['a@example.com','invalid'],['a@example.com','b@example.com\r\nBcc:x@example.com'],Array(51).fill('a@example.com')])await assert.rejects(createProvider({env,fetchImpl:async()=>assert.fail('no network')}).send({...message(),to}));
});
