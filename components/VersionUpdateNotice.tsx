import React, { useEffect, useRef, useState } from 'react';
import { RefreshCw, X, Bell } from 'lucide-react';
import { logger } from '../utils/logger';

interface BuildVersion {
  buildId: string;
  builtAt?: string;
  version?: string;
}

const VERSION_ENDPOINT = '/version.json';
const CHECK_INTERVAL_MS = 60000;
const LAST_SEEN_VERSION_KEY = 'sp_dashboard_last_seen_version';

const getStoredVersion = () => {
  try {
    return localStorage.getItem(LAST_SEEN_VERSION_KEY) || '';
  } catch {
    return '';
  }
};

const setStoredVersion = (buildId: string) => {
  try {
    localStorage.setItem(LAST_SEEN_VERSION_KEY, buildId);
  } catch {
    // Ignore storage restrictions; the in-memory notice still works for this session.
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

export const VersionUpdateNotice: React.FC = () => {
  const currentBuildIdRef = useRef('');
  const [remoteVersion, setRemoteVersion] = useState<BuildVersion | null>(null);
  const [isVisible, setIsVisible] = useState(false);
  const [isNewerThanCurrent, setIsNewerThanCurrent] = useState(false);

  useEffect(() => {
    let isMounted = true;

    const checkVersion = async () => {
      try {
        const version = await fetchBuildVersion();
        if (!version || !isMounted) return;

        const currentBuildId = currentBuildIdRef.current;
        if (!currentBuildId) {
          currentBuildIdRef.current = version.buildId;
          if (getStoredVersion() !== version.buildId) {
            setRemoteVersion(version);
            setIsNewerThanCurrent(false);
            setIsVisible(true);
          }
          return;
        }

        if (version.buildId !== currentBuildId && getStoredVersion() !== version.buildId) {
          setRemoteVersion(version);
          setIsNewerThanCurrent(true);
          setIsVisible(true);
        }
      } catch (error) {
        logger.warn('[VersionUpdateNotice] Falha ao verificar nova versão.', error);
      }
    };

    checkVersion();
    const interval = window.setInterval(checkVersion, CHECK_INTERVAL_MS);
    window.addEventListener('focus', checkVersion);

    return () => {
      isMounted = false;
      window.clearInterval(interval);
      window.removeEventListener('focus', checkVersion);
    };
  }, []);

  if (!isVisible || !remoteVersion) return null;

  const handleDismiss = () => {
    setStoredVersion(remoteVersion.buildId);
    setIsVisible(false);
  };

  const handleReload = () => {
    setStoredVersion(remoteVersion.buildId);
    window.location.reload();
  };

  return (
    <div className="fixed bottom-5 right-5 z-[70] print:hidden animate-in slide-in-from-bottom-2 fade-in duration-300">
      <div className="w-[min(360px,calc(100vw-2rem))] rounded-lg border border-blue-200 bg-white text-slate-900 shadow-2xl dark:border-blue-900 dark:bg-slate-900 dark:text-white">
        <div className="flex items-start gap-3 p-4">
          <div className="mt-0.5 rounded-full bg-blue-50 p-2 text-blue-700 dark:bg-blue-950 dark:text-blue-300">
            <Bell className="h-4 w-4" />
          </div>

          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold">
              {isNewerThanCurrent ? 'Nova versão disponível' : 'Nova versão publicada'}
            </p>
            <p className="mt-1 text-xs leading-relaxed text-slate-600 dark:text-slate-300">
              {isNewerThanCurrent
                ? 'Recarregue para usar as últimas correções do sistema.'
                : 'O sistema foi atualizado com as últimas correções.'}
            </p>
            {remoteVersion.builtAt && (
              <p className="mt-1 text-[10px] text-slate-400">
                Build {new Date(remoteVersion.builtAt).toLocaleString('pt-BR')}
              </p>
            )}
          </div>

          <button
            type="button"
            onClick={handleDismiss}
            className="rounded-md p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
            aria-label="Fechar aviso de versão"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-slate-100 px-4 py-3 dark:border-slate-800">
          <button
            type="button"
            onClick={handleDismiss}
            className="rounded-md px-3 py-2 text-xs font-semibold text-slate-500 transition-colors hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            Entendi
          </button>
          <button
            type="button"
            onClick={handleReload}
            className="inline-flex items-center gap-2 rounded-md bg-blue-700 px-3 py-2 text-xs font-bold text-white shadow-sm transition-colors hover:bg-blue-800"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Recarregar
          </button>
        </div>
      </div>
    </div>
  );
};
