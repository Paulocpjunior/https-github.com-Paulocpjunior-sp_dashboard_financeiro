const {recipients}=require('./communication-recipients');
const {SENDER,validateArtifacts}=require('./communication-rule');
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const keys=['FINANCEIRO_GRAPH_TENANT_ID','FINANCEIRO_GRAPH_CLIENT_ID','FINANCEIRO_GRAPH_CLIENT_SECRET'];
function configuration(env=process.env){return {configured:UUID.test(env[keys[0]]||'')&&UUID.test(env[keys[1]]||'')&&Boolean(env[keys[2]]),sender:SENDER};}
function createProvider({env=process.env,fetchImpl=fetch}={}){
 return {async send(message){
  if(env.FINANCEIRO_COMMUNICATION_SEND_ENABLED!=='true')throw Error('Envio desativado.');
  if(!configuration(env).configured)throw Error('Canal do Financeiro não configurado.');
  if(message.from!==SENDER||message.replyTo!==SENDER||! /^[a-f0-9]{64}$/.test(message.idempotencyKey||''))throw Error('Envelope inválido.');
  const to=recipients(message.to);
  validateArtifacts(message);
  const payload=JSON.stringify({message:{subject:message.subject,body:{contentType:'Text',content:message.text},toRecipients:to.map(address=>({emailAddress:{address}})),replyTo:[{emailAddress:{address:SENDER}}],internetMessageHeaders:[{name:'x-financeiro-reference',value:message.idempotencyKey}],attachments:message.attachments.map(a=>({'@odata.type':'#microsoft.graph.fileAttachment',name:a.name,contentType:a.type,contentBytes:a.content.toString('base64')}))},saveToSentItems:true});
  // Graph direct attachment requests must fit the request limit. Do not silently drop files.
  if(message.attachments.some(a=>a.content.length>=3000000)||Buffer.byteLength(payload)>3900000)throw Error('Mensagem excede o limite do canal.');
  const tokenResponse=await fetchImpl(`https://login.microsoftonline.com/${env[keys[0]]}/oauth2/v2.0/token`,{method:'POST',redirect:'error',signal:AbortSignal.timeout(15000),headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:env[keys[1]],client_secret:env[keys[2]],scope:'https://graph.microsoft.com/.default',grant_type:'client_credentials'}).toString()});
  if(!tokenResponse.ok)throw Error('Autenticação do canal indisponível.');
  const token=await tokenResponse.json();if(typeof token.access_token!=='string'||!token.access_token)throw Error('Autenticação do canal indisponível.');
  const response=await fetchImpl(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(SENDER)}/sendMail`,{method:'POST',redirect:'error',signal:AbortSignal.timeout(25000),headers:{Authorization:`Bearer ${token.access_token}`,'Content-Type':'application/json'},body:payload});
  // sendMail has no message-id response. Keep correlation separate from message identity and delivery.
  if(response.status!==202)throw Error('Resultado do envio não confirmado.');
  return {accepted:true,correlationId:message.idempotencyKey,provider:'microsoft-graph'};
 }};
}
module.exports={configuration,createProvider};
