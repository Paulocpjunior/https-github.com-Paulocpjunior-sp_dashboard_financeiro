
import React from 'react';
import { Wifi, RefreshCw, Clock } from 'lucide-react';
import { useConnectionStatus } from '../hooks/useConnectionStatus';

interface ConnectionBadgeProps {
  lastUpdated: Date | null;
  isRefreshing: boolean;
  onRefresh: () => void;
}

export const ConnectionBadge: React.FC<ConnectionBadgeProps> = ({
  lastUpdated,
  isRefreshing,
  onRefresh
}) => {
  const { state, label, colorClass, countdown } = useConnectionStatus(lastUpdated, isRefreshing);

  const formatTime = (date: Date | null) => {
    if (!date) return '--:--';
    return date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };

  return (
    <div className="flex items-center gap-3 bg-white dark:bg-slate-800 px-3 py-1.5 rounded-full border border-slate-200 dark:border-slate-700 shadow-sm transition-colors">
      <div className="flex items-center gap-2">
        <div className="relative flex h-2 w-2">
          {state === 'connected' && (
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
          )}
          <span className={`relative inline-flex rounded-full h-2 w-2 ${colorClass}`}></span>
        </div>
        
        <div className="flex flex-col">
          <div className="flex items-center gap-1.5">
            <Wifi className={`h-3 w-3 ${state === 'offline' ? 'text-red-500' : 'text-slate-400'}`} />
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              {label}
            </span>
          </div>
          <div className="flex items-center gap-1 text-[9px] text-slate-400 font-mono">
            <Clock className="h-2.5 w-2.5" />
            <span>Sinc: {formatTime(lastUpdated)}</span>
            {state === 'connected' && countdown > 0 && (
              <span className="ml-1 text-blue-500">({countdown}s)</span>
            )}
          </div>
        </div>
      </div>

      <div className="w-px h-6 bg-slate-200 dark:bg-slate-700 mx-1"></div>

      <button
        onClick={onRefresh}
        disabled={isRefreshing}
        className={`p-1.5 rounded-full hover:bg-slate-100 dark:hover:bg-slate-700 transition-all ${
          isRefreshing ? 'text-blue-500' : 'text-slate-500 dark:text-slate-400'
        }`}
        title="Atualizar agora"
      >
        <RefreshCw className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
      </button>
    </div>
  );
};
