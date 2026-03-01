
import React from 'react';
import { Transaction } from '../types';
import { Clock, ChevronRight } from 'lucide-react';

interface AgingReportProps {
  transactions: Transaction[];
  mode: 'payables' | 'receivables' | 'all';
  onBucketClick: (dueDateStart?: string, dueDateEnd?: string) => void;
}

interface Bucket {
  label: string;
  count: number;
  amount: number;
  color: string;
  daysStart?: number;
  daysEnd?: number;
}

export const AgingReport: React.FC<AgingReportProps> = ({ transactions, mode, onBucketClick }) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const pendingTransactions = transactions.filter(t => 
    t.status !== 'Pago' && (t.status as string) !== 'Recebido' && !t.isExcluded
  );

  const calculateBuckets = () => {
    const buckets: Bucket[] = [
      { label: 'Em dia', count: 0, amount: 0, color: 'bg-emerald-500', daysStart: 0, daysEnd: 0 },
      { label: '1-30 dias', count: 0, amount: 0, color: 'bg-amber-500', daysStart: 1, daysEnd: 30 },
      { label: '31-60 dias', count: 0, amount: 0, color: 'bg-orange-500', daysStart: 31, daysEnd: 60 },
      { label: '61-90 dias', count: 0, amount: 0, color: 'bg-red-500', daysStart: 61, daysEnd: 90 },
      { label: '>90 dias', count: 0, amount: 0, color: 'bg-red-900', daysStart: 91, daysEnd: 9999 },
    ];

    pendingTransactions.forEach(t => {
      const dueDate = new Date(t.dueDate);
      dueDate.setHours(0, 0, 0, 0);
      
      const diffTime = today.getTime() - dueDate.getTime();
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      const value = mode === 'payables' ? t.valuePaid : (t.totalCobranca || t.valueReceived || 0);

      if (diffDays <= 0) {
        buckets[0].count++;
        buckets[0].amount += value;
      } else if (diffDays <= 30) {
        buckets[1].count++;
        buckets[1].amount += value;
      } else if (diffDays <= 60) {
        buckets[2].count++;
        buckets[2].amount += value;
      } else if (diffDays <= 90) {
        buckets[3].count++;
        buckets[3].amount += value;
      } else {
        buckets[4].count++;
        buckets[4].amount += value;
      }
    });

    return buckets;
  };

  const buckets = calculateBuckets();
  const maxAmount = Math.max(...buckets.map(b => b.amount), 1);
  const totalAmount = buckets.reduce((acc, b) => acc + b.amount, 0);

  const formatCurrency = (val: number) => 
    new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val);

  const handleBucketClick = (bucket: Bucket) => {
    if (bucket.label === 'Em dia') {
      onBucketClick(undefined, today.toISOString().split('T')[0]);
    } else {
      const end = new Date(today);
      const start = new Date(today);
      
      if (bucket.daysStart) start.setDate(today.getDate() - (bucket.daysEnd || 0));
      if (bucket.daysEnd) end.setDate(today.getDate() - (bucket.daysStart || 0));
      
      onBucketClick(
        start.toISOString().split('T')[0],
        end.toISOString().split('T')[0]
      );
    }
  };

  return (
    <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm p-6 transition-colors">
      <div className="flex items-center justify-between mb-6">
        <h3 className="font-bold text-slate-800 dark:text-white flex items-center gap-2">
          <Clock className="h-5 w-5 text-blue-500" />
          Aging - Composição do Saldo Pendente
        </h3>
        <span className="text-xs font-medium text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-800 px-2 py-1 rounded">
          Total: {formatCurrency(totalAmount)}
        </span>
      </div>

      <div className="space-y-4">
        {buckets.map((bucket, i) => (
          <div 
            key={i} 
            className="group cursor-pointer"
            onClick={() => handleBucketClick(bucket)}
          >
            <div className="flex justify-between items-end mb-1">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">{bucket.label}</span>
                <span className="text-[10px] text-slate-400 dark:text-slate-500">({bucket.count} registros)</span>
              </div>
              <div className="flex items-center gap-1 text-blue-600 dark:text-blue-400 opacity-0 group-hover:opacity-100 transition-opacity">
                <span className="text-sm font-bold">{formatCurrency(bucket.amount)}</span>
                <ChevronRight className="h-4 w-4" />
              </div>
            </div>
            <div className="h-2 w-full bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
              <div 
                className={`h-full ${bucket.color} transition-all duration-500`}
                style={{ width: `${(bucket.amount / maxAmount) * 100}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
