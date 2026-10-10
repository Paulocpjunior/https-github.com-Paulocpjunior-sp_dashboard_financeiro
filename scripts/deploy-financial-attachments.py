#!/usr/bin/env python3
"""Provisionamento explícito e protegido dos anexos financeiros."""
import argparse,json,pathlib,subprocess
ROOT=pathlib.Path(__file__).resolve().parents[1]
PROJECT='gen-lang-client-0888019226'
BUCKET=PROJECT+'-finance-attachments'
REGION='us-central1'
def run(*args):
 return subprocess.check_output(args,cwd=ROOT,text=True).strip()
def gc(*args):
 return run('gcloud',*args,'--project',PROJECT,'--quiet')
def main():
 p=argparse.ArgumentParser();p.add_argument('--apply',action='store_true');a=p.parse_args()
 if not a.apply:
  print(json.dumps({'bucket':BUCKET,'region':REGION,'publicAccess':'blocked','uniformAccess':True,'versioning':True,'softDeleteDays':30,'runtimeRoles':['roles/storage.objectCreator','roles/storage.objectViewer'],'service':'sp-pdf-download','envOnly':'NATIVE_ENTRY_ATTACHMENT_BUCKET','existingSharedBucket':'unchanged'},indent=2));return
 subprocess.run(['node','scripts/guard-production.mjs'],cwd=ROOT,check=True)
 service=json.loads(gc('run','services','describe','sp-pdf-download','--region',REGION,'--format=json'))
 spec=service['spec']['template']['spec'];account=spec['serviceAccountName']
 revision=json.loads(gc('run','revisions','describe',service['status']['latestReadyRevisionName'],'--region',REGION,'--format=json'))
 image=revision['status']['imageDigest']
 if '@sha256:' not in image:raise RuntimeError('Exige imagem imutável da revisão atual.')
 env={x['name']:x for x in spec['containers'][0].get('env',[])}
 previous=env.get('NATIVE_ENTRY_ATTACHMENT_BUCKET',{}).get('value','')
 if previous not in ['',BUCKET]:raise RuntimeError('Bucket já configurado diferente do plano. Não trocar automaticamente.')
 buckets=json.loads(gc('storage','buckets','list','--format=json'))
 if not any(b.get('name','').removeprefix('gs://').rstrip('/')==BUCKET for b in buckets):
  gc('storage','buckets','create','gs://'+BUCKET,'--location',REGION,'--uniform-bucket-level-access','--public-access-prevention','--soft-delete-duration=30d')
 policy=json.loads(gc('storage','buckets','get-iam-policy','gs://'+BUCKET,'--format=json'))
 if any(m in ['allUsers','allAuthenticatedUsers'] for b in policy.get('bindings',[]) for m in b.get('members',[])):
  raise RuntimeError('Bucket com permissão pública inesperada. Revisão necessária.')
 gc('storage','buckets','update','gs://'+BUCKET,'--uniform-bucket-level-access','--public-access-prevention','--versioning','--soft-delete-duration=30d')
 for role in ['roles/storage.objectCreator','roles/storage.objectViewer']:
  gc('storage','buckets','add-iam-policy-binding','gs://'+BUCKET,'--member','serviceAccount:'+account,'--role',role)
 state=json.loads(gc('storage','buckets','describe','gs://'+BUCKET,'--format=json'))
 assert state['uniform_bucket_level_access'] is True and state['public_access_prevention']=='enforced'
 assert state['versioning_enabled'] is True
 assert int(state['soft_delete_policy']['retentionDurationSeconds'])>=2592000
 # Atualiza somente a variável; preserva imagem, segredos, conta e demais configurações.
 gc('run','services','update','sp-pdf-download','--region',REGION,'--image',image,'--update-env-vars','NATIVE_ENTRY_ATTACHMENT_BUCKET='+BUCKET)
 verified=json.loads(gc('run','services','describe','sp-pdf-download','--region',REGION,'--format=json'))
 actual={x['name']:x for x in verified['spec']['template']['spec']['containers'][0]['env']}
 assert actual['NATIVE_ENTRY_ATTACHMENT_BUCKET']['value']==BUCKET
 for name,value in env.items():
  if name!='NATIVE_ENTRY_ATTACHMENT_BUCKET':assert actual[name]==value
 assert verified['spec']['template']['spec']['serviceAccountName']==account
 assert verified['spec']['template']['spec']['containers'][0]['image']==image
 assert verified['status']['latestReadyRevisionName']==verified['status']['latestCreatedRevisionName']
 print('Bucket privado e configuração verificados. Validar upload/download sintético antes de declarar homologação.')
if __name__=='__main__':main()
