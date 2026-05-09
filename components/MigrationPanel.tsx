import React from 'react';
import { AlertCircle, CheckCircle, Database } from 'lucide-react';

export const MigrationPanel: React.FC = () => {
  return (
    <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden transition-colors">
      <div className="p-4 border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/50 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Database className="h-5 w-5 text-blue-500" />
          <h3 className="font-bold text-slate-800 dark:text-white">Migração para Firebase</h3>
        </div>
        <span className="flex items-center gap-1 text-[10px] font-black uppercase tracking-widest text-emerald-500 bg-emerald-50 dark:bg-emerald-900/20 px-2.5 py-1 rounded-full">
          <CheckCircle className="h-3 w-3" /> Concluído
        </span>
      </div>

      <div className="p-6 space-y-6">
        <div className="space-y-3">
          <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
            A base oficial já está no Firestore. Este utilitário foi mantido apenas como registro histórico e não executa novas migrações.
          </p>
          <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 p-4 rounded-xl flex gap-3">
            <AlertCircle className="h-5 w-5 text-amber-500 flex-shrink-0" />
            <div className="space-y-1">
              <p className="text-xs font-bold text-amber-800 dark:text-amber-200 uppercase tracking-wider">Atenção</p>
              <p className="text-xs text-amber-700 dark:text-amber-300">
                Novos dados devem ser lidos e mantidos diretamente pelo Firebase.
              </p>
            </div>
          </div>
        </div>

        <button
          disabled
          className="w-full py-4 rounded-xl font-black uppercase tracking-widest text-sm flex items-center justify-center gap-3 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400 cursor-default"
        >
          <CheckCircle className="h-5 w-5" />
          Migração Concluída
        </button>
      </div>
    </div>
  );
};
