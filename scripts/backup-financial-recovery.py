#!/usr/bin/env python3
"""Complementa um backup Firestore identificado; não escreve em serviços de produção."""
import argparse,base64,hashlib,json,os,pathlib,subprocess,urllib.request,urllib.parse,urllib.error,datetime
PROJECT='gen-lang-client-0888019226'
def digest(data):return hashlib.sha256(data).hexdigest()
def save(path,data):
 with open(path,'xb') as f:os.chmod(path,0o600);f.write(data)
def main():
 p=argparse.ArgumentParser();p.add_argument('--firestore',required=True);p.add_argument('--bucket',required=True);p.add_argument('--out',required=True);a=p.parse_args()
 os.umask(0o077)
 source=pathlib.Path(a.firestore).resolve();raw=source.read_bytes()
 if digest(raw)!=pathlib.Path(str(source)+'.sha256').read_text().split()[0]:raise ValueError('Checksum Firestore divergente')
 snapshot=json.loads(raw)
 if snapshot['projectId']!=PROJECT or not snapshot.get('preservesFirestoreTypes'):raise ValueError('Exige backup tipado do projeto Financeiro')
 subprocess.run(['node',str(pathlib.Path(__file__).with_name('verify-financial-backup.mjs')),str(source)],check=True,stdout=subprocess.DEVNULL)
 if not a.bucket.startswith(PROJECT):raise ValueError('Bucket fora do projeto esperado')
 root=pathlib.Path(a.out).resolve();root.mkdir(mode=0o700,parents=True,exist_ok=False)
 save(root/'firestore.json',raw)
 token=subprocess.check_output(['gcloud','auth','print-access-token'],text=True).strip()
 def get(url):
  return urllib.request.urlopen(urllib.request.Request(url,headers={'Authorization':'Bearer '+token,'x-goog-user-project':PROJECT}),timeout=90).read()
 manifest={'version':1,'project':PROJECT,'startedAt':datetime.datetime.now(datetime.UTC).isoformat(),'firestoreReadTime':snapshot['readTime'],'files':[],'storage':{'bucket':a.bucket,'prefix':'native-finance/','objects':[]},'limitations':['Firestore, Storage e Auth são capturados em instantes distintos.','Somente anexos nativos; links de arquivos Jotform e outros provedores não são copiados.','Cópia local; replicação externa e agenda não estão incluídas.']}
 (root/'objects').mkdir(mode=0o700)
 cursor=''
 while True:
  query=urllib.parse.urlencode({'prefix':'native-finance/','maxResults':1000,'pageToken':cursor})
  page=json.loads(get('https://storage.googleapis.com/storage/v1/b/'+a.bucket+'/o?'+query))
  for obj in page.get('items',[]):
   url='https://storage.googleapis.com/storage/v1/b/'+a.bucket+'/o/'+urllib.parse.quote(obj['name'],safe='')+'?alt=media&generation='+obj['generation']
   data=get(url)
   if len(data)!=int(obj['size']):raise ValueError('Tamanho do objeto divergente')
   if obj.get('md5Hash') and base64.b64encode(hashlib.md5(data).digest()).decode()!=obj['md5Hash']:raise ValueError('Checksum Storage divergente')
   name='objects/'+digest((obj['name']+'#'+obj['generation']).encode())
   save(root/name,data);manifest['storage']['objects'].append({'name':obj['name'],'generation':obj['generation'],'file':name,'sha256':digest(data),'size':len(data),'contentType':obj.get('contentType')})
  cursor=page.get('nextPageToken','')
  if not cursor:break
 # CLI oficial captura os hashes em arquivo restrito, nunca no terminal.
 result=subprocess.run(['firebase','auth:export',str(root/'auth-users.json'),'--format=json','--project',PROJECT],capture_output=True,cwd=root)
 if result.returncode:raise RuntimeError('Exportação Auth falhou; pacote incompleto. Consulte credenciais/permissões, sem expor hashes.')
 os.chmod(root/'auth-users.json',0o600)
 users=json.loads((root/'auth-users.json').read_text())['users']
 manifest['auth']={'users':len(users),'hashConfigIncluded':False,'credentialRestoreValidated':False}
 try:
  config=get('https://identitytoolkit.googleapis.com/admin/v2/projects/'+PROJECT+'/config')
  save(root/'auth-config.json',config)
  manifest['auth']['hashConfigIncluded']=bool(json.loads(config).get('signIn',{}).get('hashConfig'))
 except urllib.error.HTTPError as e:
  manifest['limitations'].append('Configuração Auth não exportada: HTTP '+str(e.code))
 if not manifest['auth']['hashConfigIncluded']:manifest['limitations'].append('Restauração das senhas depende dos parâmetros de hash; não certificada.')
 expected={v.get('path') for c in snapshot['collections'] if c['name']=='transactions' for d in c['documents'] for v in d.get('data',{}).get('attachments',[]) if v.get('path')}
 present={o['name'] for o in manifest['storage']['objects']}
 manifest['storage']['missingReferencedObjects']=sorted(expected-present)
 if expected-present:raise ValueError('Anexos referenciados ausentes; pacote incompleto')
 for path in sorted(root.rglob('*')):
  if path.is_file():manifest['files'].append({'file':str(path.relative_to(root)),'sha256':digest(path.read_bytes()),'size':path.stat().st_size})
 manifest['completedAt']=datetime.datetime.now(datetime.UTC).isoformat()
 data=(json.dumps(manifest,indent=2)+'\n').encode();save(root/'manifest.json',data);save(root/'manifest.sha256',(digest(data)+'\n').encode())
 print(json.dumps({'manifest':str(root/'manifest.json'),'objects':len(present),'authUsers':len(users),'hashConfigIncluded':manifest['auth']['hashConfigIncluded'],'missingAttachments':0}))
if __name__=='__main__':
 try:main()
 except Exception as e:raise SystemExit(type(e).__name__+': '+str(e))
