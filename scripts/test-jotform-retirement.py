"""Offline orchestration test: no gcloud calls, network or production writes."""
import io
import json
import os
import runpy
import subprocess
import tempfile
from unittest.mock import patch

HEAD = 'a' * 40
calls = []
reads = 0
paused = False
old = {'revisionName':'old','percent':100,'tag':'checklist-preview','url':'https://old.invalid'}
new = {'revisionName':'retired','tag':'jotform-disabled','url':'https://retired.invalid'}

def command(args, **kwargs):
    global reads, paused
    args = list(args)
    calls.append(args)
    if args[:3] == ['git','rev-parse','HEAD']: return HEAD
    if args[1:4] == ['run','services','describe']:
        reads += 1
        traffic = [old] if reads == 1 else [old,new] if reads == 2 else [dict(new,percent=100),dict(old,revisionName='retired')]
        return json.dumps({'status':{'traffic':traffic,'latestReadyRevisionName':'old','url':'https://service.invalid'},'spec':{'template':{'spec':{'containers':[{'env':[]}]}}}})
    if args[1:4] == ['scheduler','jobs','describe']: return json.dumps({'state':'PAUSED' if paused else 'ENABLED'})
    if args[1:4] == ['scheduler','jobs','pause']: paused = True
    return ''

with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, {'FINANCEIRO_APPROVED_COMMIT': HEAD}), patch('tempfile.mkdtemp', return_value=directory), patch('subprocess.check_output', side_effect=command), patch('subprocess.run') as runner, patch('urllib.request.urlopen', side_effect=lambda *a,**k:io.BytesIO(b'{"jotformEnabled":false}')):
    runpy.run_path('scripts/retire-jotform.py')
    assert runner.call_args_list[0].args[0] == ['node','scripts/guard-production.mjs']
    assert paused
    deploy = next(c for c in calls if c[1:3] == ['run','deploy'])
    assert '--no-traffic' in deploy and '--remove-env-vars=JOTFORM_API_KEY,JOTFORM_RECONCILE_KEY' in deploy
    promote = next(c for c in calls if c[1:4] == ['run','services','update-traffic'])
    assert '--set-tags=checklist-preview=retired,jotform-disabled=retired' in promote
    assert '--to-revisions=retired=100' in promote

calls.clear()
with patch('subprocess.run', side_effect=subprocess.CalledProcessError(1, 'guard')), patch('subprocess.check_output', side_effect=command):
    try:
        runpy.run_path('scripts/retire-jotform.py')
        raise AssertionError('Rejected guard must stop retirement')
    except subprocess.CalledProcessError: pass
    assert calls == [], 'Guard failure must prevent all cloud commands'
print('PASS: approved guard first; traffic staged; scheduler paused; old tags retired; credentials removed. Offline only.')
