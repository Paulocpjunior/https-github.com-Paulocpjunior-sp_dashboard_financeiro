import { FilterState } from '../types';

export const filtersForDashboardView = (previous: FilterState, mode: 'general' | 'payables' | 'receivables'): FilterState => {
  // Use o mesmo intervalo que estava ativo, mesmo quando ele é personalizado
  // ou tem somente uma das datas preenchida.
  const [start, end] = previous.dueDateStart || previous.dueDateEnd
    ? [previous.dueDateStart, previous.dueDateEnd]
    : previous.paymentDateStart || previous.paymentDateEnd || previous.receiptDateStart || previous.receiptDateEnd
      ? [previous.paymentDateStart || previous.receiptDateStart, previous.paymentDateEnd || previous.receiptDateEnd]
      : [previous.startDate, previous.endDate];
  return {
    ...previous,
    type: '',
    movement: mode === 'payables' ? 'Saída' : mode === 'receivables' ? 'Entrada' : '',
    status: mode === 'general' ? '' : 'Pendente',
    startDate: mode === 'general' ? start : '',
    endDate: mode === 'general' ? end : '',
    dueDateStart: mode === 'general' ? '' : start,
    dueDateEnd: mode === 'general' ? '' : end,
    paymentDateStart: '', paymentDateEnd: '', receiptDateStart: '', receiptDateEnd: '',
  };
};
