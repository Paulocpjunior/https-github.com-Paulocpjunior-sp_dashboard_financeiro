import type { ChecklistRecord } from '../services/checklistReviewService';

export type ChecklistEvent = 'entrada' | 'saida' | 'alteracao' | 'suspensao' | 'pendente';
const normalize = (value: string | null) => (value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toUpperCase().replace(/\s+/g, ' ');

// Valores do STATUS do Check List Atual 2026. Datas e notas não escolhem o evento.
export function checklistEvent(status: string | null): ChecklistEvent {
  switch (normalize(status)) {
    case 'CLIENTE NOVO': return 'entrada';
    case 'CLIENTE SAIDA':
    case 'ENCERRAMENTO CNPJ': return 'saida';
    case 'CLIENTE ALTERACAO': return 'alteracao';
    case 'CLIENTE SUSPENSO': return 'suspensao';
    default: return 'pendente';
  }
}

export const checklistEventLabels: Record<ChecklistEvent, string> = {
  entrada: 'Entrada', saida: 'Saída', alteracao: 'Alteração', suspensao: 'Suspensão', pendente: 'STATUS a conferir',
};
export const checklistEventGuidance: Record<ChecklistEvent, string> = {
  entrada: 'Conferir início da responsabilidade, honorários e primeira cobrança nas observações.',
  saida: 'Conferir término, motivo, evidência e última cobrança devida. STATUS de saída não aprova dispensa sozinho.',
  alteracao: 'Conferir o que mudou e a vigência nas observações. Preservar as obrigações anteriores.',
  suspensao: 'Conferir motivo, vigência e condição contratual. Suspensão não elimina saldos nem aprova dispensa sozinha.',
  pendente: 'STATUS ausente ou não reconhecido: confirmar o evento antes de interpretar datas ou cobrança.',
};
export function checklistStatusDates(row: Pick<ChecklistRecord, 'status' | 'entryDate' | 'exitDate' | 'suspensionDate'>) {
  const event = checklistEvent(row.status);
  return {
    event,
    // Cadastro não é a data de início da responsabilidade contratual.
    registrationDate: event === 'entrada' ? row.entryDate : null,
    exitDate: event === 'saida' ? row.exitDate : null,
    suspensionDate: event === 'suspensao' ? row.suspensionDate : null,
    contractValidated: false as const,
  };
}
