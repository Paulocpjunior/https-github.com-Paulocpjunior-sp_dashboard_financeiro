/** A synchronous gate: React state alone cannot reject two clicks in one render. */
export function createBillingOperationGate() {
  let active = true, busy = false, version = 0;
  return {
    activate() { active = true; },
    dispose() { active = false; busy = false; version++; },
    start() {
      if (!active || busy) return null;
      busy = true;
      const current = ++version;
      const isCurrent = () => active && current === version;
      return {
        isCurrent,
        assertCurrent() { if (!isCurrent()) throw new Error('Conferência encerrada. Abra novamente antes de salvar.'); },
        finish() { if (isCurrent()) busy = false; },
      };
    },
  };
}

/** Read timeout only: never use this to infer that a write was cancelled. */
export async function withBillingReadTimeout<T>(promise: Promise<T>, timeoutMs = 30000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([promise, new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new Error('Leitura dos registros de conferência não concluída. Recarregue.')), timeoutMs);
    })]);
  } finally { clearTimeout(timer); }
}
