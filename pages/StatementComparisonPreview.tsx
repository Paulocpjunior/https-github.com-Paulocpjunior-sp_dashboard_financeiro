import React from 'react';
import StatementPaymentComparison from '../components/StatementPaymentComparison';
import type {PaymentComparison} from '../services/itauStatementService';
const candidate={id:'baixa-demo',transactionId:'conta-ficticia',date:'2026-10-09',amountCents:10000,supplier:'Fornecedor fictício'};
const statuses=['suggestion','ambiguous','no-candidate','outside-scope'] as const;
const comparison:PaymentComparison={
 start:'2026-10-01',end:'2026-10-11',paymentStart:'2026-09-28',paymentEnd:'2026-10-14',generatedAt:'2026-10-11T12:00:00Z',
 counts:{suggestion:1,ambiguous:1,'no-candidate':1,'outside-scope':1},paymentCount:3,unmatchedPayments:[],
 coverage:'Somente baixas nativas de contas a pagar da conta Itaú, sem estornos. Dados desta página são fictícios.',
 criterion:'Mesmo valor efetivamente pago, mesma conta bancária e diferença de até 3 dias corridos. Sugestões não confirmam identidade do favorecido nem registram conciliação.',
 rows:statuses.map((status,i)=>({status,statement:{id:String(i),fitid:'FICTICIO-'+i,date:'2026-10-09',amountCents:i===3?10000:-10000,name:'Movimentação fictícia '+(i+1),memo:'',type:'OTHER',checknum:''},candidates:status==='suggestion'?[candidate]:status==='ambiguous'?[{...candidate,id:'b'},{...candidate,id:'c',supplier:'Outro fornecedor fictício'}]:[]}))
};
export default function StatementComparisonPreview(){return <main className="p-6 bg-slate-100 min-h-screen text-slate-900"><h1 className="text-xl font-bold mb-5">Simulação local — conferência bancária sem alterações financeiras</h1><StatementPaymentComparison comparison={comparison}/></main>;}
