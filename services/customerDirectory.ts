import {auth} from './firebaseConfig';
import {Transaction} from '../types';
export type CustomerProfile={client:string;cpfCnpj:string;clientNumber:string};
export type CustomerDirectory={revision:number;entries:Record<string,CustomerProfile&{target?:string}>};
// The cached application profile can load before Firebase restores its session.
// Wait for Firebase before deciding that a new login is required.
export function createCustomerApi(authClient: Pick<typeof auth,'authStateReady'|'currentUser'>, fetcher: typeof fetch = fetch) {
 return async (path:string,body?:unknown) => {
  await authClient.authStateReady();
  const user=authClient.currentUser;
  if(!user)throw Object.assign(Error('Entre novamente.'),{status:401});
  const token=await user.getIdToken();
  const r=await fetcher('/api/financial-entries/customers/'+path,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
  const d=await r.json();if(!r.ok)throw Object.assign(Error(d.error||'Consulta cadastral indisponível.'),{status:r.status});return d;
 };
}
export const customerApi=createCustomerApi(auth);
const norm=(x:unknown)=>String(x||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
const digits=(x:unknown)=>String(x||'').replace(/\D/g,'');
export function applyCustomerDirectory(row:Transaction,directory:CustomerDirectory){
 if(norm(row.movement)!=='entrada')return;
 const original=row.customerOriginal||{client:row.client,cpfCnpj:row.cpfCnpj||'',clientNumber:String(row.clientNumber||'')};
 let key=digits(original.cpfCnpj)?'doc:'+digits(original.cpfCnpj):digits(original.clientNumber)?'number:'+digits(original.clientNumber):'name:'+norm(row.source)+':'+norm(original.client);
 const seen=new Set<string>();while(directory.entries[key]?.target){if(seen.has(key)||seen.size>20)throw Error('Vínculo cadastral circular.');seen.add(key);key=directory.entries[key].target!;}
 const p=directory.entries[key];if(p){row.customerOriginal=original;row.client=p.client;row.cpfCnpj=p.cpfCnpj;row.clientNumber=p.clientNumber;}
}
