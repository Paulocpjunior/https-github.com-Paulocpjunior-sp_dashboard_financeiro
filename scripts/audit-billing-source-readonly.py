"""Auditoria agregada do histórico real. Somente leitura; não exporta dados individuais."""
import json,os,pathlib,datetime,requests,re,unicodedata
from google.oauth2 import service_account
from google.auth.transport.requests import Request
PROJECT='gen-lang-client-0888019226'
credentials=service_account.Credentials.from_service_account_info(json.loads(os.environ['GCP_CREDENTIALS']),scopes=['https://www.googleapis.com/auth/datastore'])
credentials.refresh(Request());headers={'Authorization':'Bearer '+credentials.token}
url='https://firestore.googleapis.com/v1/projects/'+PROJECT+'/databases/(default)/documents:runQuery'
fields=['cpfCnpj','clientNumber','date','dueDate','type','movement','status','isExcluded','source','wixInvoiceNumber','wixEntityId','description','client','valueReceived','valuePaid']
read_time=None;last=None;seen=set();total=0;receivables=0;missing=0;bad_dates=0;links={}
def value(fields,key):
 f=fields.get(key,{})
 return next(iter(f.values()),None)
def normalize(raw):
 return ''.join(c for c in unicodedata.normalize('NFD',str(raw or '').lower()) if unicodedata.category(c)!='Mn').strip()
def money(raw):
 text=re.sub(r'[^0-9,.-]','',str(raw or ''))
 if ',' in text and '.' in text:text=text.replace('.','').replace(',','.')
 elif ',' in text:text=text.replace(',','.')
 elif re.match(r'^-?[0-9]{1,3}(\.[0-9]{3})+$',text):text=text.replace('.','')
 try:return float(text or 0)
 except:return 0
def valid_date(raw):
 try:return isinstance(raw,str) and datetime.date.fromisoformat(raw).isoformat()==raw
 except:return False
for page in range(500):
 query={'from':[{'collectionId':'transactions'}],'select':{'fields':[{'fieldPath':field} for field in fields]},'orderBy':[{'field':{'fieldPath':'__name__'},'direction':'ASCENDING'}],'limit':1000}
 if last:query['startAt']={'values':[{'referenceValue':last}],'before':False}
 body={'structuredQuery':query}
 if read_time:body['readTime']=read_time
 response=requests.post(url,headers=headers,json=body,timeout=60);response.raise_for_status();batch=response.json();documents=[]
 for entry in batch:
  if not read_time and entry.get('readTime'):read_time=entry['readTime']
  if 'document' in entry:documents.append(entry['document'])
 for document in documents:
  name=document['name']
  assert name not in seen,'Paginação repetiu documentos';seen.add(name);total+=1
  f=document.get('fields',{})
  if value(f,'isExcluded') is True:continue
  kind=normalize(value(f,'type'));movement=normalize(value(f,'movement'))
  wix=normalize(value(f,'source'))=='wix' or name.rsplit('/',1)[-1].lower().startswith('wix-inv-') or bool(value(f,'wixInvoiceNumber')) or bool(value(f,'wixEntityId')) or 'fatura wix' in normalize(value(f,'description')) or 'fatura wix' in normalize(value(f,'client'))
  if not (wix or 'receber' in kind or 'entrada' in kind or movement=='entrada' or (money(value(f,'valueReceived'))>0 and money(value(f,'valuePaid'))==0)):continue
  receivables+=1
  doc=''.join(c for c in str(value(f,'cpfCnpj') or '') if c.isdigit());number=str(value(f,'clientNumber') or '').strip().lstrip('0')
  valid=len(doc) in [11,14]
  if not valid and not number:missing+=1
  if valid and number:links.setdefault(number,set()).add(doc)
  if not valid_date(value(f,'dueDate')):bad_dates+=1
 if len(documents)<1000:break
 last=documents[-1]['name']
else:raise RuntimeError('Histórico excedeu limite; auditoria incompleta.')
report={'complete':True,'readTime':read_time,'records':total,'receivables':receivables,'receivablesWithoutIdentity':missing,'clientNumbersWithDifferentDocuments':sum(len(v)>1 for v in links.values()),'receivablesWithInvalidDueDate':bad_dates,'interpretation':'Contagens de qualidade da fonte; não certificam contratos ou ausência de cobrança.','mutations':0}
pathlib.Path('rules-backup').mkdir(exist_ok=True)
pathlib.Path('rules-backup/auditoria-agregada-fontes.json').write_text(json.dumps(report,indent=2))
print(json.dumps(report))
