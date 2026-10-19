// Aviso de atualização em popup, no mesmo modelo do Consultor DP:
// - Nova versão publicada: popup no centro da tela com a lista do que mudou
//   desde a versão aberta e o botão "Atualizar agora". "Depois" só adia por
//   10 minutos; enquanto isso fica uma faixa no topo.
// - Depois de atualizar: popup "Sistema atualizado" com o que mudou desde a
//   última versão que esta pessoa usou neste navegador.
// A lista vem do version.json (novidades geradas no build por write-build-version.mjs).
import React, { useEffect, useRef, useState } from 'react';
import { Bell, Check, RefreshCw } from 'lucide-react';
import { logger } from '../utils/logger';
import { dataBr, mesmoCommit, novidadesDesde, type BuildVersion, type Novidade } from '../utils/versionNotes';

declare const __APP_COMMIT__: string;

const APP_COMMIT = typeof __APP_COMMIT__ !== 'undefined' ? __APP_COMMIT__ : '';
const VERSION_ENDPOINT = '/version.json';
const CHECK_INTERVAL_MS = 60000;
const ADIAMENTO_MS = 10 * 60000;
const CHAVE_ADIADO = 'sp_dashboard_update_adiado';
const CHAVE_ULTIMA_VISTA = 'sp_dashboard_ultima_versao_vista';

const ler = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const gravar = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* sem armazenamento: o aviso segue nesta sessão */ } };

/** Até quando este commit foi adiado (ms), ou 0. */
const adiadoAte = (commit: string): number => {
  try {
    const a = JSON.parse(ler(CHAVE_ADIADO) ?? 'null') as { commit: string; ate: number } | null;
    return a && a.commit === commit && a.ate > Date.now() ? a.ate : 0;
  } catch {
    return 0;
  }
};

const fetchBuildVersion = async (): Promise<BuildVersion | null> => {
  const response = await fetch(`${VERSION_ENDPOINT}?t=${Date.now()}`, {
    cache: 'no-store',
    headers: { Accept: 'application/json' },
  });

  if (!response.ok) return null;
  const payload = await response.json();
  if (!payload?.buildId) return null;
  return payload;
};

/** Limpa caches do navegador antes de recarregar, como nos demais apps. */
const reloadForUpdate = async () => {
  try {
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister()));
    }
  } catch (error) {
    logger.warn('[VersionUpdateNotice] Falha ao limpar o cache antes de recarregar.', error);
  }
  window.location.reload();
};

const ListaNovidades: React.FC<{ itens: Novidade[]; mais: number }> = ({ itens, mais }) => (
  itens.length ? (
    <ol className="space-y-2">
      {itens.map((n) => (
        <li key={n.commit} className="rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-900/60">
          <div className="flex items-start gap-2">
            <span className="mt-1.5 inline-block h-2 w-2 shrink-0 rounded-full bg-emerald-500" aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-slate-800 dark:text-white">{n.titulo}</p>
              {n.itens.length > 0 && (
                <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[13px] text-slate-600 dark:text-slate-300">
                  {n.itens.map((it, i) => <li key={i}>{it}</li>)}
                </ul>
              )}
              <p className="mt-1 text-[13px] tabular-nums text-slate-500 dark:text-slate-400">{dataBr(n.data)}</p>
            </div>
          </div>
        </li>
      ))}
      {mais > 0 && <li className="text-[13px] text-slate-500 dark:text-slate-400">e mais {mais} melhoria(s) anterior(es).</li>}
    </ol>
  ) : <p className="text-sm text-slate-600 dark:text-slate-300">Correções e melhorias gerais.</p>
);

export const VersionUpdateNotice: React.FC = () => {
  // Commit da versão aberta: o embutido no bundle; em dev, o primeiro version.json lido.
  const currentCommitRef = useRef(APP_COMMIT);
  const [remote, setRemote] = useState<BuildVersion | null>(null);
  const [aberto, setAberto] = useState(false);
  const [atualizado, setAtualizado] = useState<{ itens: Novidade[]; mais: number } | null>(null);
  const [reloading, setReloading] = useState(false);
  const botao = useRef<HTMLButtonElement>(null);
  const avisado = useRef('');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Nova versão publicada.
  useEffect(() => {
    let isMounted = true;

    const checkVersion = async () => {
      try {
        const version = await fetchBuildVersion();
        if (!version?.commit || !isMounted) return;
        if (!currentCommitRef.current) {
          currentCommitRef.current = version.commit;
          return;
        }
        if (mesmoCommit(version.commit, currentCommitRef.current) || version.commit === avisado.current) return;
        avisado.current = version.commit;
        setRemote(version);
        const ate = adiadoAte(version.commit);
        if (timer.current) clearTimeout(timer.current);
        if (ate) {
          setAberto(false);
          timer.current = setTimeout(() => setAberto(true), ate - Date.now());
        } else {
          setAberto(true);
        }
      } catch (error) {
        logger.warn('[VersionUpdateNotice] Falha ao verificar nova versão.', error);
      }
    };

    const onVisible = () => { if (document.visibilityState === 'visible') checkVersion(); };
    checkVersion();
    const interval = window.setInterval(checkVersion, CHECK_INTERVAL_MS);
    window.addEventListener('focus', checkVersion);
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      isMounted = false;
      window.clearInterval(interval);
      window.removeEventListener('focus', checkVersion);
      document.removeEventListener('visibilitychange', onVisible);
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  // Acabou de atualizar: mostra o que mudou desde a última versão vista neste navegador.
  useEffect(() => {
    if (!APP_COMMIT) return;
    const anterior = ler(CHAVE_ULTIMA_VISTA);
    gravar(CHAVE_ULTIMA_VISTA, APP_COMMIT);
    if (!anterior || mesmoCommit(anterior, APP_COMMIT)) return;
    let vivo = true;
    fetchBuildVersion()
      .then((r) => {
        if (vivo && r && mesmoCommit(r.commit, APP_COMMIT)) setAtualizado(novidadesDesde(r.novidades, anterior));
      })
      .catch((error) => logger.warn('[VersionUpdateNotice] Falha ao carregar as novidades.', error));
    return () => { vivo = false; };
  }, []);

  const popup = (remote && aberto) || (!remote && atualizado);
  useEffect(() => { if (popup) botao.current?.focus(); }, [popup]);

  const atualizar = async () => {
    setReloading(true);
    await reloadForUpdate();
  };
  const adiar = () => {
    if (!remote?.commit) return;
    gravar(CHAVE_ADIADO, JSON.stringify({ commit: remote.commit, ate: Date.now() + ADIAMENTO_MS }));
    setAberto(false);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setAberto(true), ADIAMENTO_MS);
  };
  const fecharAtualizado = () => setAtualizado(null);

  if (!remote && !atualizado) return null;

  // Adiado: faixa fixa no topo, sem opção de esconder de vez.
  if (remote && !aberto) {
    return (
      <div role="status" className="fixed inset-x-0 top-0 z-[65] bg-amber-500 text-white shadow-lg print:hidden">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-2 px-4 py-2">
          <Bell className="h-4 w-4 shrink-0" strokeWidth={1.75} aria-hidden />
          <strong className="text-sm">Nova versão esperando para ser instalada</strong>
          <div className="ml-auto flex gap-2">
            <button type="button" className="rounded-md bg-white/20 px-3 py-1.5 text-[13px] font-semibold hover:bg-white/30" onClick={() => setAberto(true)}>
              Ver o que mudou
            </button>
            <button type="button" className="rounded-md bg-white px-3 py-1.5 text-[13px] font-semibold text-amber-800 hover:bg-amber-50 disabled:opacity-50" disabled={reloading} onClick={atualizar}>
              {reloading ? 'Atualizando…' : 'Atualizar agora'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  const nova = !!remote;
  const lista = nova ? novidadesDesde(remote!.novidades, currentCommitRef.current) : atualizado!;

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-900/70 p-4 print:hidden"
      onKeyDown={(e) => { if (e.key === 'Escape') (nova ? adiar() : fecharAtualizado()); }}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="update-titulo"
        aria-describedby="update-desc"
        className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-white shadow-2xl ring-4 ring-amber-400 dark:bg-slate-800"
      >
        <div className={`flex items-center gap-3 px-5 py-4 text-white ${nova ? 'bg-blue-600' : 'bg-emerald-600'}`}>
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/20">
            {nova ? <Bell className="h-5 w-5" strokeWidth={1.75} aria-hidden /> : <Check className="h-5 w-5" strokeWidth={1.75} aria-hidden />}
          </span>
          <div className="min-w-0">
            <h2 id="update-titulo" className="text-lg font-semibold leading-tight">
              {nova ? 'Nova versão do Sistema Financeiro' : 'Sistema atualizado'}
            </h2>
            {nova && remote!.builtAt && (
              <p className="text-[13px] text-white/80 tabular-nums">Publicada em {new Date(remote!.builtAt).toLocaleString('pt-BR')}</p>
            )}
          </div>
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto px-5 py-4">
          <p id="update-desc" className="text-sm text-slate-700 dark:text-slate-200">
            {nova
              ? <>Atualize agora para usar as novidades abaixo. <strong>Salve o que estiver editando antes.</strong></>
              : 'Veja o que mudou desde a última vez que você usou o sistema:'}
          </p>
          <ListaNovidades itens={lista.itens} mais={lista.mais} />
        </div>

        <div className="flex flex-col-reverse gap-2 border-t border-slate-200 px-5 py-3 sm:flex-row sm:justify-end dark:border-slate-700">
          {nova ? (
            <>
              <button type="button" className="rounded-lg px-4 py-2.5 text-sm text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700" onClick={adiar}>
                Depois (lembrar em 10 min)
              </button>
              <button
                ref={botao}
                type="button"
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-blue-700 disabled:opacity-50"
                disabled={reloading}
                onClick={atualizar}
              >
                <RefreshCw className={`h-4 w-4 ${reloading ? 'motion-safe:animate-spin' : ''}`} strokeWidth={1.75} aria-hidden />
                {reloading ? 'Atualizando…' : 'Atualizar agora'}
              </button>
            </>
          ) : (
            <button ref={botao} type="button" className="rounded-lg bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-emerald-700" onClick={fecharAtualizado}>
              Entendi
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
