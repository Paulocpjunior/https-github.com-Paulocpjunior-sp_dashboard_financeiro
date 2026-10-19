// Novidades do aviso de atualização, no mesmo modelo do Consultor DP:
// a lista vem do version.json (scripts/write-build-version.mjs grava os
// últimos commits da main) e o popup mostra o que mudou desde a versão aberta.

export interface Novidade {
  commit: string;
  data: string;
  titulo: string;
  itens: string[];
}

export interface BuildVersion {
  buildId: string;
  builtAt?: string;
  version?: string;
  commit?: string;
  novidades?: Novidade[];
}

/** SHAs curtos podem ter tamanhos diferentes conforme o ambiente do build. */
export const mesmoCommit = (a?: string, b?: string) => !!a && !!b && (a.startsWith(b) || b.startsWith(a));

/**
 * O que mudou desde `commit` (a versão aberta): as novidades mais novas até
 * encontrar a dela. Sem ela na lista (versão muito antiga ou build local),
 * as `max` mais recentes.
 */
export function novidadesDesde(lista: Novidade[] | undefined, commit: string, max = 12): { itens: Novidade[]; mais: number } {
  const todas = lista ?? [];
  const i = todas.findIndex((n) => mesmoCommit(n.commit, commit));
  const novas = i >= 0 ? todas.slice(0, i) : todas;
  return { itens: novas.slice(0, max), mais: Math.max(0, novas.length - max) };
}

export const dataBr = (d: string) => (/^\d{4}-\d{2}-\d{2}$/.test(d) ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : d);
