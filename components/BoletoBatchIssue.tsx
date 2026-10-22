import React, { useMemo, useRef, useState } from 'react';
import '../design-system/tokens.css';
import { CheckCircle2, AlertTriangle, Loader2, FileDown } from 'lucide-react';
import { Transaction } from '../types';
import { getOriginalAmount } from '../utils/transactionAmounts';
import { PossibleDuplicateScan } from '../utils/transactionTable';
import { BoletoIssueStatusMap, boletoRequest, boletoStatusLabel } from '../services/boletoIssueStatus';

const BATCH_LIMIT = 100;
type PreviewItem = {
  id: string;
  ready: boolean;
  state: string;
  block: '' | 'issued' | 'in-progress' | 'wix' | 'invalid';
  previewHash?: string;
  fields?: Record<string, string>;
  number?: string;
  error: string;
};
type Preview = { batchId: string; environment: string; enabled: boolean; totalCents: number; items: PreviewItem[] };
type Outcome = { state: string; number?: string; error?: string };

const digits = (value: unknown) => String(value ?? '').replace(/\D/g, '');
const clientKey = (value: unknown) => digits(value).replace(/^0+(?=\d)/, '');
const list = (value: string) => value.split(/[\s,;]+/).map((v) => v.trim()).filter(Boolean);
const currency = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const brDate = (d: string) => (d ? d.split('-').reverse().join('/') : '-');
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const blockLabels: Record<string, string> = {
  issued: '1ª via já emitida',
  'in-progress': 'Emissão anterior em andamento',
  wix: 'Trava de Fatura Wix',
  invalid: 'Corrigir antes de emitir',
};

// Emissão em lote: cada cobrança passa pelas mesmas travas da emissão individual
// (1ª via, duplicidade, Fatura Wix, CPF/CNPJ, revisão). O servidor emite uma a uma
// com o identificador de controle da cobrança, então repetir nunca reemite.
export default function BoletoBatchIssue({ rows, status, duplicates, onChanged }: {
  rows: Transaction[];
  status: BoletoIssueStatusMap;
  duplicates?: PossibleDuplicateScan;
  onChanged: () => void;
}) {
  const [filters, setFilters] = useState({ dueFrom: '', dueTo: '', clientNumber: '', cpfCnpj: '' });
  const [hideIssued, setHideIssued] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [preview, setPreview] = useState<Preview | null>(null);
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [progress, setProgress] = useState<Record<string, Outcome>>({});
  const stop = useRef(false);
  const running = useRef(false);

  const reasonFor = (row: Transaction): string => {
    const s = status[row.id];
    if (s && s.status !== 'none') return boletoStatusLabel(s);
    if (duplicates?.byTransactionId.has(row.id)) return 'Indício de duplicidade';
    if (!row.dueDate || row.dueDate < today()) return 'Vencimento passado';
    if (![11, 14].includes(digits(row.cpfCnpj).length)) return 'CPF/CNPJ ausente';
    return '';
  };

  const filtered = useMemo(() => {
    const numbers = list(filters.clientNumber).map(clientKey);
    const docs = list(filters.cpfCnpj).map(digits).filter(Boolean);
    return rows
      .filter((r) => (!filters.dueFrom || r.dueDate >= filters.dueFrom) && (!filters.dueTo || r.dueDate <= filters.dueTo))
      .filter((r) => !numbers.length || numbers.includes(clientKey(r.clientNumber)))
      .filter((r) => !docs.length || docs.some((d) => digits(r.cpfCnpj).startsWith(d)))
      .filter((r) => !hideIssued || !['issued', 'in-progress'].includes(status[r.id]?.status || ''))
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || String(a.client).localeCompare(String(b.client)));
  }, [rows, filters, hideIssued, status]);

  const hasFilter = Boolean(filters.dueFrom || filters.dueTo || filters.clientNumber.trim() || filters.cpfCnpj.trim());
  const selectable = filtered.filter((r) => !reasonFor(r));
  const chosen = rows.filter((r) => selected.has(r.id));
  const chosenTotal = chosen.reduce((n, r) => n + getOriginalAmount(r), 0);
  const locked = busy || Boolean(preview);

  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else if (next.size < BATCH_LIMIT) next.add(id);
    setSelected(next);
  };
  const selectAll = () => setSelected(new Set(selectable.slice(0, BATCH_LIMIT).map((r) => r.id)));

  async function review() {
    if (busy || !selected.size) return;
    setBusy(true);
    setError('');
    setProgress({});
    setChecked(false);
    try {
      const batchId = crypto.randomUUID();
      const result = await (await boletoRequest('batch/preview', { batchId, ids: [...selected], filters })).json();
      setPreview(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Revisão não concluída.');
    } finally {
      setBusy(false);
    }
  }

  async function issueAll() {
    if (!preview || running.current || !checked) return;
    running.current = true;
    stop.current = false;
    setBusy(true);
    setError('');
    const outcomes: Record<string, Outcome> = {};
    try {
      for (const item of preview.items.filter((i) => i.ready)) {
        if (stop.current) break;
        if (progress[item.id]?.state === 'issued') continue;
        outcomes[item.id] = { state: 'issuing' };
        setProgress({ ...progress, ...outcomes });
        try {
          const record = await (await boletoRequest(`items/${encodeURIComponent(item.id)}/issue`, { previewHash: item.previewHash, legacyChecked: true, batchId: preview.batchId })).json();
          outcomes[item.id] = { state: record.state, number: record.number, error: record.error };
        } catch (e) {
          outcomes[item.id] = { state: 'error', error: e instanceof Error ? e.message : 'Resultado não confirmado.' };
        }
        setProgress({ ...progress, ...outcomes });
      }
    } finally {
      running.current = false;
      setBusy(false);
      onChanged();
    }
  }

  async function downloadPdf(id: string, number?: string) {
    try {
      const response = await boletoRequest(`items/${encodeURIComponent(id)}/pdf`);
      const url = URL.createObjectURL(await response.blob());
      const a = document.createElement('a');
      a.href = url;
      a.download = `boleto-${number || id}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'PDF indisponível.');
    }
  }

  const byId = new Map(rows.map((r) => [r.id, r]));
  const ready = preview?.items.filter((i) => i.ready) || [];
  const blocked = preview?.items.filter((i) => !i.ready) || [];
  const done = Object.values(progress).filter((o) => o.state !== 'issuing').length;
  const issuedCount = Object.values(progress).filter((o) => o.state === 'issued').length;
  const finished = preview && ready.length > 0 && done === ready.length && !busy;

  return (
    <div className="sp-ui space-y-4" style={{ background: 'transparent' }}>
      {!preview && (
        <>
          <fieldset className="grid grid-cols-1 sm:grid-cols-2 gap-3" disabled={locked}>
            <legend className="text-sm sp-muted mb-2">Filtre por vencimento, N.Cliente ou CPF/CNPJ. Para vários clientes, separe por vírgula.</legend>
            <label className="text-sm">Vencimento de
              <input type="date" className="sp-field" value={filters.dueFrom} onChange={(e) => setFilters({ ...filters, dueFrom: e.target.value })} />
            </label>
            <label className="text-sm">Vencimento até
              <input type="date" className="sp-field" value={filters.dueTo} onChange={(e) => setFilters({ ...filters, dueTo: e.target.value })} />
            </label>
            <label className="text-sm">N.Cliente
              <input className="sp-field" inputMode="numeric" placeholder="Ex.: 170, 52" value={filters.clientNumber} onChange={(e) => setFilters({ ...filters, clientNumber: e.target.value })} />
            </label>
            <label className="text-sm">CPF/CNPJ
              <input className="sp-field" inputMode="numeric" placeholder="Somente números" value={filters.cpfCnpj} onChange={(e) => setFilters({ ...filters, cpfCnpj: e.target.value })} />
            </label>
          </fieldset>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={hideIssued} onChange={(e) => setHideIssued(e.target.checked)} />
            Ocultar cobranças com 1ª via já emitida
          </label>
          {!hasFilter ? (
            <p className="text-sm sp-muted">Informe pelo menos um filtro para listar as cobranças.</p>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm">{filtered.length} cobrança(s) no filtro · {selectable.length} disponível(is) para emissão</p>
                <div className="flex gap-2">
                  <button type="button" className="sp-button" onClick={selectAll} disabled={!selectable.length}>Selecionar disponíveis{selectable.length > BATCH_LIMIT ? ` (máx. ${BATCH_LIMIT})` : ''}</button>
                  <button type="button" className="sp-button" onClick={() => setSelected(new Set())} disabled={!selected.size}>Limpar seleção</button>
                </div>
              </div>
              <div className="overflow-auto max-h-[45vh] border rounded" style={{ borderColor: 'var(--sp-border)' }}>
                <table className="min-w-full text-sm">
                  <thead className="sticky top-0" style={{ background: 'var(--sp-surface)' }}>
                    <tr className="text-left">
                      <th className="p-2"><span className="sr-only">Selecionar</span></th>
                      <th className="p-2">Venc.</th>
                      <th className="p-2">N.Cliente</th>
                      <th className="p-2">Cliente</th>
                      <th className="p-2">CPF/CNPJ</th>
                      <th className="p-2 text-right">Valor</th>
                      <th className="p-2">Situação do boleto</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((r) => {
                      const reason = reasonFor(r);
                      const issued = ['issued', 'in-progress'].includes(status[r.id]?.status || '');
                      return (
                        <tr key={r.id} className="border-t" style={{ borderColor: 'var(--sp-border)' }}>
                          <td className="p-2">
                            <input type="checkbox" aria-label={`Selecionar ${r.client}`} checked={selected.has(r.id)} disabled={Boolean(reason)} onChange={() => toggle(r.id)} />
                          </td>
                          <td className="p-2 whitespace-nowrap tabular-nums">{brDate(r.dueDate)}</td>
                          <td className="p-2 tabular-nums">{r.clientNumber ?? '-'}</td>
                          <td className="p-2">{r.client}</td>
                          <td className="p-2 tabular-nums">{r.cpfCnpj || '-'}</td>
                          <td className="p-2 text-right tabular-nums">{currency(getOriginalAmount(r))}</td>
                          <td className="p-2">
                            {issued ? (
                              <span className="inline-flex items-center gap-1 font-semibold" style={{ color: status[r.id]?.status === 'issued' ? 'var(--sp-success)' : 'var(--sp-warning)' }}>
                                <CheckCircle2 className="h-4 w-4" aria-hidden="true" />{reason}
                              </span>
                            ) : reason ? (
                              <span className="inline-flex items-center gap-1" style={{ color: 'var(--sp-warning)' }}>
                                <AlertTriangle className="h-4 w-4" aria-hidden="true" />{reason}
                              </span>
                            ) : (
                              <span className="sp-muted">Não emitido</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-semibold">{selected.size} selecionada(s) · {currency(chosenTotal)}</p>
            <button type="button" className="sp-button sp-button-primary" disabled={busy || !selected.size} onClick={review}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
              Revisar {selected.size} cobrança(s)
            </button>
          </div>
        </>
      )}

      {error && <p role="alert" className="p-3 rounded" style={{ color: 'var(--sp-danger)', border: '1px solid var(--sp-danger)' }}>{error}</p>}

      {preview && (
        <section className="space-y-3" aria-label="Revisão do lote">
          <p className="font-semibold">
            {preview.environment === 'production' ? 'PRODUÇÃO — boletos reais, sujeitos a tarifas' : 'SANDBOX — boletos de teste, sem valor'}
          </p>
          {!preview.enabled && <p style={{ color: 'var(--sp-warning)' }}>Emissão aguardando habilitação e credenciais no servidor.</p>}
          <div className="sp-card" style={{ padding: 'var(--sp-space-4)' }}>
            <p className="font-semibold">{ready.length} prontos para emissão · Total {currency(preview.totalCents / 100)}</p>
            {blocked.length > 0 && <p className="text-sm">{blocked.length} não serão emitidos (motivos abaixo).</p>}
          </div>
          <div className="overflow-auto max-h-[40vh] border rounded" style={{ borderColor: 'var(--sp-border)' }}>
            <table className="min-w-full text-sm">
              <thead className="sticky top-0" style={{ background: 'var(--sp-surface)' }}>
                <tr className="text-left">
                  <th className="p-2">Cliente</th>
                  <th className="p-2">Venc.</th>
                  <th className="p-2 text-right">Valor</th>
                  <th className="p-2">Resultado</th>
                </tr>
              </thead>
              <tbody>
                {preview.items.map((item) => {
                  const row = byId.get(item.id);
                  const outcome = progress[item.id];
                  return (
                    <tr key={item.id} className="border-t" style={{ borderColor: 'var(--sp-border)' }}>
                      <td className="p-2">{item.fields?.['boleto.pagador.nome'] || row?.client || item.id}</td>
                      <td className="p-2 whitespace-nowrap tabular-nums">{brDate(item.fields?.['boleto.vencimento'] || row?.dueDate || '')}</td>
                      <td className="p-2 text-right tabular-nums">{currency(item.fields ? Number(item.fields['boleto.valor']) : row ? getOriginalAmount(row) : 0)}</td>
                      <td className="p-2">
                        {!item.ready ? (
                          <span style={{ color: item.block === 'issued' ? 'var(--sp-success)' : 'var(--sp-warning)' }}>
                            {blockLabels[item.block] || 'Bloqueado'}: {item.error}
                            {item.block === 'invalid' && /endere/i.test(item.error) ? ' Preencha o endereço na emissão individual.' : ''}
                            {item.block === 'wix' ? ' Exceção só pelo master, na emissão individual.' : ''}
                          </span>
                        ) : !outcome ? (
                          <span className="sp-muted">Pronto</span>
                        ) : outcome.state === 'issuing' ? (
                          <span className="inline-flex items-center gap-1"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />Emitindo…</span>
                        ) : outcome.state === 'issued' ? (
                          <span className="inline-flex items-center gap-2" style={{ color: 'var(--sp-success)' }}>
                            <CheckCircle2 className="h-4 w-4" aria-hidden="true" />Emitido{outcome.number ? ` nº ${outcome.number}` : ''}
                            <button type="button" className="sp-button" onClick={() => downloadPdf(item.id, outcome.number)}><FileDown className="h-4 w-4" aria-hidden="true" />PDF</button>
                          </span>
                        ) : (
                          <span style={{ color: 'var(--sp-danger)' }}>
                            {outcome.state === 'rejected' ? 'Recusado' : outcome.state === 'unknown' || outcome.state === 'issuing' ? 'Não confirmado' : 'Não emitido'}: {outcome.error}
                            {outcome.state === 'unknown' ? ' Use Recuperar tentativa na emissão individual; não emita de novo.' : ''}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {!finished && ready.length > 0 && (
            <div className="space-y-3">
              <label className="flex gap-2 text-sm">
                <input type="checkbox" checked={checked} disabled={busy} onChange={(e) => setChecked(e.target.checked)} />
                Conferi no Boleto Cloud que estas {ready.length} cobranças não foram emitidas anteriormente pelo painel ou por importação CSV.
              </label>
              <div className="flex flex-wrap gap-2">
                <button type="button" className="sp-button sp-button-primary" disabled={busy || !checked || !preview.enabled} onClick={issueAll}>
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
                  {preview.environment === 'production' ? `Confirmar emissão real de ${ready.length} boleto(s) · ${currency(preview.totalCents / 100)}` : `Emitir ${ready.length} no Sandbox`}
                </button>
                {busy && <button type="button" className="sp-button" onClick={() => { stop.current = true; }}>Parar após o atual</button>}
              </div>
              {busy && <p role="status" className="text-sm">{done} de {ready.length} processados. Não feche esta janela.</p>}
            </div>
          )}
          {(finished || (!busy && ready.length === 0)) && (
            <div className="space-y-2">
              {finished && <p className="font-semibold" role="status">{issuedCount} de {ready.length} emitido(s). Emitir não marca a cobrança como paga.</p>}
              <button type="button" className="sp-button" onClick={() => { setPreview(null); setSelected(new Set()); setProgress({}); setChecked(false); }}>Nova seleção</button>
            </div>
          )}
          {!busy && !finished && (
            <button type="button" className="sp-button" onClick={() => { setPreview(null); setChecked(false); setProgress({}); }}>Voltar à seleção</button>
          )}
        </section>
      )}
    </div>
  );
}
