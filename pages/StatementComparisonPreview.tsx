import React,{useState} from 'react';
import {LegacyLinkModal} from '../components/LegacyLinkControls';
import BankingFlowScope from '../components/BankingFlowScope';
import StatementPaymentComparison from '../components/StatementPaymentComparison';
import type {PaymentComparison} from '../services/itauStatementService';
const candidate={id:'baixa-demo',transactionId:'conta-ficticia',date:'2026-10-09',amountCents:10000,supplier:'Fornecedor fictício'};
const statuses=['suggestion','ambiguous','no-candidate','outside-scope'] as const;
const comparison:PaymentComparison={
 start:'2026-10-01',end:'2026-10-11',paymentStart:'2026-09-28',paymentEnd:'2026-10-14',generatedAt:'2026-10-11T12:00:00Z',
 legacy:{coverage:'Dados fictícios. Valor pago explícito; nenhuma baixa automática.',examined:5,paymentCount:2,excluded:{native:1,inactiveOrOutsideScope:1,invalidEvidence:1,differentBank:0},rows:[{statement:{id:'antigo',fitid:'DEMO-ANTIGO',date:'2026-10-09',amountCents:-10000,name:'Pagamento antigo fictício',memo:'',type:'OTHER',checknum:''},ambiguous:true,candidates:[{...candidate,id:'antigo-1',bankEvidence:'missing'},{...candidate,id:'antigo-2',supplier:'Segundo fornecedor fictício',bankEvidence:'same-account'}]}]},
 counts:{suggestion:1,ambiguous:1,'no-candidate':1,'outside-scope':1},paymentCount:3,unmatchedPayments:[],
 coverage:'Somente baixas nativas de contas a pagar da conta Itaú, sem estornos. Dados desta página são fictícios.',
 criterion:'Mesmo valor efetivamente pago, mesma conta bancária e diferença de até 3 dias corridos. Sugestões não confirmam identidade do favorecido nem registram conciliação.',
 rows:statuses.map((status,i)=>({status,statement:{id:String(i),fitid:'FICTICIO-'+i,date:'2026-10-09',amountCents:i===3?10000:-10000,name:'Movimentação fictícia '+(i+1),memo:'',type:'OTHER',checknum:''},candidates:status==='suggestion'?[candidate]:status==='ambiguous'?[{...candidate,id:'b'},{...candidate,id:'c',supplier:'Outro fornecedor fictício'}]:[]}))
};
const demoApi={previewLegacyLink:async()=>({fingerprint:'a'.repeat(64),revision:0,statement:{id:'demo',date:'2026-10-09',amountCents:-10000,name:'Pagamento fictício',fitid:'DEMO'},payment:{...candidate,bankEvidence:'missing' as const}}),confirmLegacyLink:async()=>({active:true}),unlinkLegacyLink:async()=>({active:false})};
const demoTarget={statementId:'demo',transactionId:'conta-ficticia'};
export default function StatementComparisonPreview(){const [review,setReview]=useState(false);return <main className="p-6 bg-slate-100 min-h-screen text-slate-900"><h1 className="text-xl font-bold mb-5">Simulação local — conferência bancária sem alterações financeiras</h1><button className="rounded-lg bg-blue-700 text-white px-4 py-3 mb-4" onClick={()=>setReview(true)}>Simular revisão de vínculo (dados fictícios)</button>{review&&<LegacyLinkModal target={demoTarget} unlink={null} api={demoApi} onClose={()=>setReview(false)}/>}<div className="space-y-5"><BankingFlowScope/><StatementPaymentComparison comparison={comparison}/></div></main>;}
