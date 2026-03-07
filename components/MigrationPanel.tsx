import React, { useState } from 'react';
import { BackendService } from '../services/backendService';
import { FirebaseService } from '../services/firebaseService';
import { Database, Play, CheckCircle, AlertCircle, Loader2, List, Clock } from 'lucide-react';
import { writeBatch, doc, collection } from 'firebase/firestore';
import { db } from '../services/firebaseConfig';

export const MigrationPanel: React.FC = () => {
  const [isMigrating, setIsMigrating] = useState(false);
  const [progress, setProgress] = useState(0);
  const [logs, setLogs] = useState<string[]>([]);
  const [status, setStatus] = useState<'idle' | 'running' | 'success' | 'error'>('idle');

  const addLog = (message: string) => {
    setLogs(prev => [`[${new Date().toLocaleTimeString()}] ${message}`, ...prev]);
  };

  const handleStartMigration = async () => {
    if (isMigrating) return;
    
    setIsMigrating(true);
    setStatus('running');
    setLogs([]);
    setProgress(0);
    addLog('Iniciando processo de migração...');

    try {
      addLog('Buscando transações do Google Sheets...');
      const transactions = await BackendService.fetchTransactions();
      addLog(`Encontradas ${transactions.length} transações.`);

      // Grava no Firestore (FirebaseService.migrateFromSheets)
      if (typeof (FirebaseService as any).migrateFromSheets === 'function') {
         await (FirebaseService as any).migrateFromSheets(transactions, (p: number, msg: string) => {
             setProgress(p);
             addLog(msg);
         });
      } else {
         // Implementação direta caso o método não exista no FirebaseService
         const BATCH_SIZE = 500;
         for (let i = 0; i < transactions.length; i += BATCH_SIZE) {
            const batch = writeBatch(db);
            const chunk = transactions.slice(i, i + BATCH_SIZE);
            
            chunk.forEach(t => {
               const docRef = doc(collection(db, 'transactions'));
               batch.set(docRef, t);
            });
            
            await batch.commit();
            const currentProgress = Math.round(((i + chunk.length) / transactions.length) * 100);
            setProgress(currentProgress);
            addLog(`Lote ${Math.floor(i/BATCH_SIZE) + 1} salvo no Firestore (${chunk.length} itens)...`);
         }
      }

      setProgress(100);
      setStatus('success');
      addLog('Processo finalizado com sucesso!');
    } catch (error: any) {
      setStatus('error');
      addLog(`ERRO FATAL: ${error.message}`);
    } finally {
      setIsMigrating(false);
    }
  };

  return (
    <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden transition-colors">
      {/* Header */}
      <div className="p-4 border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/50 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Database className="h-5 w-5 text-blue-500" />
          <h3 className="font-bold text-slate-800 dark:text-white">Migração para Firebase</h3>
        </div>
        {status === 'success' && (
          <span className="flex items-center gap-1 text-[10px] font-black uppercase tracking-widest text-emerald-500 bg-emerald-50 dark:bg-emerald-900/20 px-2.5 py-1 rounded-full">
            <CheckCircle className="h-3 w-3" /> Concluído
          </span>
        )}
      </div>

      <div className="p-6 space-y-6">
        {/* Description */}
        <div className="space-y-3">
          <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
            Este utilitário irá ler todos os dados da planilha Google Sheets configurada e transferi-los para o banco de dados Firestore do Firebase.
          </p>
          <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 p-4 rounded-xl flex gap-3">
            <AlertCircle className="h-5 w-5 text-amber-500 flex-shrink-0" />
            <div className="space-y-1">
              <p className="text-xs font-bold text-amber-800 dark:text-amber-200 uppercase tracking-wider">Atenção</p>
              <p className="text-xs text-amber-700 dark:text-amber-300">
                Certifique-se de que as variáveis de ambiente do Firebase estão configuradas corretamente no arquivo .env.
              </p>
            </div>
          </div>
        </div>

        {/* Progress Section */}
        {status !== 'idle' && (
          <div className="space-y-3 animate-in fade-in slide-in-from-top-2 duration-300">
            <div className="flex justify-between items-end">
              <div className="space-y-1">
                <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Status da Migração</span>
                <p className="text-sm font-bold text-slate-700 dark:text-slate-200">
                  {status === 'running' ? 'Processando registros...' : status === 'success' ? 'Migração finalizada' : 'Erro na migração'}
                </p>
              </div>
              <span className="text-lg font-black text-blue-600 dark:text-blue-400">{progress}%</span>
            </div>
            <div className="w-full bg-slate-100 dark:bg-slate-700 rounded-full h-3 overflow-hidden shadow-inner">
              <div 
                className={`h-full transition-all duration-500 ease-out shadow-sm ${
                  status === 'error' ? 'bg-red-500' : status === 'success' ? 'bg-emerald-500' : 'bg-blue-500'
                }`}
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        )}

        {/* Action Button */}
        <button
          onClick={handleStartMigration}
          disabled={isMigrating || status === 'success'}
          className={`w-full py-4 rounded-xl font-black uppercase tracking-widest text-sm flex items-center justify-center gap-3 transition-all transform active:scale-95 ${
            isMigrating 
              ? 'bg-slate-100 dark:bg-slate-700 text-slate-400 cursor-not-allowed' 
              : status === 'success'
                ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400 cursor-default'
                : 'bg-blue-600 text-white hover:bg-blue-700 shadow-xl shadow-blue-500/20 hover:shadow-blue-500/40'
          }`}
        >
          {isMigrating ? (
            <Loader2 className="h-5 w-5 animate-spin" />
          ) : status === 'success' ? (
            <CheckCircle className="h-5 w-5" />
          ) : (
            <Play className="h-5 w-5 fill-current" />
          )}
          {isMigrating ? 'Migrando Dados...' : status === 'success' ? 'Dados Migrados' : 'Iniciar Migração'}
        </button>

        {/* Logs Section */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <List className="h-3.5 w-3.5 text-slate-400" />
              <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Logs do Processo</h4>
            </div>
            {logs.length > 0 && (
              <div className="flex items-center gap-1 text-[9px] text-slate-400 font-mono">
                <Clock className="h-2.5 w-2.5" />
                <span>Último log: {new Date().toLocaleTimeString()}</span>
              </div>
            )}
          </div>
          <div className="bg-slate-50 dark:bg-slate-900 rounded-xl p-4 h-48 overflow-y-auto font-mono text-[10px] space-y-2 border border-slate-200 dark:border-slate-800 shadow-inner scrollbar-thin scrollbar-thumb-slate-200 dark:scrollbar-thumb-slate-800">
            {logs.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-slate-400 opacity-50 space-y-2">
                <Database className="h-8 w-8" />
                <span className="italic">Aguardando início do processo...</span>
              </div>
            ) : (
              logs.map((log, i) => (
                <div 
                  key={i} 
                  className={`flex gap-2 animate-in fade-in slide-in-from-left-1 duration-200 ${
                    log.includes('ERRO') 
                      ? 'text-red-500 font-bold' 
                      : log.includes('sucesso') 
                        ? 'text-emerald-500 font-bold' 
                        : 'text-slate-600 dark:text-slate-400'
                  }`}
                >
                  <span className="text-slate-300 dark:text-slate-700 shrink-0">›</span>
                  <span className="break-all">{log}</span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
