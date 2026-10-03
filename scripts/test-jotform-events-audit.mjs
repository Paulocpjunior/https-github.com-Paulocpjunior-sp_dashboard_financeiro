import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const dir = mkdtempSync(join(tmpdir(), 'sp-events-test-'));
try {
  const event = (submissionId, action, hour) => ({ data: {
    submissionId, action, receivedAt: `2026-10-01T${hour}:00:00Z`,
  } });
  const input = join(dir, 'backup.json');
  const output = join(dir, 'audit.json');
  writeFileSync(input, JSON.stringify({ collections: [{ name: 'jotformEvents', documents: [
    event('recovered', 'invalid_payload', '10'), event('recovered', 'entry_updated', '11'),
    event('still-failing', 'entry_updated', '09'), event('still-failing', 'error', '10'),
    event('', 'error', '10'), event('', 'entry_updated', '11'),
    event('other', 'entry_updated', '12'),
  ] }] }));
  execFileSync(process.execPath, ['scripts/audit-jotform-events.mjs', '--input', input,
    '--out', output, '--since', '2026-10-01T00:00:00Z']);
  const report = JSON.parse(readFileSync(output, 'utf8'));
  assert.equal(report.counts.failed, 3);
  assert.equal(report.counts.recoveredFailures, 1);
  assert.equal(report.counts.unresolvedFailures, 2);
  assert.equal(report.failures.find(e => e.submissionId === 'recovered').recoveredAt, '2026-10-01T11:00:00.000Z');
  assert.equal(report.failures.find(e => e.submissionId === 'still-failing').recoveredAt, '');
  assert.equal(report.failures.find(e => !e.submissionId).recoveredAt, '');
  console.log('OK: recuperação exige sucesso posterior da mesma submissão identificada.');
} finally {
  rmSync(dir, { recursive: true, force: true });
}
