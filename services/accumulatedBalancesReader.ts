import { KPIData, Transaction } from '../types';
import { accumulateBalances, balancesInReais } from '../utils/accumulatedBalances';

const fields = ['id', 'source', 'client', 'description', 'wixInvoiceNumber', 'wixEntityId', 'movement', 'type', 'status', 'isExcluded', 'valorOriginal', 'totalCobranca', 'honorarios', 'valorExtra', 'valuePaid', 'valueReceived'];
const decode = (value: any): unknown => {
  if ('stringValue' in value) return value.stringValue;
  if ('booleanValue' in value) return value.booleanValue;
  if ('integerValue' in value) return Number(value.integerValue);
  if ('doubleValue' in value) return Number(value.doubleValue);
  return null;
};

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
    const response = await fetcher(`https://firestore.googleapis.com/v1/${root}:runQuery`, {
      method: 'POST', headers: { Authorization: `Bearer ${options.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body), signal: options.signal,
    });
    options.checkSession();
    if (!response.ok) throw new Error(response.status === 401 || response.status === 403
      ? 'Sessão sem permissão para ler o histórico financeiro. Entre novamente no aplicativo.'
      : `Não foi possível apurar o histórico completo (HTTP ${response.status}).`);
    const rows = await response.json();
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
