import { KPIData, Transaction } from '../types';
import { accumulateBalances, balancesInReais } from '../utils/accumulatedBalances';

const fields = ['payableBalance', 'id', 'source', 'client', 'description', 'wixInvoiceNumber', 'wixEntityId', 'movement', 'type', 'status', 'isExcluded', 'valorOriginal', 'totalCobranca', 'honorarios', 'valorExtra', 'valuePaid', 'valueReceived'];
const decode = (value: any): unknown => {
  if ('mapValue' in value) return Object.fromEntries(Object.entries(value.mapValue.fields || {}).map(([k,v]) => [k,decode(v)]));
  if ('stringValue' in value) return value.stringValue;
  if ('booleanValue' in value) return value.booleanValue;
  if ('integerValue' in value) return Number(value.integerValue);
  if ('doubleValue' in value) return Number(value.doubleValue);
  return null;
};

const retryableStatus = new Set([408, 429, 500, 502, 503, 504]);
const waitForRetry = (ms: number, signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
  const abort = () => {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
    reject(new DOMException('Consulta cancelada.', 'AbortError'));
  };
  const timer = setTimeout(() => {
    signal?.removeEventListener('abort', abort);
    resolve();
  }, ms);
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
});

// Retry only the current page, before accumulating any of its documents.
async function readPage(fetcher: typeof fetch, url: string, init: RequestInit, checkSession: () => void) {
  for (let attempt = 0; attempt < 3; attempt++) {
    checkSession();
    init.signal?.throwIfAborted();
    let response: Response;
    try {
      response = await fetcher(url, init);
      checkSession();
      init.signal?.throwIfAborted();
      if (response.ok) return await response.json();
    } catch (error) {
      checkSession();
      init.signal?.throwIfAborted();
      if (!(error instanceof TypeError)) throw error;
      if (attempt === 2) throw new Error('A conexão com o histórico financeiro falhou após três tentativas. Tente atualizar os saldos.');
      await waitForRetry(500 * 2 ** attempt, init.signal ?? undefined);
      continue;
    }
    if (response.status === 401 || response.status === 403) {
      throw new Error('Sessão sem permissão para ler o histórico financeiro. Entre novamente no aplicativo.');
    }
    if (!retryableStatus.has(response.status) || attempt === 2) {
      throw new Error(`Não foi possível apurar o histórico completo (HTTP ${response.status}).`);
    }
    await waitForRetry(500 * 2 ** attempt, init.signal ?? undefined);
  }
  throw new Error('Não foi possível concluir a apuração do histórico.');
}

/** REST com o token Firebase do usuário: as mesmas regras Firestore continuam aplicadas. */
export async function readAccumulatedBalances(options: {
  projectId: string; token: string; fetcher?: typeof fetch; signal?: AbortSignal; checkSession: () => void;
}): Promise<{ kpi: KPIData; documentCount: number; readTime: string }> {
  const fetcher = options.fetcher || fetch;
  const root = `projects/${options.projectId}/databases/(default)/documents`;
  const totals = { totalPaid: 0, totalReceived: 0, balance: 0 };
  let count = 0;
  let readTime = '';
  let cursor = '';
  for (let page = 0; page < 500; page++) {
    options.checkSession();
    const query: any = {
      from: [{ collectionId: 'transactions' }], select: { fields: fields.map(fieldPath => ({ fieldPath })) },
      orderBy: [{ field: { fieldPath: '__name__' }, direction: 'ASCENDING' }], limit: 1000,
    };
    if (cursor) query.startAt = { values: [{ referenceValue: cursor }], before: false };
    const body: any = { structuredQuery: query };
    if (readTime) body.readTime = readTime;
    const rows = await readPage(fetcher, `https://firestore.googleapis.com/v1/${root}:runQuery`, {
      method: 'POST', headers: { Authorization: `Bearer ${options.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body), signal: options.signal,
    }, options.checkSession);
    options.checkSession();
    options.signal?.throwIfAborted();
    if (!Array.isArray(rows) || !rows.length) throw new Error('Resposta incompleta na apuração dos saldos.');
    const pageTime = rows.find(row => row.readTime)?.readTime;
    if (!pageTime || (readTime && pageTime !== readTime)) throw new Error('O histórico mudou de versão durante a consulta. Atualize os saldos.');
    readTime ||= pageTime;
    const documents = rows.filter(row => row.document).map(row => row.document);
    let last = cursor;
    for (const document of documents) {
      if (typeof document.name !== 'string' || !document.name.startsWith(`${root}/transactions/`) || document.name <= last) throw new Error('Paginação inválida na apuração dos saldos.');
      last = document.name;
      const data = Object.fromEntries(Object.entries(document.fields || {}).map(([key, value]) => [key, decode(value)]));
      accumulateBalances(totals, { ...data, id: data.id || document.name.split('/').pop() } as Transaction);
      count++;
    }
    cursor = last;
    if (documents.length < 1000) {
      options.checkSession();
      return { kpi: balancesInReais(totals), documentCount: count, readTime };
    }
  }
  throw new Error('O histórico excedeu o limite de apuração. Nenhum saldo parcial será apresentado.');
}
