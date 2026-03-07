
import { useState, useEffect, useMemo } from 'react';

export type ConnectionState = 'connected' | 'stale' | 'offline' | 'refreshing';

interface ConnectionStatus {
  state: ConnectionState;
  label: string;
  colorClass: string;
  countdown: number;
}

export const useConnectionStatus = (
  lastUpdated: Date | null,
  isRefreshing: boolean,
  refreshIntervalSec: number = 60
): ConnectionStatus => {
  const [countdown, setCountdown] = useState(refreshIntervalSec);
  const [isOnline, setIsOnline] = useState(navigator.onLine);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  useEffect(() => {
    setCountdown(refreshIntervalSec);
  }, [lastUpdated, refreshIntervalSec]);

  useEffect(() => {
    if (isRefreshing) return;

    const timer = setInterval(() => {
      setCountdown((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);

    return () => clearInterval(timer);
  }, [isRefreshing]);

  const status = useMemo((): ConnectionStatus => {
    if (!isOnline) {
      return {
        state: 'offline',
        label: 'Offline',
        colorClass: 'bg-red-500',
        countdown: 0
      };
    }

    if (isRefreshing) {
      return {
        state: 'refreshing',
        label: 'Atualizando...',
        colorClass: 'bg-blue-500',
        countdown: 0
      };
    }

    if (!lastUpdated) {
      return {
        state: 'stale',
        label: 'Sem dados',
        colorClass: 'bg-amber-500',
        countdown: 0
      };
    }

    const diffMs = new Date().getTime() - lastUpdated.getTime();
    const isStale = diffMs > 5 * 60 * 1000; // 5 minutes

    if (isStale) {
      return {
        state: 'stale',
        label: 'Dados Desatualizados',
        colorClass: 'bg-amber-500',
        countdown: 0
      };
    }

    return {
      state: 'connected',
      label: 'Conectado',
      colorClass: 'bg-emerald-500',
      countdown
    };
  }, [isOnline, isRefreshing, lastUpdated, countdown]);

  return status;
};
