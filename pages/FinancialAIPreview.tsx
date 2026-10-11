import React from 'react';
import AIAssistant from '../components/AIAssistant';
import {GeminiService} from '../services/geminiService';
const fixture:typeof GeminiService={
 status:async()=>({enabled:true,readOnly:true,maxRecords:300}),
 detectMode:GeminiService.detectMode,
 interpretQuery:async()=>({filters:{status:'Pendente'},explanation:'Simulação: filtro de pendentes. Nenhum dado foi alterado.'}),
 analyzeData:async()=> 'Simulação: este recorte fictício contém uma conta a receber pendente de R$ 100,00. Fonte: exemplo-001. Não é uma consulta à produção.',
 forecastCashFlow:async()=> 'Simulação: entrada prevista de R$ 100,00. Sem saldo bancário inicial; não representa saldo disponível.',
};
export default function FinancialAIPreview(){return <main className="min-h-screen bg-slate-100 p-8 text-slate-900"><h1 className="text-2xl font-bold">MiA · Validação local</h1><p>Respostas fictícias para testar a interface, sem acesso a dados financeiros ou ao modelo.</p><AIAssistant transactions={[]} onApplyFilters={()=>{}} service={fixture}/></main>;}
