#!/usr/bin/env python3
"""Grant approved correction capabilities to existing active profiles.
Preview by default. --apply preserves other rights and uses update-time preconditions.
Default grants the 2026-10-14 pair; pass --permissions to grant others (e.g. receivables.amend receivables.adjust).
"""
import argparse,json,subprocess,urllib.request,datetime,pathlib
parser=argparse.ArgumentParser();parser.add_argument('--apply',action='store_true');parser.add_argument('--permissions',nargs='+',default=['receivables.reverse','payables.amend'],choices=['receivables.reverse','payables.amend','receivables.amend','receivables.adjust']);args=parser.parse_args()
base='https://firestore.googleapis.com/v1/projects/gen-lang-client-0888019226/databases/(default)/documents'
token=subprocess.check_output(['gcloud','auth','print-access-token'],text=True).strip()
def api(method,url,body=None):
 req=urllib.request.Request(url,data=json.dumps(body).encode() if body is not None else None,method=method,headers={'Authorization':'Bearer '+token,'Content-Type':'application/json'})
 with urllib.request.urlopen(req,timeout=30) as r:return json.load(r)
rows=api('POST',base+':runQuery',{'structuredQuery':{'from':[{'collectionId':'users'}],'select':{'fields':[{'fieldPath':x} for x in ['name','active','status','role','financialPermissions']]}}})
plan=[]
for row in rows:
 d=row.get('document');
 if not d:continue
 f=d.get('fields',{})
 if f.get('active',{}).get('booleanValue') is not True or f.get('status',{}).get('stringValue') in ['blocked','deleted']:continue
 old=[x['stringValue'] for x in f.get('financialPermissions',{}).get('arrayValue',{}).get('values',[])];new=list(dict.fromkeys(old+args.permissions))
 if old!=new:plan.append({'document':d['name'],'updateTime':d['updateTime'],'name':f.get('name',{}).get('stringValue',''),'before':old,'after':new})
print(json.dumps({'mode':'apply' if args.apply else 'preview','permissions':args.permissions,'profiles':len(plan),'names':[p['name'] for p in plan]},ensure_ascii=False))
if args.apply and plan:
 stamp=datetime.datetime.now(datetime.timezone.utc).isoformat();out=pathlib.Path('output/permission-grants');out.mkdir(parents=True,exist_ok=True)
 (out/('corrections-'+stamp.replace(':','-')+'.json')).write_text(json.dumps(plan,ensure_ascii=False,indent=2))
 writes=[]
 for p in plan:
  fields={'financialPermissions':{'arrayValue':{'values':[{'stringValue':v} for v in p['after']]}},'correctionAccessGrantedAt':{'stringValue':stamp},'correctionAccessGrantedBy':{'stringValue':'hpdsWehGGAYE3uKCar4pBiRVxFJ3'}}
  writes.append({'update':{'name':p['document'],'fields':fields},'updateMask':{'fieldPaths':list(fields)},'currentDocument':{'updateTime':p['updateTime']}})
 api('POST',base+':commit',{'writes':writes})
 print('Permissões aplicadas atomicamente; demais permissões e perfis preservados.')
