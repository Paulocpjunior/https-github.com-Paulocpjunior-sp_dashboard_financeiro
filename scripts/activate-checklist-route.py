"""Fixar somente a nova consulta na revisão já implantada, após o deploy oficial.

Não altera tráfego do Cloud Run, variáveis, regras Firestore ou registros financeiros.
Exige o mesmo commit aprovado, o guard de produção e o build publicado correspondente.
"""
import copy
import json
import os
import pathlib
import subprocess
import time
import requests
from google.oauth2 import service_account
from google.auth.transport.requests import Request

SITE = 'gen-lang-client-0888019226'
ROOT = 'https://firebasehosting.googleapis.com/v1beta1/'
TAG = 'checklist-preview'
REVISION = 'jotform-webhook-00083-cat'

subprocess.run(['node', 'scripts/guard-production.mjs'], check=True)
head = subprocess.check_output(['git', 'rev-parse', 'HEAD'], text=True).strip()
assert os.environ.get('FINANCEIRO_APPROVED_COMMIT') == head
assert json.loads(pathlib.Path('dist/version.json').read_text())['commit'] == head[:7]
public = requests.get('https://' + SITE + '.web.app/version.json', params={'verify': head}, timeout=30)
public.raise_for_status()
assert public.json()['commit'] == head[:7], 'A versão oficial publicada diverge do commit aprovado.'

credentials = service_account.Credentials.from_service_account_info(
    json.loads(os.environ['GCP_CREDENTIALS']), scopes=['https://www.googleapis.com/auth/cloud-platform'])
credentials.refresh(Request())
headers = {'Authorization': 'Bearer ' + credentials.token}

def api(method, path, body=None):
    response = requests.request(method, ROOT + path, headers=headers, json=body, timeout=60)
    if not response.ok:
        raise RuntimeError('Hosting HTTP ' + str(response.status_code) + ': ' + response.json().get('error', {}).get('message', 'Falha'))
    return response.json()

service = requests.get('https://southamerica-east1-run.googleapis.com/apis/serving.knative.dev/v1/namespaces/' + SITE + '/services/jotform-webhook', headers=headers, timeout=30)
service.raise_for_status()
assert any(item.get('tag') == TAG and item.get('revisionName') == REVISION
           for item in service.json().get('status', {}).get('traffic', [])), 'A tag não aponta para a revisão implantada.'

channel = api('GET', 'sites/' + SITE + '/channels/live')
source = channel['release']['version']['name']
version = api('GET', source)
config = copy.deepcopy(version['config'])
matches = [r for r in config.get('rewrites', []) if r.get('glob') == '/api/billing-checklist/**']
assert len(matches) == 1, 'Rota do checklist ausente ou duplicada.'
route = matches[0]
assert route.get('run', {}).get('serviceId') == 'jotform-webhook'
assert route['run'].get('region') == 'southamerica-east1'
route['run']['tag'] = TAG
for path in ['/api/pdf-download', '/api/pdf-download/**', '/api/boleto-cloud-csv']:
    assert any(r.get('glob') == path and r.get('run', {}).get('serviceId') == 'sp-pdf-download'
               for r in config['rewrites']), 'Rota homologada ausente.'

# A cópia reaproveita os arquivos que o fluxo oficial acabou de publicar.
cloned = api('POST', 'sites/' + SITE + '/versions:clone', {'sourceVersion': source, 'finalize': False})
for _ in range(30):
    if cloned.get('done'):
        break
    time.sleep(2)
    cloned = api('GET', cloned['name'])
assert cloned.get('done') and 'error' not in cloned, 'A cópia da versão não foi concluída.'
result = cloned['response']
name = result.get('version', result)['name']
assert name.startswith('sites/' + SITE + '/versions/')
final = api('PATCH', name + '?updateMask=config,status', {'config': config, 'status': 'FINALIZED'})
assert final['config']['rewrites'] == config['rewrites']
assert api('GET', 'sites/' + SITE + '/channels/live')['release']['version']['name'] == source, 'Outra publicação ocorreu durante a preparação.'
api('POST', 'sites/' + SITE + '/releases?versionName=' + name,
    {'message': 'Checklist publicado no app principal; consulta fixada na revisão implantada ' + REVISION})
print('Checklist ativado no Hosting principal. Tráfego normal do Cloud Run preservado.')
