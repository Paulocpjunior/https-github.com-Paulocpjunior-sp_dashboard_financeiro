import assert from 'node:assert/strict';
import { createServer } from 'vite';

globalThis.localStorage = {
  getItem: (key) => key === 'excluded_transactions'
    ? JSON.stringify(['correct-april-july-due'])
    : null,
  setItem: () => {},
  removeItem: () => {},
};

const server = await createServer({
  server: { middlewareMode: true },
  optimizeDeps: { noDiscovery: true },
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
  assert.equal(
    result.data[0].isExcluded,
    undefined,
    'legacy exclusions stored only in one browser must not override Firestore',
  );

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

  FirebaseService.fetchTransactionsByRange=async()=>[{id:'partial-receipt',date:'2026-10-01',dueDate:'2026-10-20',paymentDate:'2026-10-13',bankAccount:'Itaú',type:'Entrada de Caixa / Contas a Receber',movement:'Entrada',client:'Teste',status:'Pendente',valuePaid:0,valueReceived:40,valorOriginal:100,totalCobranca:100,receivableBalance:{version:1,receivedCents:4000,interestCents:200,discountCents:100,remainingCents:6100}}];
  await DataService.loadDataForFilters({startDate:'2026-10-01',endDate:'2026-10-31'},true);
  const partialResult=DataService.getTransactions({type:'Entrada de Caixa / Contas a Receber',receiptDateStart:'2026-10-13',receiptDateEnd:'2026-10-13'});
  assert.equal(partialResult.result.data.length,1,'parcial mantém data de recebimento para filtro');
  assert.equal(partialResult.kpi.totalPaid,40);
  assert.equal(partialResult.kpi.balance,61);
  assert.deepEqual(DataService.getGlobalStats(),{totalReceived:61,totalPaid:0,balance:40});
  console.log('OK: a consulta de período mais recente prevalece no cache.');
} finally {
  await server.close();
}
