#!/usr/bin/env python3
"""Replica um pacote conferido para compartilhamento UNAS montado; nunca apaga cópias."""
import argparse,hashlib,json,os,pathlib,shutil,subprocess,uuid
ROOT=pathlib.Path(__file__).resolve().parents[1]
def sha(path):
 h=hashlib.sha256()
 with path.open('rb') as f:
  for chunk in iter(lambda:f.read(1024*1024),b''):h.update(chunk)
 return h.hexdigest()
def verify(root):
 manifest=root/'manifest.json'
 if sha(manifest)!=(root/'manifest.sha256').read_text().strip():raise ValueError('Manifesto divergente')
 data=json.loads(manifest.read_text())
 if data.get('project')!='gen-lang-client-0888019226' or not data.get('completedAt'):raise ValueError('Pacote financeiro incompleto ou de outro projeto')
 for item in data['files']:
  p=(root/item['file']).resolve()
  if not p.is_relative_to(root.resolve()) or p.is_symlink():raise ValueError('Caminho fora do pacote')
  if p.stat().st_size!=item['size'] or sha(p)!=item['sha256']:raise ValueError('Arquivo divergente')
 return data

def replicate(source,destination):
 data=verify(source)
 target=destination/source.name
 if target.exists():raise ValueError('Cópia já existe; não sobrescrever')
 staging=destination/('.incomplete-'+uuid.uuid4().hex)
 staging.mkdir(mode=0o700)
 # Copia somente arquivos enumerados, sem despejar outros arquivos locais.
 for name in [x['file'] for x in data['files']]+['manifest.json','manifest.sha256']:
  dest=staging/name;dest.parent.mkdir(mode=0o700,parents=True,exist_ok=True)
  with (source/name).open('rb') as src,dest.open('xb') as out:
   shutil.copyfileobj(src,out);out.flush();os.fsync(out.fileno())
  os.chmod(dest,0o600)
 verify(staging) # Releitura do destino, não apenas da origem.
 (staging/'REPLICA_VERIFIED.json').write_text(json.dumps({'manifestSha256':sha(staging/'manifest.json'),'files':len(data['files']),'scope':'Cópia relida com SHA-256; não certifica recuperação integral.'})+'\n')
 staging.rename(target)
 return target

def main():
 p=argparse.ArgumentParser();p.add_argument('--manifest',required=True);p.add_argument('--mount',required=True);a=p.parse_args()
 os.umask(0o077)
 mount=pathlib.Path(a.mount).resolve()
 if not os.path.ismount(mount):raise ValueError('UNAS não montado. Abortado para não gravar no disco local por engano.')
 # Confirma montagem de rede. Não confundir uma pasta local com o destino NAS.
 listing=subprocess.check_output(['mount'],text=True)
 if not any((' on '+str(mount)+' ') in line and any(proto in line.lower() for proto in ['smbfs','nfs','cifs']) for line in listing.splitlines()):raise ValueError('Exige compartilhamento de rede SMB/NFS/CIFS já autenticado.')
 source=pathlib.Path(a.manifest).resolve().parent
 target=mount/'Financeiro';target.mkdir(mode=0o700,exist_ok=True)
 if target.is_symlink():raise ValueError('Destino não pode ser link simbólico')
 print(json.dumps({'replica':str(replicate(source,target)),'verified':True}))
if __name__=='__main__':main()
