import {auth} from '../firebase';
import type {FilterState, Transaction} from '../types';
async function request(path:string, body?:unknown) {
 const user=auth.currentUser;
 if(!user)throw new Error('Entre novamente para consultar a FiA.');
 const response=await fetch(`/api/financial-ai/${path}`,{method:body?'POST':'GET',cache:'no-store',headers:{Authorization:`Bearer ${await user.getIdToken()}`,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
 if(!response.headers.get('content-type')?.includes('application/json'))throw new Error('FiA ainda não disponível neste ambiente.');
 const data=await response.json();
 if(!response.ok)throw new Error(data.error||'Não foi possível consultar a FiA.');
 return data;
}
async function query(mode:string, question:string, transactions:Transaction[]=[]) {
 if(transactions.length>300)throw new Error('Use os filtros para selecionar até 300 lançamentos. A FiA não analisa recortes incompletos silenciosamente.');
 return request('query',{mode,query:question,transactionIds:transactions.map(t=>t.id)});
}
function answer(result:any):string {
 return `${result.explanation}\n\nFonte: ${result.source.count} lançamentos do recorte atual, relidos no Firestore em ${new Date(result.source.readAt).toLocaleString('pt-BR')}. Não abrange necessariamente todo o histórico.`;
}
export const GeminiService={
 status:async():Promise<{enabled:boolean;readOnly:boolean;maxRecords:number}>=>request('status'),
 detectMode:async(query:string):Promise<'filter'|'analysis'|'forecast'>=>{
  const q=query.toLowerCase();
  if(/previsão|projetar|forecast|futuro/.test(q))return 'forecast';
  if(/quem|qual|análise|resumo|por que|como/.test(q))return 'analysis';
  return 'filter';
 },
 interpretQuery:async(question:string):Promise<{filters:Partial<FilterState>;explanation:string}>=>query('filter',question),
 analyzeData:async(question:string,transactions:Transaction[]):Promise<string>=>answer(await query('analysis',question,transactions)),
 forecastCashFlow:async(transactions:Transaction[]):Promise<string>=>answer(await query('forecast','Projete o fluxo dos próximos 30 dias usando somente este recorte. Não há saldo bancário inicial informado.',transactions)),
};
