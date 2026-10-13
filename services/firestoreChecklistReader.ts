import { mapFirestoreChecklist, type RegistryDocument } from '../utils/firestoreChecklist';


const fields = ['client','clientNumber','cpfCnpjDigits','cpfCnpj','status','active','billingInstructions','createdAt','updatedAt'];
const decode = (value: any): unknown => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Campo inválido na leitura dos cadastros.');
  if ('stringValue' in value) return value.stringValue;
  if ('timestampValue' in value) return value.timestampValue;
  if ('booleanValue' in value) return value.booleanValue;
  if ('integerValue' in value) return Number(value.integerValue);
  if ('doubleValue' in value) return Number(value.doubleValue);
  return null;
};

/** REST com o token Firebase do usuário: as mesmas regras Firestore continuam aplicadas. */
export async function readFirestoreChecklist(options: {
  projectId: string; token: string; fetcher?: typeof fetch; signal?: AbortSignal; checkSession: () => void;
}) {
  const fetcher = options.fetcher || fetch;
  const root = `projects/${options.projectId}/databases/(default)/documents`;
  const registry: RegistryDocument[] = [];
  const seen = new Set<string>();

  let readTime = '';

  const checkActive = () => {
    options.signal?.throwIfAborted();
    options.checkSession();
  };
  for (const collection of ['clientRegistry', 'billingProfiles'] as const) {
    let cursor = '';
    let complete = false;
    for (let page = 0; page < 500; page++) {
      checkActive();
      const query: any = {
        from: [{ collectionId: collection }], select: { fields: fields.map(fieldPath => ({ fieldPath })) },
        orderBy: [{ field: { fieldPath: '__name__' }, direction: 'ASCENDING' }], limit: 1000,
      };
      if (cursor) query.startAt = { values: [{ referenceValue: cursor }], before: false };
      const body: any = { structuredQuery: query };
      if (readTime) body.readTime = readTime;
      const response = await fetcher(`https://firestore.googleapis.com/v1/${root}:runQuery`, {
        method: 'POST', headers: { Authorization: `Bearer ${options.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body), signal: options.signal,
      });
      checkActive();
      if (!response.ok) throw new Error(response.status === 401 || response.status === 403
        ? 'Sessão sem permissão para ler o cadastro financeiro. Entre novamente no aplicativo.'
        : `Não foi possível consultar todos os cadastros (HTTP ${response.status}).`);
      const rows = await response.json();
      checkActive();
      if (!Array.isArray(rows) || !rows.length) throw new Error('Resposta incompleta na apuração da conferência.');
      if (rows.some(row => !row || typeof row !== 'object' || Array.isArray(row) || 'error' in row ||
        ('document' in row && (!row.document || typeof row.document !== 'object' || Array.isArray(row.document))) ||
        (!row.document && !row.readTime))) throw new Error('Resposta incompleta na apuração da conferência.');
      const pageTime = rows.find(row => row.readTime)?.readTime;
      if (typeof pageTime !== 'string' || !Number.isFinite(Date.parse(pageTime)) || (readTime && pageTime !== readTime)) throw new Error('O cadastro mudou de versão durante a consulta. Atualize a conferência.');
      readTime ||= pageTime;
    if (rows.some(row => row.readTime && row.readTime !== readTime)) throw new Error('O cadastro mudou de versão durante a consulta.');
      const documents = rows.filter(row => row.document).map(row => row.document);
      let last = cursor;
      for (const document of documents) {
        const prefix = `${root}/${collection}/`;
        if (typeof document.name !== 'string' || !document.name.startsWith(prefix) ||
          !document.name.slice(prefix.length) || document.name.slice(prefix.length).includes('/') ||
          seen.has(document.name)) throw new Error('Paginação inválida na apuração da conferência.');
        seen.add(document.name);
        last = document.name;
        const data = Object.fromEntries(Object.entries(document.fields || {}).map(([key, value]) => [key, decode(value)]));
        registry.push({collection, id:document.name.slice(prefix.length), data});
      }
      cursor = last;
      if (documents.length < 1000) {
        checkActive();
        complete = true;
        break;
      }
    }
    if (!complete) throw new Error('Os cadastros excederam o limite de leitura. Nenhum resultado parcial será apresentado.');
  }
  const review = await mapFirestoreChecklist(registry,readTime);
  checkActive();
  return review;
}
