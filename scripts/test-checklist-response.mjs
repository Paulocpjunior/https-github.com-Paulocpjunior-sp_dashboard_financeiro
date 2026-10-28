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
  // Checklist do app Legalização pelo túnel do CFI (28/10: Jotform saiu).
  const { mapLegalizacaoChecklist, parseHonorarios } = await server.ssrLoadModule('/utils/legalizacaoChecklist.ts');
  assert.equal(parseHonorarios('1.200,50'), 1200.5); assert.equal(parseHonorarios(''), null); assert.equal(parseHonorarios('0'), null);
  const tunel = {ok:true,honorarios:true,cortado:false,itens:[
    {id:'doc_07147345000111',empresaNome:'RADIO SB FM LTDA',documento:'07147345000111',statusCliente:'CLIENTE NOVO',datas:{cadastro:'2026-10-01',saida:null,suspensao:null},honorarios:'1.200,00',nossoNumero:'170',observacao:{texto:'Início em 01/10'},atualizadoEm:'2026-10-27T10:00:00Z'},
    {id:'nome_SEM_DOC',empresaNome:'SEM DOC',documento:null,statusCliente:'CLIENTE SAIDA',datas:{cadastro:'2026-05-01',saida:'2026-04-01'},honorarios:null,nossoNumero:null,observacao:null,atualizadoEm:null}]};
  const lido = await mapLegalizacaoChecklist(tunel, '2026-10-28T12:00:00Z');
  validate(lido);
  assert.equal(lido.records[0].submissionId,'legalizacao/doc_07147345000111'); assert.equal(lido.records[0].identity,'doc:07147345000111');
  assert.equal(lido.records[0].amount,1200); assert.equal(lido.records[0].clientNumber,'170'); assert.equal(lido.records[0].notes,'Início em 01/10');
  assert.equal(lido.records[1].amount,null,'honorário ausente não vira zero');
  assert.ok(lido.records[1].issues.includes('Saída anterior à entrada')); assert.ok(lido.records[1].issues.includes('Identificação ausente: não unir por nome'));
  await assert.rejects(mapLegalizacaoChecklist({...tunel,honorarios:false},'2026-10-28T12:00:00Z'),/honorários/);
  await assert.rejects(mapLegalizacaoChecklist({...tunel,cortado:true},'2026-10-28T12:00:00Z'),/cortado/);
  assert.throws(()=>validate({...lido,records:lido.records.map((r,i)=>i?r:{...r,submissionId:'123'})}),/leitura completa/);
  console.log('OK: contrato do checklist bloqueia estrutura inválida, duplicidade e totais inconsistentes; pendências legítimas são preservadas.');
} finally { await server.close(); }
