import { useEffect, useState } from 'react';
import { auth } from '../firebase';

// Situação da 1ª via de boleto por lançamento, conferida no servidor: emissão
// pelo app, boleto do painel/CSV com mesmo pagador, vencimento e valor, ou
// lançamento já vinculado a um boleto.
export type BoletoIssueStatus = {
  status: 'issued' | 'in-progress' | 'none';
  origin: '' | 'app' | 'panel' | 'linked';
  number: string;
};
export type BoletoIssueStatusMap = Record<string, BoletoIssueStatus>;

export async function boletoRequest(path: string, body?: unknown): Promise<Response> {
  const user = auth.currentUser;
  if (!user) throw new Error('Entre novamente para continuar.');
  const response = await fetch(`/api/boleto-cloud/${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { Authorization: `Bearer ${await user.getIdToken()}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    const result = await response.json().catch(() => ({}));
    throw Object.assign(new Error(result.error || 'Não foi possível concluir.'), { details: result, status: response.status });
  }
  return response;
}

export async function fetchBoletoIssueStatus(ids: string[]): Promise<{ items: BoletoIssueStatusMap; historyAvailable: boolean }> {
  const items: BoletoIssueStatusMap = {};
  let historyAvailable = true;
  for (let i = 0; i < ids.length; i += 1000) {
    const result = await (await boletoRequest('batch/status', { ids: ids.slice(i, i + 1000) })).json();
    Object.assign(items, result.items);
    historyAvailable = historyAvailable && result.historyAvailable !== false;
  }
  return { items, historyAvailable };
}

export function boletoStatusLabel(status?: BoletoIssueStatus): string {
  if (!status || status.status === 'none') return '';
  if (status.status === 'in-progress') return 'Emissão em andamento';
  const origin = status.origin === 'panel' ? ' (painel/CSV)' : status.origin === 'linked' ? ' (vinculado)' : '';
  return `1ª via emitida${status.number ? ` nº ${status.number}` : ''}${origin}`;
}

export function useBoletoIssueStatus(ids: string[], enabled: boolean, refreshKey = 0) {
  const [state, setState] = useState<{ items: BoletoIssueStatusMap; historyAvailable: boolean; error: string; loading: boolean }>({ items: {}, historyAvailable: true, error: '', loading: false });
  const key = enabled ? [...ids].sort().join('|') : '';
  useEffect(() => {
    if (!key) return;
    let current = true;
    setState((s) => ({ ...s, loading: true, error: '' }));
    fetchBoletoIssueStatus(key.split('|'))
      .then((result) => current && setState({ ...result, error: '', loading: false }))
      .catch((e) => current && setState((s) => ({ ...s, loading: false, error: e instanceof Error ? e.message : 'Situação dos boletos indisponível.' })));
    return () => { current = false; };
  }, [key, refreshKey]);
  return state;
}
