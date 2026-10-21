import assert from 'node:assert/strict';
import { createServer } from 'vite';

const server = await createServer({
  server: { middlewareMode: true },
  optimizeDeps: { noDiscovery: true },
  appType: 'custom',
  logLevel: 'error',
});

try {
  const { isWixEcommerceOrder, isWixFatura } = await server.ssrLoadModule('/utils/transactionAmounts.ts');
  const { applyWixFilter, summarizeWixGroup } = await server.ssrLoadModule('/utils/wixReceivables.ts');

  const fatura = { id: 'wix-inv-0004107', source: 'wix', movement: 'Entrada', type: 'Entrada de Caixa / Contas a Receber', status: 'Pendente', client: 'Empresa A', valorOriginal: 300, valuePaid: 0, valueReceived: 0, wixInvoiceNumber: '0004107' };
  const order = { id: 'wix-6f1c2d3e-0000-4000-8000-000000000001', source: 'wix', movement: 'Entrada', type: 'Recebimento Wix / Cartao', status: 'Pago', client: 'Comprador B', valorOriginal: 120, valuePaid: 0, valueReceived: 120, wixOrderNumber: 10050, wixTransactionId: '6f1c2d3e' };
  const native = { id: 'native-1', source: 'native-finance', movement: 'Entrada', type: 'Entrada de Caixa / Contas a Receber', status: 'Pendente', client: 'Empresa C', totalCobranca: 500, valuePaid: 0, valueReceived: 0 };

  assert.equal(isWixFatura(fatura), true);
  assert.equal(isWixEcommerceOrder(fatura), false);
  assert.equal(isWixFatura(order), false);
  assert.equal(isWixEcommerceOrder(order), true);
  assert.equal(isWixEcommerceOrder(native), false);
  // Pedido legado sem wixOrderNumber ainda é reconhecido pelo id wix-{UUID}.
  assert.equal(isWixEcommerceOrder({ ...order, wixOrderNumber: undefined, wixTransactionId: undefined, type: '' }), true);

  const ids = (rows) => rows.map((row) => row.id);
  assert.deepEqual(ids(applyWixFilter([native, fatura], [order], '')), ['native-1', 'wix-inv-0004107', order.id]);
  assert.deepEqual(ids(applyWixFilter([native, fatura], [order], 'group')), ['wix-inv-0004107', order.id]);
  assert.deepEqual(ids(applyWixFilter([native, fatura], [order], 'invoices')), ['wix-inv-0004107']);
  assert.deepEqual(ids(applyWixFilter([native, fatura], [order], 'ecommerce')), [order.id]);
  assert.deepEqual(ids(applyWixFilter([native, order], [order], '')), ['native-1', order.id], 'sem duplicar pedidos');

  const summary = summarizeWixGroup([native, fatura, order]);
  assert.deepEqual(summary.invoices, { count: 1, total: 300, received: 0, open: 300 });
  assert.deepEqual(summary.ecommerce, { count: 1, total: 120, received: 120, open: 0 });
  assert.equal(summary.total.count, 2);

  console.log('test-wix-receivables: ok');
} finally {
  await server.close();
}
