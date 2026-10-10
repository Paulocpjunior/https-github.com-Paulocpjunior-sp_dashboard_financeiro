"""Publica a proteção das baixas; preserva as demais regras homologadas."""
import json,os,pathlib,subprocess,requests
from google.oauth2 import service_account
from google.auth.transport.requests import Request
PROJECT='gen-lang-client-0888019226'
subprocess.run(['node','scripts/guard-production.mjs'],check=True)
base=subprocess.check_output(['git','show','cc46956de30c5f87250644d70c1fa43b611436bd:firestore.rules'],text=True)
new=pathlib.Path('firestore.rules').read_text()
# Somente a função de atualização e a condição de update de transactions mudam.
# Todas as demais permissões precisam permanecer idênticas à versão homologada.
def without_payment_guard(source):
 start=source.index('    function isLimitedPaymentUpdate()') if '    function isLimitedPaymentUpdate()' in source else source.index('    // Baixas usam o servidor,')
 end=source.index('    match /users/',start)
 return (source[:start]+source[end:]).replace('allow update: if isAdmin() || isLimitedPaymentUpdate();','allow update: if isAdministrativeExclusion();')
assert without_payment_guard(new)==without_payment_guard(base),'Alteração fora do escopo da proteção de baixas.'
assert 'allow update: if isAdministrativeExclusion();' in new
credentials=service_account.Credentials.from_service_account_info(json.loads(os.environ['GCP_CREDENTIALS']),scopes=['https://www.googleapis.com/auth/cloud-platform'])
credentials.refresh(Request());headers={'Authorization':'Bearer '+credentials.token}
root='https://firebaserules.googleapis.com/v1/'
def api(method,path,body=None):
 r=requests.request(method,root+path,headers=headers,json=body,timeout=60)
 if not r.ok: raise RuntimeError('Rules HTTP '+str(r.status_code)+': '+r.json().get('error',{}).get('message','Falha'))
 return r.json()
release=api('GET','projects/'+PROJECT+'/releases/cloud.firestore')
current=api('GET',release['rulesetName'])
files=current['source']['files']
assert len(files)==1,'Mais de um arquivo de regras em produção: revisar antes de publicar.'
old=files[0]['content']
assert old.strip() in [base.strip(),new.strip()],'Regras atuais divergiram das versões homologadas exatas; publicação bloqueada.'
pathlib.Path('rules-backup').mkdir(exist_ok=True)
pathlib.Path('rules-backup/previous-release.json').write_text(json.dumps(release))
pathlib.Path('rules-backup/previous-firestore.rules').write_text(old)
if old.strip()!=new.strip():
 ruleset=api('POST','projects/'+PROJECT+'/rulesets',{'source':{'files':[{'name':'firestore.rules','content':new}]}})
 api('PATCH','projects/'+PROJECT+'/releases/cloud.firestore',{'release':{'name':'projects/'+PROJECT+'/releases/cloud.firestore','rulesetName':ruleset['name']},'updateMask':'rulesetName'})
verified=api('GET','projects/'+PROJECT+'/releases/cloud.firestore')
assert api('GET',verified['rulesetName'])['source']['files'][0]['content'].strip()==new.strip()
print('Regras de conferência publicadas e verificadas. Baixas diretas bloqueadas; demais permissões preservadas; backup das regras criado.')
