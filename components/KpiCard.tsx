import React from 'react';
import { LucideIcon } from 'lucide-react';

interface KpiCardProps {
  title: string;
  value: number;
  icon: LucideIcon;
  trend?: string;
  color: 'blue' | 'green' | 'red';
}

const KpiCard: React.FC<KpiCardProps> = ({ title, value, icon: Icon, color }) => {
  const formatCurrency = (val: number) => {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val);
  };

  const colorStyles = {
    blue: 'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400',
    green: 'bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400',
    red: 'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400',
  };

  const valueColors = {
      blue: 'text-slate-900 dark:text-white',
      green: 'text-green-600 dark:text-green-400',
      red: 'text-red-600 dark:text-red-400'
  }

  return (
    <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm p-6 border border-slate-100 dark:border-slate-800 flex items-start space-x-4 transition-colors">
      <div className={`p-3 rounded-lg ${colorStyles[color]}`}>
        <Icon className="h-6 w-6" />
      </div>
      <div>
        <p className="text-sm font-medium text-slate-500 dark:text-slate-400">{title}</p>
        <h3 className={`text-2xl font-bold mt-1 ${valueColors[color]}`}>
          {formatCurrency(value)}
        </h3>
      </div>
    </div>
  );
};

export default KpiCard;