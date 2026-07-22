import assert from 'node:assert/strict';
import { createServer } from 'vite';

globalThis.localStorage = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
};

const server = await createServer({
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'error',
});

try {
  const { FirebaseService } = await server.ssrLoadModule('/services/firebaseService.ts');
  const { DataService } = await server.ssrLoadModule('/services/dataService.ts');
  const calls = [];

  FirebaseService.fetchClientRegistry = async () => [];
  FirebaseService.fetchTransactionsByRange = async (field, startDate, endDate) => {
    calls.push({ field, startDate, endDate });

    if (field === 'date') {
      await new Promise((resolve) => setTimeout(resolve, 40));
      return [{
        id: 'stale-july-launch',
        date: '2026-07-21',
        dueDate: '2026-07-30',
        paymentDate: '',
        bankAccount: '',
        type: 'Entrada de Caixa / Contas a Receber',
        status: 'Pendente',
        client: 'Base antiga',
        movement: 'Entrada',
        valuePaid: 0,
        valueReceived: 100,
      }];
    }

    await new Promise((resolve) => setTimeout(resolve, 5));
    return [{
      id: 'correct-april-july-due',
      date: '2026-03-18',
      dueDate: '2026-04-05',
      paymentDate: '2026-04-05',
      bankAccount: '',
      type: 'Entrada de Caixa / Contas a Receber',
      status: 'Pago',
      client: 'Base correta',
      movement: 'Entrada',
      valuePaid: 0,
      valueReceived: 200,
    }];
  };

  const staleRequest = DataService.loadDataForFilters(
    { startDate: '2026-07-01', endDate: '2026-07-31' },
    true,
  );

  await new Promise((resolve) => setTimeout(resolve, 2));

  const supersededRequest = DataService.loadDataForFilters(
    { dueDateStart: '2026-07-01', dueDateEnd: '2026-07-31' },
    true,
  );
  const latestRequest = DataService.loadDataForFilters(
    { dueDateStart: '2026-04-01', dueDateEnd: '2026-07-31' },
    true,
  );

  await Promise.all([staleRequest, supersededRequest, latestRequest]);

  assert.deepEqual(calls, [
    { field: 'date', startDate: '2026-07-01', endDate: '2026-07-31' },
    { field: 'dueDate', startDate: '2026-04-01', endDate: '2026-07-31' },
  ]);

  const { result } = DataService.getTransactions({});
  const ids = (result.allData ?? result.data).map((transaction) => transaction.id);
  assert.deepEqual(ids, ['correct-april-july-due']);

  const firstBounce = DataService.loadDataForFilters(
    { startDate: '2026-07-01', endDate: '2026-07-31' },
    true,
  );
  await new Promise((resolve) => setTimeout(resolve, 2));
  const intermediateBounce = DataService.loadDataForFilters(
    { dueDateStart: '2026-07-01', dueDateEnd: '2026-07-31' },
    true,
  );
  const finalBounce = DataService.loadDataForFilters(
    { startDate: '2026-07-01', endDate: '2026-07-31' },
    true,
  );

  await Promise.all([firstBounce, intermediateBounce, finalBounce]);

  const bounceResult = DataService.getTransactions({}).result;
  const bounceIds = (bounceResult.allData ?? bounceResult.data).map((transaction) => transaction.id);
  assert.deepEqual(bounceIds, ['stale-july-launch']);

  console.log('OK: a consulta de período mais recente prevalece no cache.');
} finally {
  await server.close();
}
