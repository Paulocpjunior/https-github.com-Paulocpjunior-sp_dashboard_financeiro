import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { createRequire } from 'node:module';
const { mapChecklist } = createRequire(import.meta.url)('../cloud-run/jotform-webhook/checklist.js');
const server = await createServer({server:{middlewareMode:true},optimizeDeps:{noDiscovery:true},appType:'custom',logLevel:'error'});
try {
  const { assertChecklistResponse: validate } = await server.ssrLoadModule('/utils/checklistResponse.ts');
  const row = {submissionId:'123',identity:'number:42',client:'Teste',clientNumber:'42',document:'',amount:500,entryDate:null,exitDate:null,suspensionDate:null,status:'ATIVO',notes:null,sourceUpdatedAt:null,issues:[],observationsRequireReview:false,contractValidated:false};
  const response = {formId:'210135417457653',title:'Checklist',complete:true,canCloseMonth:false,expected:1,received:1,active:1,excluded:0,validRecords:1,conflictRecords:0,observationsToReview:0,sourceFingerprint:'a'.repeat(64),readAt:'2026-10-03T12:00:00Z',records:[row]};
  const before = JSON.stringify(response);
  validate(response);
  for (const patch of [{submissionId:''},{submissionId:123},{amount:NaN},{amount:Infinity},{amount:'500'},{amount:0},{issues:null},{issues:[42]},{contractValidated:true},{observationsRequireReview:'false'},{identity:null},{client:{}},{document:42}]) {
    assert.throws(()=>validate({...response,records:[{...row,...patch}]}),/leitura completa/);
  }
  for (const patch of [{complete:false},{canCloseMonth:true},{sourceFingerprint:'invalid'},{readAt:null},{expected:2},{observationsToReview:1},{validRecords:0,conflictRecords:1},{records:null}]) assert.throws(()=>validate({...response,...patch}));
  assert.throws(()=>validate({...response,expected:2,received:2,active:2,validRecords:2,records:[row,row]}),'IDs repetidos não comprovam cobertura');
  validate({...response,validRecords:0,conflictRecords:1,records:[{...row,amount:null,identity:'',client:null,issues:['Dados ausentes na fonte']}]});
  validate({...response,expected:0,received:0,active:0,validRecords:0,records:[]});
  const mapped = mapChecklist({'1':{text:'EMPRESA NOME'},'2':{text:'NOSSO NUMERO'},'3':{text:'HONORARIOS'},'4':{text:'OBSERVACAO'}},[{id:'456',answers:{}}]);
  validate({...response,...mapped}); // Real backend mapper, synthetic incomplete source.
  assert.equal(JSON.stringify(response),before,'validação não modifica a resposta');
  console.log('OK: contrato do checklist bloqueia estrutura inválida, duplicidade e totais inconsistentes; pendências legítimas são preservadas.');
} finally { await server.close(); }
