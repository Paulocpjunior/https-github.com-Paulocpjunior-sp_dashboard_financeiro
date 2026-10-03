"""Publica somente a adição das coleções de conferência; preserva regras homologadas."""
import json,os,pathlib,subprocess,requests
from google.oauth2 import service_account
from google.auth.transport.requests import Request
PROJECT='gen-lang-client-0888019226'
subprocess.run(['node','scripts/guard-production.mjs'],check=True)
base=subprocess.check_output(['git','show','b1b58212e712918e9a0bc99f82861a1418759698:firestore.rules'],text=True)
new=pathlib.Path('firestore.rules').read_text()
previous=subprocess.check_output(['git','show','9de2299d5e9950cd9521a6e684e5c44c75a2a62b:firestore.rules'],text=True)
task_start=new.index('    // Acompanhamento operacional:')
task_end=new.index('    match /{document=**}',task_start)
assert new[:task_start]+new[task_end:]==previous,'A fila só pode adicionar seu namespace; regras anteriores devem permanecer idênticas.'
start=new.index('    // Conferências independentes:')
end=new.index('    match /{document=**}',start)
assert new[:start]+new[end:]==base,'A alteração não pode modificar permissões anteriores.'
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
assert old.strip() in [base.strip(),previous.strip(),new.strip()],'Regras atuais divergiram das versões homologadas exatas; publicação bloqueada.'
pathlib.Path('rules-backup').mkdir(exist_ok=True)
pathlib.Path('rules-backup/previous-release.json').write_text(json.dumps(release))
pathlib.Path('rules-backup/previous-firestore.rules').write_text(old)
if old.strip()!=new.strip():
 ruleset=api('POST','projects/'+PROJECT+'/rulesets',{'source':{'files':[{'name':'firestore.rules','content':new}]}})
 api('PATCH','projects/'+PROJECT+'/releases/cloud.firestore',{'release':{'name':'projects/'+PROJECT+'/releases/cloud.firestore','rulesetName':ruleset['name']},'updateMask':'rulesetName'})
verified=api('GET','projects/'+PROJECT+'/releases/cloud.firestore')
assert api('GET',verified['rulesetName'])['source']['files'][0]['content'].strip()==new.strip()
print('Regras de conferência publicadas e verificadas. Permissões anteriores preservadas; backup das regras criado.')
