"""Liberar só a leitura do Checklist do Legal (Jotform 210135417457653) no jotform-webhook.

O formulário de caixa continua desligado: a revisão nova mantém HTTP 410 nas rotas
legadas e não recebe JOTFORM_API_KEY nem JOTFORM_RECONCILE_KEY. A chave do checklist
fica no Secret Manager e nunca é impressa. Rodar antes do deploy oficial do Hosting.
"""
import getpass
import json
import os
import pathlib
import subprocess
import tempfile
import urllib.error
import urllib.request

PROJECT = 'gen-lang-client-0888019226'
REGION = 'southamerica-east1'
SERVICE = 'jotform-webhook'
SECRET = 'jotform-checklist-api-key'
TAG = 'checklist-legal'

def run(*args, **kwargs):
    return subprocess.check_output(args, text=True, **kwargs).strip()

def gcloud(*args, **kwargs):
    return run('gcloud', *args, '--project=' + PROJECT, **kwargs)

def describe():
    return json.loads(gcloud('run', 'services', 'describe', SERVICE, '--region=' + REGION, '--format=json'))

def health(url):
    with urllib.request.urlopen(url, timeout=30) as response:
        result = json.load(response)
    assert result.get('jotformEnabled') is False, 'O formulário de caixa não pode voltar a ficar ativo.'
    assert result.get('checklistReadEnabled') is True, 'A revisão não libera a leitura do checklist.'

def cash_form_blocked(url):
    request = urllib.request.Request(url, data=b'{}', method='POST', headers={'Content-Type': 'application/json'})
    try:
        urllib.request.urlopen(request, timeout=30)
    except urllib.error.HTTPError as error:
        assert error.code == 410, 'O webhook de caixa respondeu ' + str(error.code) + ' em vez de 410.'
        return
    raise AssertionError('O webhook de caixa aceitou um POST.')

subprocess.run(['node', 'scripts/guard-production.mjs'], check=True)
head = run('git', 'rev-parse', 'HEAD')
assert os.environ.get('FINANCEIRO_APPROVED_COMMIT') == head
subprocess.run(['npm', 'test', '--prefix', 'cloud-run/jotform-webhook'], check=True)
subprocess.run(['node', 'cloud-run/jotform-webhook/test-checklist.js'], check=True)

original = describe()
backup = pathlib.Path(tempfile.mkdtemp(prefix='financeiro-checklist-legal-')) / 'routing-before.json'
# Só metadados de roteamento; nenhum valor de credencial.
backup.write_text(json.dumps({'commit': head, 'traffic': original['status']['traffic'],
                             'revision': original['status']['latestReadyRevisionName']}, indent=2))
print('Referências para reversão:', backup)

secrets = json.loads(gcloud('secrets', 'list', '--filter=name~' + SECRET + '$', '--format=json'))
if not secrets:
    key = getpass.getpass('Chave Jotform (somente leitura) do Checklist do Legal: ').strip()
    assert key, 'Chave vazia.'
    gcloud('secrets', 'create', SECRET, '--replication-policy=automatic', '--data-file=-', input=key)
account = original['spec']['template']['spec'].get('serviceAccountName') or json.loads(
    gcloud('projects', 'describe', PROJECT, '--format=json'))['projectNumber'] + '-compute@developer.gserviceaccount.com'
gcloud('secrets', 'add-iam-policy-binding', SECRET, '--member=serviceAccount:' + account,
       '--role=roles/secretmanager.secretAccessor', '--quiet')

gcloud('run', 'deploy', SERVICE, '--region=' + REGION, '--source=cloud-run/jotform-webhook',
       '--no-traffic', '--tag=' + TAG, '--remove-env-vars=JOTFORM_API_KEY,JOTFORM_RECONCILE_KEY',
       '--update-secrets=JOTFORM_CHECKLIST_API_KEY=' + SECRET + ':latest', '--quiet')
staged = describe()
target = next(t for t in staged['status']['traffic'] if t.get('tag') == TAG)
revision = target['revisionName']
health(target['url'])
cash_form_blocked(target['url'])

# Todas as tags (inclusive jotform-disabled, usada pelo Hosting) passam para a revisão nova.
tags = sorted({t['tag'] for t in staged['status']['traffic'] if t.get('tag')})
gcloud('run', 'services', 'update-traffic', SERVICE, '--region=' + REGION,
       '--to-revisions=' + revision + '=100',
       '--set-tags=' + ','.join(tag + '=' + revision for tag in tags), '--quiet')
final = describe()
assert all(t.get('revisionName') == revision for t in final['status']['traffic'])
env = final['spec']['template']['spec']['containers'][0].get('env', [])
assert not any(e['name'] in ['JOTFORM_API_KEY', 'JOTFORM_RECONCILE_KEY'] for e in env)
assert any(e['name'] == 'JOTFORM_CHECKLIST_API_KEY' and 'valueFrom' in e for e in env)
for url in {final['status']['url'], *(t['url'] for t in final['status']['traffic'] if t.get('url'))}:
    health(url)
    cash_form_blocked(url)
print('Checklist do Legal liberado para leitura:', revision, '| formulário de caixa segue em 410 | sem chaves antigas no runtime')
