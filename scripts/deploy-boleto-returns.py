#!/usr/bin/env python3
"""Provision the approved bank-return worker. No credential values are read or printed."""
import argparse
import datetime
import json
import pathlib
import re
import subprocess

ROOT = pathlib.Path(__file__).resolve().parents[1]
PROJECT = 'gen-lang-client-0888019226'
REGION = 'us-central1'
JOB = 'sp-boleto-returns'
SCHEDULER = 'sp-boleto-returns-every-15m'
INVOKER = f'sp-boleto-return-scheduler@{PROJECT}.iam.gserviceaccount.com'

def run(*args):
    return subprocess.check_output(args, cwd=ROOT, text=True).strip()

def gcloud(*args):
    return run('gcloud', *args, '--project', PROJECT, '--quiet')

def describe(*args):
    return json.loads(gcloud(*args, '--format=json'))

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--apply', action='store_true', help='Requires the full SHA explicitly approved by Paulo.')
    parser.add_argument('--alert-email', help="Address(es) for the daily billing alert, separated by ';'. Kept on later deploys.")
    parser.add_argument('--delivery-since', help='ISO UTC instant; boletos issued from then on and never sent are e-mailed by the job. Only with Paulo approval.')
    opts = parser.parse_args()
    if not opts.apply:
        print('Plan: reuse the approved service image and secret references; create a single-task Cloud Run Job; invoke every 15 minutes via a dedicated OAuth service account. Run --apply only after full-SHA approval and service publication.')
        return
    # Same mandatory deployment guard; never substitute an inferred authorization.
    subprocess.run(['node', 'scripts/guard-production.mjs'], cwd=ROOT, check=True)
    sha = run('git', 'rev-parse', 'HEAD')
    service = describe('run', 'services', 'describe', 'sp-pdf-download', '--region', REGION)
    revision = describe('run', 'revisions', 'describe', service['status']['latestReadyRevisionName'], '--region', REGION)
    if revision['metadata'].get('labels', {}).get('financeiro-commit') != sha:
        raise RuntimeError('Publish and verify the approved backend revision before provisioning the worker.')
    image = revision['status']['imageDigest']
    if '@sha256:' not in image:
        raise RuntimeError('An immutable image digest is required.')
    container = revision['spec']['containers'][0]
    env = {e['name']: e for e in container.get('env', [])}
    secrets = []
    # The Microsoft 365 credentials let the job e-mail issued boletos that were never sent.
    for name in ['BOLETO_CLOUD_API_KEY', 'BOLETO_CLOUD_ACCOUNT_TOKEN', 'FINANCEIRO_GRAPH_TENANT_ID', 'FINANCEIRO_GRAPH_CLIENT_ID', 'FINANCEIRO_GRAPH_CLIENT_SECRET']:
        ref = env[name]['valueFrom']['secretKeyRef']
        # Cloud Run may alias secret names through its secrets annotation.
        aliases = dict(pair.split(':', 1) for pair in revision['metadata'].get('annotations', {}).get('run.googleapis.com/secrets', '').split(',') if ':' in pair)
        secret = aliases.get(ref['name'], ref['name'])
        secrets.append(f"{name}={secret}:{ref['key']}")
    cutover = env['BOLETO_CLOUD_CUTOVER_DATE']['value']
    if env.get('FINANCEIRO_COMMUNICATION_SEND_ENABLED', {}).get('value') != 'true':
        raise RuntimeError('E-mail sending must be enabled on the approved backend before the job sends boletos.')
    if env['BOLETO_CLOUD_ENVIRONMENT']['value'] != 'production':
        raise RuntimeError('Production configuration is required.')
    account = revision['spec']['serviceAccountName']
    gcloud('services', 'enable', 'cloudscheduler.googleapis.com')
    accounts = describe('iam', 'service-accounts', 'list', '--filter', f'email={INVOKER}')
    if not accounts:
        gcloud('iam', 'service-accounts', 'create', 'sp-boleto-return-scheduler', '--display-name', 'Boleto returns scheduler invoker')
    schedules = describe('scheduler', 'jobs', 'list', '--location', REGION)
    existing = next((s for s in schedules if s['name'].endswith('/' + SCHEDULER)), None)
    if existing:
        gcloud('scheduler', 'jobs', 'pause', SCHEDULER, '--location', REGION)
    jobs = describe('run', 'jobs', 'list', '--region', REGION)
    current = next((j for j in jobs if j['metadata']['name'] == JOB), None)
    operation = 'update' if current else 'create'
    # The job only e-mails boletos issued after the first deploy with this step;
    # older ones stay with the team. Redeploys keep the original start.
    containers = (((((current or {}).get('spec') or {}).get('template') or {}).get('spec') or {}).get('template') or {}).get('spec', {}).get('containers') or [{}]
    previous = {e.get('name'): e.get('value') for e in containers[0].get('env', [])}
    if opts.delivery_since and not re.fullmatch(r'\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ', opts.delivery_since):
        raise RuntimeError('Use --delivery-since YYYY-MM-DDTHH:MM:SSZ.')
    alert_email = opts.alert_email or previous.get('BOLETO_DAILY_ALERT_EMAIL') or ''
    if not re.fullmatch(r"[^\s,=;]+@[^\s,=;]+(;[^\s,=;]+@[^\s,=;]+)*", alert_email):
        raise RuntimeError('Inform --alert-email with the address that receives the daily billing alert.')
    sweep_since = opts.delivery_since or previous.get('BOLETO_DELIVERY_SWEEP_SINCE') or datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
    gcloud('run', 'jobs', operation, JOB, '--region', REGION, '--image', image, '--service-account', account,
           '--command', 'launcher', '--args', 'node boleto-return-job.js', '--tasks', '1', '--parallelism', '1', '--max-retries', '0',
           '--task-timeout', '600s', '--memory', '2Gi', '--cpu', '1', '--set-secrets', ','.join(secrets),
           '--set-env-vars', f'BOLETO_CLOUD_ENVIRONMENT=production,BOLETO_CLOUD_CUTOVER_DATE={cutover},BOLETO_CLOUD_RETURN_ENABLED=true,BOLETO_CLOUD_RETURN_SETTLEMENT_ENABLED=true,BOLETO_CLOUD_RETURN_AUTO_LINK_ENABLED=true,BOLETO_CLOUD_RETURN_LATE_INTEREST_ENABLED=true,FINANCEIRO_COMMUNICATION_SEND_ENABLED=true,BOLETO_DELIVERY_SWEEP_ENABLED=true,BOLETO_DELIVERY_SWEEP_SINCE={sweep_since},BOLETO_DAILY_ALERT_EMAIL={alert_email}',
           '--update-labels' if operation == 'update' else '--labels', f'financeiro-commit={sha}')
    gcloud('run', 'jobs', 'add-iam-policy-binding', JOB, '--region', REGION, '--member', f'serviceAccount:{INVOKER}', '--role', 'roles/run.invoker')
    gcloud('scheduler', 'jobs', 'update' if existing else 'create', 'http', SCHEDULER, '--location', REGION,
           '--schedule', '*/15 * * * *', '--time-zone', 'America/Sao_Paulo', '--http-method', 'POST',
           '--uri', f'https://run.googleapis.com/v2/projects/{PROJECT}/locations/{REGION}/jobs/{JOB}:run',
           '--oauth-service-account-email', INVOKER, '--oauth-token-scope', 'https://www.googleapis.com/auth/cloud-platform',
           '--message-body', '{}', '--update-headers' if existing else '--headers', 'Content-Type=application/json', '--max-retry-attempts', '0')
    if existing:
        gcloud('scheduler', 'jobs', 'resume', SCHEDULER, '--location', REGION)
    print('Worker and schedule configured. Verify an execution, dashboard status, and bank evidence before claiming successful settlement.')

if __name__ == '__main__':
    main()
