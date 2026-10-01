import assert from 'node:assert/strict';
import { createServer } from 'vite';
const server = await createServer({ server: { middlewareMode: true }, optimizeDeps: { noDiscovery: true }, appType: 'custom', logLevel: 'error' });
try {
  const { checklistEvent, checklistStatusDates } = await server.ssrLoadModule('/utils/checklistStatus.ts');
  const source = { status: 'CLIENTE NOVO', entryDate: '2026-09-24', exitDate: '2026-09-24', suspensionDate: '2026-09-24' };
  const original = { ...source };
  assert.deepEqual(checklistStatusDates(source), { event: 'entrada', registrationDate: '2026-09-24', exitDate: null, suspensionDate: null, contractValidated: false });
  assert.deepEqual(source, original, 'preservar datas da fonte');
  for (const status of ['CLIENTE SAIDA', ' cliente saída ', 'ENCERRAMENTO CNPJ']) {
    const result = checklistStatusDates({ ...source, status });
    assert.equal(result.event, 'saida'); assert.equal(result.exitDate, source.exitDate);
    assert.equal(result.suspensionDate, null); assert.equal(result.registrationDate, null);
    assert.equal(result.contractValidated, false);
  }
  const suspended = checklistStatusDates({ ...source, status: 'CLIENTE SUSPENSO' });
  assert.equal(suspended.suspensionDate, source.suspensionDate); assert.equal(suspended.exitDate, null);
  const changed = checklistStatusDates({ ...source, status: 'CLIENTE ALTERAÇÃO' });
  assert.equal(changed.event, 'alteracao'); assert.equal(changed.exitDate, null); assert.equal(changed.suspensionDate, null);
  for (const status of [null, '', 'ACTIVE', 'CLIENTE NOVO / SAIDA', 'STATUS DESCONHECIDO']) {
    assert.equal(checklistEvent(status), 'pendente');
    const result = checklistStatusDates({ ...source, status });
    assert.equal(result.exitDate, null); assert.equal(result.suspensionDate, null); assert.equal(result.registrationDate, null);
  }
  console.log('OK: STATUS define evento; datas incompatíveis não indicam saída/suspensão; dados originais e validação contratual preservados.');
} finally { await server.close(); }
