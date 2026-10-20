"""Teste offline: sem gcloud, rede ou gravação em produção."""
import io
import json
import os
import runpy
import subprocess
import tempfile
import urllib.error
from unittest.mock import patch

HEAD = 'b' * 40
calls = []
reads = 0
old = {'revisionName': 'retired', 'percent': 100, 'tag': 'jotform-disabled', 'url': 'https://old.invalid'}
new = {'revisionName': 'legal', 'tag': 'checklist-legal', 'url': 'https://legal.invalid'}
secret_env = {'name': 'JOTFORM_CHECKLIST_API_KEY', 'valueFrom': {'secretKeyRef': {'name': 'jotform-checklist-api-key', 'key': 'latest'}}}

def command(args, **kwargs):
    global reads
    args = list(args)
    calls.append((args, kwargs))
    if args[:3] == ['git', 'rev-parse', 'HEAD']: return HEAD
    if args[1:4] == ['run', 'services', 'describe']:
        reads += 1
        traffic = [old] if reads == 1 else [old, new] if reads == 2 else [dict(new, percent=100), dict(old, revisionName='legal')]
        env = [] if reads < 3 else [secret_env]
        return json.dumps({'status': {'traffic': traffic, 'latestReadyRevisionName': 'retired', 'url': 'https://service.invalid'},
                           'spec': {'template': {'spec': {'serviceAccountName': 'runtime@example.invalid', 'containers': [{'env': env}]}}}})
    if args[1:3] == ['secrets', 'list']: return '[]'
    return ''

def opener(request, timeout=30):
    if getattr(request, 'method', None) == 'POST':
        raise urllib.error.HTTPError(request.full_url, 410, 'Gone', {}, io.BytesIO(b'{}'))
    return io.BytesIO(b'{"jotformEnabled":false,"checklistReadEnabled":true}')

with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, {'FINANCEIRO_APPROVED_COMMIT': HEAD}), \
        patch('tempfile.mkdtemp', return_value=directory), patch('subprocess.check_output', side_effect=command), \
        patch('subprocess.run') as runner, patch('getpass.getpass', return_value='synthetic-key'), \
        patch('urllib.request.urlopen', side_effect=opener):
    runpy.run_path('scripts/enable-legal-checklist.py')
    assert runner.call_args_list[0].args[0] == ['node', 'scripts/guard-production.mjs']
    create = next((a, k) for a, k in calls if a[1:3] == ['secrets', 'create'])
    assert create[1].get('input') == 'synthetic-key' and 'synthetic-key' not in ' '.join(create[0])
    deploy = next(a for a, _ in calls if a[1:3] == ['run', 'deploy'])
    assert '--no-traffic' in deploy and '--remove-env-vars=JOTFORM_API_KEY,JOTFORM_RECONCILE_KEY' in deploy
    assert '--update-secrets=JOTFORM_CHECKLIST_API_KEY=jotform-checklist-api-key:latest' in deploy
    promote = next(a for a, _ in calls if a[1:4] == ['run', 'services', 'update-traffic'])
    assert '--set-tags=checklist-legal=legal,jotform-disabled=legal' in promote

calls.clear()
with patch('subprocess.run', side_effect=subprocess.CalledProcessError(1, 'guard')), patch('subprocess.check_output', side_effect=command):
    try:
        runpy.run_path('scripts/enable-legal-checklist.py')
        raise AssertionError('Guard recusado deve parar a liberação')
    except subprocess.CalledProcessError: pass
    assert calls == [], 'Falha no guard não pode chamar a nuvem'
print('PASS: guard primeiro; chave só no Secret Manager; revisão sem tráfego; caixa em 410; tags migradas. Offline.')
