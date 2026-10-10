#!/usr/bin/env python3
"""Provision the approved monthly payable draft worker. No credential values are read or printed."""
import argparse
import json
import pathlib
import subprocess

ROOT = pathlib.Path(__file__).resolve().parents[1]
PROJECT = 'gen-lang-client-0888019226'
REGION = 'us-central1'
JOB = 'sp-payable-provisions'
SCHEDULER = 'sp-payable-provisions-daily'
INVOKER = f'sp-payable-draft-scheduler@{PROJECT}.iam.gserviceaccount.com'

def run(*args):
    return subprocess.check_output(args, cwd=ROOT, text=True).strip()

def gcloud(*args):
    return run('gcloud', *args, '--project', PROJECT, '--quiet')

def describe(*args):
    return json.loads(gcloud(*args, '--format=json'))

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--apply', action='store_true', help='Requires the full SHA explicitly approved by Paulo.')
    opts = parser.parse_args()
    if not opts.apply:
        print('Plan: reuse the approved service image without bank credentials; create a single-task Cloud Run Job; invoke daily at 06:00 Sao Paulo via a dedicated OAuth service account. Run --apply only after full-SHA approval and service publication.')
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
    account = revision['spec']['serviceAccountName']
    gcloud('services', 'enable', 'cloudscheduler.googleapis.com')
    accounts = describe('iam', 'service-accounts', 'list', '--filter', f'email={INVOKER}')
    if not accounts:
        gcloud('iam', 'service-accounts', 'create', 'sp-payable-draft-scheduler', '--display-name', 'Payable monthly draft scheduler')
    schedules = describe('scheduler', 'jobs', 'list', '--location', REGION)
    existing = next((s for s in schedules if s['name'].endswith('/' + SCHEDULER)), None)
    if existing:
        gcloud('scheduler', 'jobs', 'pause', SCHEDULER, '--location', REGION)
    jobs = describe('run', 'jobs', 'list', '--region', REGION)
    operation = 'update' if any(j['metadata']['name'] == JOB for j in jobs) else 'create'
    gcloud('run', 'jobs', operation, JOB, '--region', REGION, '--image', image, '--service-account', account,
           '--command', 'launcher', '--args', 'node payable-provision-job.js', '--tasks', '1', '--parallelism', '1', '--max-retries', '0',
           '--task-timeout', '600s', '--memory', '512Mi', '--cpu', '1',
           '--set-env-vars', 'PAYABLE_MONTHLY_DRAFTS_ENABLED=true',
           '--update-labels' if operation == 'update' else '--labels', f'financeiro-commit={sha}')
    gcloud('run', 'jobs', 'add-iam-policy-binding', JOB, '--region', REGION, '--member', f'serviceAccount:{INVOKER}', '--role', 'roles/run.invoker')
    gcloud('scheduler', 'jobs', 'update' if existing else 'create', 'http', SCHEDULER, '--location', REGION,
           '--schedule', '0 6 * * *', '--time-zone', 'America/Sao_Paulo', '--http-method', 'POST',
           '--uri', f'https://run.googleapis.com/v2/projects/{PROJECT}/locations/{REGION}/jobs/{JOB}:run',
           '--oauth-service-account-email', INVOKER, '--oauth-token-scope', 'https://www.googleapis.com/auth/cloud-platform',
           '--message-body', '{}', '--update-headers' if existing else '--headers', 'Content-Type=application/json', '--max-retry-attempts', '0')
    if existing:
        gcloud('scheduler', 'jobs', 'resume', SCHEDULER, '--location', REGION)
    print('Worker and schedule configured. Verify an execution, dashboard status, and monthly draft creation before claiming automation is active.')

if __name__ == '__main__':
    main()
