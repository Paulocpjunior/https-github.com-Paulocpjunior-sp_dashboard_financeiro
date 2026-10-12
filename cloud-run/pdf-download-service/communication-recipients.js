function recipients(value){
 const values=Array.isArray(value)?value:[value];
 if(!values.length||values.length>50)throw Error('Informe de 1 a 50 e-mails conferidos.');
 const result=values.map(v=>{
  if(typeof v!=='string'||v.length>254||! /^[^\s<>@,;]+@[^\s<>@,;]+\.[^\s<>@,;]+$/.test(v.trim()))throw Error('Destinatário inválido.');
  return v.trim().toLowerCase();
 });
 return [...new Set(result)].sort();
}
const contactRecipients=c=>recipients(c?.emails??c?.email);
module.exports={recipients,contactRecipients};
