"""Retire Financeiro Jotform access after approval of the exact repository SHA.
No global Jotform key is revoked and no financial collection is modified.
"""
import json
import os
import pathlib
import subprocess
import tempfile
import urllib.request

PROJECT = 'gen-lang-client-0888019226'
REGION = 'southamerica-east1'
SERVICE = 'jotform-webhook'
JOB = 'jotform-reconcile-missed-webhooks'
TAG = 'jotform-disabled'

def run(*args):
    return subprocess.check_output(args, text=True).strip()

def gcloud(*args):
    return run('gcloud', *args, '--project=' + PROJECT)

def describe():
    return json.loads(gcloud('run', 'services', 'describe', SERVICE, '--region=' + REGION, '--format=json'))

def health(url):
    with urllib.request.urlopen(url, timeout=30) as response:
        result = json.load(response)
    assert result.get('jotformEnabled') is False, 'The target revision has not disabled Jotform.'

subprocess.run(['node', 'scripts/guard-production.mjs'], check=True)
head = run('git', 'rev-parse', 'HEAD')
assert os.environ.get('FINANCEIRO_APPROVED_COMMIT') == head
subprocess.run(['npm', 'test', '--prefix', 'cloud-run/jotform-webhook'], check=True)
original = describe()
backup = pathlib.Path(tempfile.mkdtemp(prefix='financeiro-jotform-retirement-')) / 'routing-before.json'
# Record only routing metadata; never copy credential values to logs or artifacts.
backup.write_text(json.dumps({'commit': head, 'traffic': original['status']['traffic'],
                             'revision': original['status']['latestReadyRevisionName']}, indent=2))
print('Routing evidence:', backup)
gcloud('run', 'deploy', SERVICE, '--region=' + REGION, '--source=cloud-run/jotform-webhook',
       '--no-traffic', '--tag=' + TAG, '--remove-env-vars=JOTFORM_API_KEY,JOTFORM_RECONCILE_KEY', '--quiet')
staged = describe()
retired = next(t for t in staged['status']['traffic'] if t.get('tag') == TAG)
revision = retired['revisionName']
health(retired['url'])
job = json.loads(gcloud('scheduler', 'jobs', 'describe', JOB, '--location=' + REGION, '--format=json'))
if job.get('state') != 'PAUSED':
    gcloud('scheduler', 'jobs', 'pause', JOB, '--location=' + REGION, '--quiet')
# Old tagged URLs also reached older credential-bearing revisions. Redirect all
# existing service tags to the retired revision, including Hosting's old tag.
tags = sorted({t['tag'] for t in staged['status']['traffic'] if t.get('tag')})
gcloud('run', 'services', 'update-traffic', SERVICE, '--region=' + REGION,
       '--to-revisions=' + revision + '=100',
       '--set-tags=' + ','.join(tag + '=' + revision for tag in tags), '--quiet')
final = describe()
assert all(t.get('revisionName') == revision for t in final['status']['traffic'])
assert not any(e['name'] in ['JOTFORM_API_KEY', 'JOTFORM_RECONCILE_KEY']
               for e in final['spec']['template']['spec']['containers'][0].get('env', []))
assert json.loads(gcloud('scheduler', 'jobs', 'describe', JOB, '--location=' + REGION, '--format=json'))['state'] == 'PAUSED'
for url in {final['status']['url'], *(t['url'] for t in final['status']['traffic'] if t.get('url'))}:
    health(url)
print('Financeiro Jotform retired:', revision, '| scheduler paused | current runtime credentials removed | tagged URLs blocked')
