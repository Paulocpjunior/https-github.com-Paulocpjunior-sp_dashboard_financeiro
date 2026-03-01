
import React, { useState, useMemo } from 'react';
import { Transaction } from '../types';
import { AlertCircle, Calendar, CheckCircle, ChevronDown, ChevronUp, X, Bell } from 'lucide-react';

interface AlertsBannerProps {
  transactions: Transaction[];
  onAlertClick: (filters: { status?: string; dueDateStart?: string; dueDateEnd?: string; movement?: string }) => void;
}

export const AlertsBanner: React.FC<AlertsBannerProps> = ({ transactions, onAlertClick }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isVisible, setIsVisible] = useState(true);

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayStr = today.toISOString().split('T')[0];

  const threeDaysLater = new Date(today);
  threeDaysLater.setDate(today.getDate() + 3);
  const threeDaysLaterStr = threeDaysLater.toISOString().split('T')[0];

  const alerts = useMemo(() => {
    const overdue = transactions.filter(t => 
      t.status !== 'Pago' && (t.status as string) !== 'Recebido' && t.dueDate < todayStr && !t.isExcluded
    );
    const dueToday = transactions.filter(t => 
      t.status !== 'Pago' && (t.status as string) !== 'Recebido' && t.dueDate === todayStr && !t.isExcluded
    );
    const dueSoon = transactions.filter(t => 
      t.status !== 'Pago' && (t.status as string) !== 'Recebido' && t.dueDate > todayStr && t.dueDate <= threeDaysLaterStr && !t.isExcluded
    );
    const receivablesToday = transactions.filter(t => 
      t.movement === 'Entrada' && t.status !== 'Pago' && (t.status as string) !== 'Recebido' && t.dueDate === todayStr && !t.isExcluded
    );

    return { overdue, dueToday, dueSoon, receivablesToday };
  }, [transactions, todayStr, threeDaysLaterStr]);

  if (!isVisible || (alerts.overdue.length === 0 && alerts.dueToday.length === 0 && alerts.dueSoon.length === 0 && alerts.receivablesToday.length === 0)) {
    return null;
  }

  const formatCurrency = (val: number) => 
    new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val);

  return (
    <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-lg overflow-hidden transition-all duration-300 mb-6">
      <div className="flex items-center justify-between p-4 bg-slate-50 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-800">
        <div className="flex items-center gap-3">
          <div className="bg-blue-100 dark:bg-blue-900/30 p-2 rounded-lg">
            <Bell className="h-5 w-5 text-blue-600 dark:text-blue-400 animate-pulse" />
          </div>
          <div>
            <h3 className="font-bold text-slate-800 dark:text-white text-sm">Central de Alertas Financeiros</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">Ações prioritárias para hoje</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button 
            onClick={() => setIsExpanded(!isExpanded)}
            className="p-2 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg transition-colors text-slate-600 dark:text-slate-400"
          >
            {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
          <button 
            onClick={() => setIsVisible(false)}
            className="p-2 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors text-slate-400 hover:text-red-500"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="p-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Overdue */}
        <div 
          onClick={() => onAlertClick({ status: 'Pendente', dueDateEnd: todayStr })}
          className="cursor-pointer p-3 rounded-xl bg-red-50 dark:bg-red-900/10 border border-red-100 dark:border-red-900/20 hover:shadow-md transition-all group"
        >
          <div className="flex items-center gap-2 mb-1">
            <AlertCircle className="h-4 w-4 text-red-600 dark:text-red-400" />
            <span className="text-xs font-bold text-red-800 dark:text-red-300 uppercase tracking-wider">Vencidos</span>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-black text-red-600 dark:text-red-400">{alerts.overdue.length}</span>
            <span className="text-xs text-red-700/60 dark:text-red-300/60 font-medium">Contas</span>
          </div>
        </div>

        {/* Due Today */}
        <div 
          onClick={() => onAlertClick({ status: 'Pendente', dueDateStart: todayStr, dueDateEnd: todayStr })}
          className="cursor-pointer p-3 rounded-xl bg-amber-50 dark:bg-amber-900/10 border border-amber-100 dark:border-amber-900/20 hover:shadow-md transition-all"
        >
          <div className="flex items-center gap-2 mb-1">
            <Calendar className="h-4 w-4 text-amber-600 dark:text-amber-400" />
            <span className="text-xs font-bold text-amber-800 dark:text-amber-300 uppercase tracking-wider">Vencem Hoje</span>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-black text-amber-600 dark:text-amber-400">{alerts.dueToday.length}</span>
            <span className="text-xs text-amber-700/60 dark:text-amber-300/60 font-medium">Contas</span>
          </div>
        </div>

        {/* Due Soon */}
        <div 
          onClick={() => onAlertClick({ status: 'Pendente', dueDateStart: todayStr, dueDateEnd: threeDaysLaterStr })}
          className="cursor-pointer p-3 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-800 hover:shadow-md transition-all"
        >
          <div className="flex items-center gap-2 mb-1">
            <Calendar className="h-4 w-4 text-slate-600 dark:text-slate-400" />
            <span className="text-xs font-bold text-slate-800 dark:text-slate-300 uppercase tracking-wider">Próximos 3 Dias</span>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-black text-slate-600 dark:text-slate-400">{alerts.dueSoon.length}</span>
            <span className="text-xs text-slate-700/60 dark:text-slate-300/60 font-medium">Contas</span>
          </div>
        </div>

        {/* Receivables Today */}
        <div 
          onClick={() => onAlertClick({ movement: 'Entrada', status: 'Pendente', dueDateStart: todayStr, dueDateEnd: todayStr })}
          className="cursor-pointer p-3 rounded-xl bg-emerald-50 dark:bg-emerald-900/10 border border-emerald-100 dark:border-emerald-900/20 hover:shadow-md transition-all"
        >
          <div className="flex items-center gap-2 mb-1">
            <CheckCircle className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
            <span className="text-xs font-bold text-emerald-800 dark:text-emerald-300 uppercase tracking-wider">Receber Hoje</span>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-black text-emerald-600 dark:text-emerald-400">{alerts.receivablesToday.length}</span>
            <span className="text-xs text-emerald-700/60 dark:text-emerald-300/60 font-medium">Contas</span>
          </div>
        </div>
      </div>

      {isExpanded && (
        <div className="p-4 bg-slate-50 dark:bg-slate-800/30 border-t border-slate-200 dark:border-slate-800">
          <h4 className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase mb-3 px-1">Detalhes das Prioridades</h4>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
            {[...alerts.overdue, ...alerts.dueToday, ...alerts.receivablesToday].slice(0, 12).map((t, idx) => (
              <div key={idx} className="flex items-center justify-between p-2 bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 text-xs">
                <div className="flex flex-col">
                  <span className="font-bold text-slate-800 dark:text-white truncate max-w-[120px]">{t.client}</span>
                  <span className="text-[10px] text-slate-500">{new Date(t.dueDate).toLocaleDateString('pt-BR')}</span>
                </div>
                <span className={`font-black ${t.movement === 'Saída' ? 'text-red-500' : 'text-emerald-500'}`}>
                  {formatCurrency(t.movement === 'Saída' ? t.valuePaid : (t.totalCobranca || t.valueReceived || 0))}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
