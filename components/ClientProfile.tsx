
import React, { useMemo } from 'react';
import { Transaction } from '../types';
import { X, Phone, TrendingUp, TrendingDown, Clock, AlertCircle, CheckCircle2, MessageCircle, User, CreditCard } from 'lucide-react';

interface ClientProfileProps {
  clientName: string;
  transactions: Transaction[];
  onClose: () => void;
}

export const ClientProfile: React.FC<ClientProfileProps> = ({ clientName, transactions, onClose }) => {
  const clientTransactions = useMemo(() => 
    transactions.filter(t => t.client === clientName && !t.isExcluded)
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()),
    [transactions, clientName]
  );

  const kpis = useMemo(() => {
    const totalFaturado = clientTransactions.reduce((acc, t) => acc + (t.totalCobranca || t.valueReceived || 0), 0);
    const totalRecebido = clientTransactions.filter(t => t.status === 'Pago' || (t.status as string) === 'Recebido').reduce((acc, t) => acc + (t.valueReceived || 0), 0);
    const totalPendente = clientTransactions.filter(t => t.status !== 'Pago' && (t.status as string) !== 'Recebido').reduce((acc, t) => acc + (t.totalCobranca || 0), 0);
    
    const today = new Date().toISOString().split('T')[0];
    const totalVencido = clientTransactions.filter(t => 
      t.status !== 'Pago' && (t.status as string) !== 'Recebido' && t.dueDate < today
    ).reduce((acc, t) => acc + (t.totalCobranca || 0), 0);

    const onTimePayments = clientTransactions.filter(t => 
      (t.status === 'Pago' || (t.status as string) === 'Recebido') && t.paymentDate && t.paymentDate <= t.dueDate
    ).length;
    
    const totalPayments = clientTransactions.filter(t => t.status === 'Pago' || (t.status as string) === 'Recebido').length;
    const adimplencia = totalPayments > 0 ? (onTimePayments / totalPayments) * 100 : 100;

    return { totalFaturado, totalRecebido, totalPendente, totalVencido, adimplencia };
  }, [clientTransactions]);

  const formatCurrency = (val: number) => 
    new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val);

  const handleWhatsAppShare = () => {
    const message = `Olá ${clientName}, segue resumo do seu extrato conosco:%0A%0A` +
      `📊 *Resumo Financeiro*%0A` +
      `✅ Total Pago: ${formatCurrency(kpis.totalRecebido)}%0A` +
      `⏳ Total Pendente: ${formatCurrency(kpis.totalPendente)}%0A` +
      `⚠️ Vencido: ${formatCurrency(kpis.totalVencido)}%0A%0A` +
      `Agradecemos a parceria!`;
    
    window.open(`https://wa.me/?text=${message}`, '_blank');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
      <div className="bg-white dark:bg-slate-900 w-full max-w-4xl max-h-[90vh] rounded-2xl shadow-2xl overflow-hidden flex flex-col border border-slate-200 dark:border-slate-800">
        {/* Header */}
        <div className="p-6 bg-slate-50 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="bg-blue-600 p-3 rounded-2xl shadow-lg shadow-blue-500/20">
              <User className="h-6 w-6 text-white" />
            </div>
            <div>
              <h2 className="text-xl font-black text-slate-800 dark:text-white">{clientName}</h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 font-medium uppercase tracking-widest">Perfil do Cliente</p>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="p-2 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-full transition-colors text-slate-400 hover:text-slate-600"
          >
            <X className="h-6 w-6" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-8">
          {/* KPIs */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="p-4 bg-blue-50 dark:bg-blue-900/10 rounded-2xl border border-blue-100 dark:border-blue-900/20">
              <span className="text-[10px] font-bold text-blue-600 dark:text-blue-400 uppercase tracking-wider block mb-1">Total Faturado</span>
              <span className="text-lg font-black text-blue-700 dark:text-blue-300">{formatCurrency(kpis.totalFaturado)}</span>
            </div>
            <div className="p-4 bg-emerald-50 dark:bg-emerald-900/10 rounded-2xl border border-emerald-100 dark:border-emerald-900/20">
              <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider block mb-1">Total Pago</span>
              <span className="text-lg font-black text-emerald-700 dark:text-emerald-300">{formatCurrency(kpis.totalRecebido)}</span>
            </div>
            <div className="p-4 bg-amber-50 dark:bg-amber-900/10 rounded-2xl border border-amber-100 dark:border-amber-900/20">
              <span className="text-[10px] font-bold text-amber-600 dark:text-amber-400 uppercase tracking-wider block mb-1">Total Pendente</span>
              <span className="text-lg font-black text-amber-700 dark:text-amber-300">{formatCurrency(kpis.totalPendente)}</span>
            </div>
            <div className="p-4 bg-red-50 dark:bg-red-900/10 rounded-2xl border border-red-100 dark:border-red-900/20">
              <span className="text-[10px] font-bold text-red-600 dark:text-red-400 uppercase tracking-wider block mb-1">Total Vencido</span>
              <span className="text-lg font-black text-red-700 dark:text-red-300">{formatCurrency(kpis.totalVencido)}</span>
            </div>
          </div>

          {/* Adimplência */}
          <div className="bg-slate-50 dark:bg-slate-800/30 p-6 rounded-2xl border border-slate-200 dark:border-slate-800">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-emerald-500" />
                <h3 className="font-bold text-slate-800 dark:text-white">Índice de Adimplência</h3>
              </div>
              <span className="text-2xl font-black text-emerald-500">{kpis.adimplencia.toFixed(1)}%</span>
            </div>
            <div className="h-4 w-full bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
              <div 
                className="h-full bg-emerald-500 transition-all duration-1000"
                style={{ width: `${kpis.adimplencia}%` }}
              />
            </div>
            <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">Percentual de pagamentos realizados rigorosamente no prazo.</p>
          </div>

          {/* Timeline */}
          <div>
            <h3 className="font-bold text-slate-800 dark:text-white mb-4 flex items-center gap-2">
              <Clock className="h-5 w-5 text-blue-500" />
              Últimas Movimentações
            </h3>
            <div className="space-y-3">
              {clientTransactions.slice(0, 15).map((t, idx) => (
                <div key={idx} className="flex items-center justify-between p-4 bg-white dark:bg-slate-900 rounded-xl border border-slate-100 dark:border-slate-800 hover:border-blue-200 dark:hover:border-blue-900/50 transition-colors">
                  <div className="flex items-center gap-4">
                    <div className={`p-2 rounded-lg ${t.status === 'Pago' ? 'bg-emerald-100 dark:bg-emerald-900/20 text-emerald-600' : 'bg-amber-100 dark:bg-amber-900/20 text-amber-600'}`}>
                      {t.status === 'Pago' ? <TrendingUp className="h-4 w-4" /> : <Clock className="h-4 w-4" />}
                    </div>
                    <div>
                      <p className="text-sm font-bold text-slate-800 dark:text-white">{t.description || 'Honorários'}</p>
                      <p className="text-[10px] text-slate-500">{new Date(t.date).toLocaleDateString('pt-BR')} • Venc: {new Date(t.dueDate).toLocaleDateString('pt-BR')}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-black text-slate-800 dark:text-white">{formatCurrency(t.totalCobranca || t.valueReceived || 0)}</p>
                    <span className={`text-[10px] font-bold uppercase ${t.status === 'Pago' ? 'text-emerald-500' : 'text-amber-500'}`}>{t.status}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-6 bg-slate-50 dark:bg-slate-800/50 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400">
            <CreditCard className="h-4 w-4" />
            <span className="text-xs font-medium">CPF/CNPJ: {clientTransactions[0]?.cpfCnpj || 'Não informado'}</span>
          </div>
          <button 
            onClick={handleWhatsAppShare}
            className="flex items-center gap-2 px-6 py-3 bg-emerald-500 hover:bg-emerald-600 text-white rounded-xl font-bold transition-all shadow-lg shadow-emerald-500/20"
          >
            <MessageCircle className="h-5 w-5" />
            Enviar Extrato via WhatsApp
          </button>
        </div>
      </div>
    </div>
  );
};
