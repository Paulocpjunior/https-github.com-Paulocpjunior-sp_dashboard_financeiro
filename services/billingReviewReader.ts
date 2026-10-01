import { Transaction } from '../types';


const fields = ['id', 'cpfCnpj', 'clientNumber', 'date', 'dueDate', 'source', 'client', 'description', 'wixInvoiceNumber', 'wixEntityId', 'movement', 'type', 'status', 'isExcluded', 'valorOriginal', 'totalCobranca', 'honorarios', 'valorExtra', 'valuePaid', 'valueReceived'];
const decode = (value: any): unknown => {
  if ('stringValue' in value) return value.stringValue;
  if ('booleanValue' in value) return value.booleanValue;
  if ('integerValue' in value) return Number(value.integerValue);
  if ('doubleValue' in value) return Number(value.doubleValue);
  return null;
};

/** REST com o token Firebase do usuário: as mesmas regras Firestore continuam aplicadas. */
export async function readBillingReview(options: {
  projectId: string; token: string; fetcher?: typeof fetch; signal?: AbortSignal; checkSession: () => void;
}): Promise<{ transactions: Transaction[]; documentCount: number; readTime: string }> {
  const fetcher = options.fetcher || fetch;
  const root = `projects/${options.projectId}/databases/(default)/documents`;
  const transactions: Transaction[] = [];
  const seen = new Set<string>();
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
    if (!Array.isArray(rows) || !rows.length) throw new Error('Resposta incompleta na apuração da conferência.');
    const pageTime = rows.find(row => row.readTime)?.readTime;
    if (!pageTime || (readTime && pageTime !== readTime)) throw new Error('O histórico mudou de versão durante a consulta. Atualize os conferência.');
    readTime ||= pageTime;
    const documents = rows.filter(row => row.document).map(row => row.document);
    let last = cursor;
    for (const document of documents) {
      if (typeof document.name !== 'string' || !document.name.startsWith(`${root}/transactions/`) || seen.has(document.name)) throw new Error('Paginação inválida na apuração da conferência.');
      seen.add(document.name);
      last = document.name;
      const data = Object.fromEntries(Object.entries(document.fields || {}).map(([key, value]) => [key, decode(value)]));
      transactions.push({ ...data, id: document.name.split('/').pop() } as Transaction);
      count++;
    }
    cursor = last;
    if (documents.length < 1000) {
      options.checkSession();
      return { transactions, documentCount: count, readTime };
    }
  }
  throw new Error('O histórico excedeu o limite de apuração. Nenhum resultado parcial será apresentado.');
}
