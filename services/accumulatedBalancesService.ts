import { auth, firebaseConfig } from './firebaseConfig';
import { readAccumulatedBalances } from './accumulatedBalancesReader';

type Summary = Awaited<ReturnType<typeof readAccumulatedBalances>>;
let cache: { uid: string; at: number; data: Summary } | null = null;
let pending: { uid: string; promise: Promise<Summary> } | null = null;
const freshness = 10 * 60 * 1000;

export const AccumulatedBalancesService = {
  invalidate: () => { cache = null; },
  fetch: async (force = false): Promise<Summary> => {
    const user = auth.currentUser;
    if (!user) { cache = null; throw new Error('Entre novamente para consultar os saldos acumulados.'); }
    if (cache?.uid === user.uid && !force && Date.now() - cache.at < freshness) return cache.data;
    if (pending?.uid === user.uid) return pending.promise;
    const checkSession = () => { if (auth.currentUser?.uid !== user.uid) { cache = null; throw new Error('Sessão alterada durante a consulta.'); } };
    const operation = (async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 120000);
      try {
        const token = await user.getIdToken();
        checkSession();
        const data = await readAccumulatedBalances({ projectId: firebaseConfig.projectId, token, checkSession, signal: controller.signal });
        checkSession();
        cache = { uid: user.uid, at: Date.now(), data };
        return data;
      } catch (error) {
        cache = null;
        if (controller.signal.aborted) throw new Error('A apuração do histórico demorou mais que o esperado. Tente atualizar os saldos.');
        throw error;
      } finally { clearTimeout(timer); }
    })();
    pending = { uid: user.uid, promise: operation };
    try { return await operation; } finally { if (pending?.promise === operation) pending = null; }
  },
};
