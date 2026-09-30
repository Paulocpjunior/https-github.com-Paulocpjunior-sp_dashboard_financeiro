import { auth } from '../firebase';
import { FilterState } from '../types';

export type FinancialAIMode = 'filter' | 'analysis' | 'forecast';
export type FinancialAIScope = { kind: 'all' } | { kind: 'selection'; transactionIds: string[] };
export interface FinancialAIStatus { available: boolean; languageModelAvailable: boolean; readOnly: boolean }
export interface FinancialAIResponse { answer: string; filters?: Partial<FilterState>; interpretation: string; readOnly: boolean; retrievedAt: string }
async function request<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const user = auth.currentUser;
  if (!user) throw new Error('Entre novamente para consultar o financeiro.');
  const response = await fetch(`/api/financial-ai/${path}`, {
    method: body ? 'POST' : 'GET', cache: 'no-store', signal,
    headers: { Authorization: `Bearer ${await user.getIdToken()}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('Consultor Financeiro ainda não disponível neste ambiente.');
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Não foi possível consultar o financeiro.');
  if (auth.currentUser?.uid !== user.uid) throw new Error('A sessão mudou. Entre novamente.');
  return result;
}
export const FinancialAIService = {
  status: (signal?: AbortSignal) => request<FinancialAIStatus>('status', undefined, signal),
  query: (query: string, mode: FinancialAIMode, scope: FinancialAIScope, signal?: AbortSignal) => request<FinancialAIResponse>('query', { query, mode, scope }, signal),
  detectMode: (query: string): FinancialAIMode => {
    const q = query.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    if (/previsao|proje[cç]|projetar|forecast|futuro/.test(q)) return 'forecast';
    if (/^(mostrar|mostre|filtrar|filtre|listar|liste)|contas a (pagar|receber)/.test(q) && !/resumo|analise|por que/.test(q)) return 'filter';
    return 'analysis';
  },
};
