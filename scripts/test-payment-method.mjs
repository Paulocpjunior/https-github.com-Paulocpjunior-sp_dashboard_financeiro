import assert from 'node:assert/strict';
import { createServer } from 'vite';

const server = await createServer({
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'error',
});

try {
  const { getPaymentMethod } = await server.ssrLoadModule('/utils/paymentMethod.ts');

  assert.equal(
    getPaymentMethod({ metodoPagamento: '11-Boleto ITAU' }),
    '11-Boleto ITAU',
    'deve usar o modo de cobrança original do Jotform',
  );
  assert.equal(
    getPaymentMethod({ metodoPagamento: '1- Boleto Email', paymentMethod: 'Pix' }),
    '1- Boleto Email',
    'o campo do Jotform deve prevalecer sobre aliases',
  );
  assert.equal(
    getPaymentMethod({ paymentMethod: 'Cartão de crédito/débito' }),
    'Cartão de crédito/débito',
    'deve preservar integrações que usam paymentMethod',
  );
  assert.equal(
    getPaymentMethod({ method: 'transfer' }),
    'transfer',
    'deve preservar registros legados que usam method',
  );
  assert.equal(
    getPaymentMethod({ metodoPagamento: '  6- Depósito  ' }),
    '6- Depósito',
    'deve remover apenas espaços externos do valor',
  );
  assert.equal(
    getPaymentMethod({}),
    '',
    'não deve inventar PIX quando o lançamento não informa o modo de cobrança',
  );

  console.log('OK: modo de cobrança preserva Jotform e aliases sem fallback PIX.');
} finally {
  await server.close();
}
