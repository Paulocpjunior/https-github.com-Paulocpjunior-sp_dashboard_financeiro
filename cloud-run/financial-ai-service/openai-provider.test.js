import test from 'node:test';
import assert from 'node:assert/strict';
import { createOpenAIProvider, validateFilters } from './openai-provider.js';

const env = { OPENAI_API_KEY: 'synthetic-key', OPENAI_MODEL: 'synthetic-model' };
const response = (value, status = 'completed') => ({ ok: true, json: async () => ({ status, output: [{ content: [{ type: 'output_text', text: JSON.stringify(value) }] }] }) });
test('uses server credentials, explicit model, structured Responses output and store=false', async () => {
  const provider = createOpenAIProvider({ env, fetchImpl: async (url, options) => {
    assert.equal(url, 'https://api.openai.com/v1/responses');
    assert.equal(options.headers.Authorization, 'Bearer synthetic-key');
    const body = JSON.parse(options.body);
    assert.equal(body.model, 'synthetic-model');
    assert.equal(body.store, false);
    assert.equal(body.text.format.type, 'json_schema');
    assert.equal(body.text.format.strict, true);
    return response({ explanation: 'Os vencimentos requerem acompanhamento.' });
  } });
  assert.equal((await provider.explain('Resumo', {})).explanation, 'Os vencimentos requerem acompanhamento.');
});
test('no implicit model, incomplete output or model-generated numbers are accepted', async () => {
  assert.equal(createOpenAIProvider({ env: { OPENAI_API_KEY: 'synthetic-key' } }).configured(), false);
  await assert.rejects(createOpenAIProvider({ env, fetchImpl: async () => response({ explanation: 'Saldo 999.' }) }).explain('Resumo', {}));
  await assert.rejects(createOpenAIProvider({ env, fetchImpl: async () => response({ explanation: 'Parcial' }, 'incomplete') }).explain('Resumo', {}));
  await assert.rejects(createOpenAIProvider({ env, fetchImpl: async () => ({ ok: false }) }).explain('Resumo', {}));
});
test('filters reject foreign fields, invalid dates and reversed ranges', () => {
  for (const value of [{ role: 'admin' }, { dueDateStart: '2026-02-30' }, { movement: 'Transferir' }, { startDate: '2026-10-01', endDate: '2026-09-30' }]) assert.throws(() => validateFilters(value));
  assert.deepEqual(validateFilters({ status: 'Pago', client: null }), { status: 'Pago' });
});
