import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { createServer } from 'vite';
if(!globalThis.crypto)globalThis.crypto=webcrypto;
const server=await createServer({server:{middlewareMode:true},optimizeDeps:{noDiscovery:true},appType:'custom',logLevel:'error'});
try {
 const {proposeChecklistTerms:propose,validateMonthlyTerms:validate,fingerprintMonthlyRow:fingerprint}=await server.ssrLoadModule('/utils/billingConfirmation.ts');
 const proposal=propose('<div>Valor da mensalidade: R$ 1.250,50</div><div>CNPJ: 11.111.111/0001-11</div><div>Responsabilidade a partir de <b>01/10/2026</b>. Cobrar dia 10. Última cobrança em 10/09/2026.</div>');
 assert.equal(proposal.amounts[0].value,1250.5);assert.equal(proposal.startDates[0].value,'2026-10-01');assert.equal(proposal.documents[0].value,'11111111000111');assert.equal(proposal.automaticallyConfirmed,false);
 assert.equal(propose('Mensalidade: R$ 500,00. Honorários: R$ 600,00.').amounts.length,2,'não escolher valor divergente');
 assert.equal(propose('Responsabilidade a partir de 31/09/2026').startDates.length,0);
 const value={month:'2026-10',identity:'number:123',client:'Teste',decision:'charge',amount:500,dueDate:'2026-10-10',startDate:'2026-10-01',billingDay:10,lastChargeDate:'',evidence:'Contrato conferido',event:'entrada',sourceFingerprint:'a'.repeat(64)};
 assert.deepEqual(validate(value,true),[]);assert.ok(validate(value,false).some(e=>e.includes('administrador')));
 assert.ok(validate({...value,event:'saida'},true).some(e=>e.includes('última cobrança')));
 assert.ok(validate({...value,event:'suspensao'},true).length);
 assert.ok(validate({...value,event:'multiplos'},true).length);
 assert.ok(validate({...value,identity:'unidentified:abc'},true).length);
 assert.ok(validate({...value,decision:'waive'},true).length);
 assert.ok(validate({...value,dueDate:'2026-02-31'},true).length);
 assert.deepEqual(validate({...value,decision:'needs_review',amount:null,dueDate:'',startDate:'',billingDay:0},false),[]);
 const row={identity:'number:123',client:'Teste',previousAmount:500,currentAmount:0,previousIds:['old'],currentIds:[],checklist:[],issues:[],financialSource:'snapshot1'};
 const a=await fingerprint(row,'2026-10','dueDate'); assert.equal(a.length,64);
 assert.notEqual(a,await fingerprint({...row,financialSource:'snapshot2'},'2026-10','dueDate'));
 assert.notEqual(a,await fingerprint(row,'2026-11','dueDate'));
 const checklist={submissionId:'synthetic-1',identity:'number:123',document:'11111111000111',clientNumber:'123',client:'Teste',status:'entrada',amount:500,entryDate:'2026-10-01',exitDate:null,suspensionDate:null,notes:'Contrato',sourceUpdatedAt:'2026-10-01 10:00:00',sourceCreatedAt:'2026-10-01 10:00:00',issues:['Aviso B','Aviso A'],observationsRequireReview:false,contractValidated:false};
 const sourceRow={...row,situation:'lancamento_localizado',checklist:[checklist,{...checklist,submissionId:'synthetic-2'}]};
 const before=JSON.stringify(sourceRow);
 const baseline=await fingerprint(sourceRow,'2026-10','dueDate');
 for(const patch of [{identity:'number:456'},{document:'22222222000122'},{clientNumber:'456'},{client:'Outro cliente'},{issues:['Novo alerta']},{observationsRequireReview:true}]) {
   assert.notEqual(baseline,await fingerprint({...sourceRow,checklist:[{...checklist,...patch},sourceRow.checklist[1]]},'2026-10','dueDate'),'alteração cadastral ou de alerta exige revalidação mesmo sem mudança em updatedAt');
 }
 assert.notEqual(baseline,await fingerprint({...sourceRow,client:'Nome atualizado'},'2026-10','dueDate'));
 assert.notEqual(baseline,await fingerprint({...sourceRow,situation:'identificacao'},'2026-10','dueDate'));
 assert.equal(baseline,await fingerprint({...sourceRow,checklist:[...sourceRow.checklist].reverse().map(r=>({...r,issues:[...r.issues].reverse()}))},'2026-10','dueDate'),'ordem da resposta e dos avisos não altera assinatura');
 assert.equal(JSON.stringify(sourceRow),before,'assinatura não modifica as fontes');
 const {buildBillingObligations:build}=await server.ssrLoadModule('/utils/billingObligations.ts');
 const tx={id:'old',client:'Teste',clientNumber:'',cpfCnpj:'',dueDate:'2026-09-10',date:'2026-09-01',movement:'Entrada',type:'Contas a Receber',status:'Pago',valorOriginal:500};
 const result=build([tx],[],'2026-10','dueDate',[{sourceIdentity:'unidentified:old',targetIdentity:'number:123',evidence:'Documento',revision:1}]);
 assert.equal(result.rows[0].identity,'number:123');assert.equal(tx.clientNumber,'','não editar lançamento');
 console.log('OK: propostas não aprovam regras; confirmação exige administrador/evidências; saídas exigem última cobrança; assinatura detecta mudanças; vínculos preservam transações.');
} finally {await server.close();}
