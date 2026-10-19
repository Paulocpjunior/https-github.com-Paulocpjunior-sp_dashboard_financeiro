import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArrowUpRight, CheckCircle2, Download, FileBarChart, Loader2, LockKeyhole, RefreshCw, Upload, Wallet, X } from 'lucide-react';
import {
  fetchWixTreasuryReport,
  WIX_SITUATION_LABELS,
  wixReportToCsv,
  WixSaleSituation,
  WixTreasuryReport,
} from '../services/wixTreasuryService';
import { applyWixFunds, parseWixFundsCsv, WixFundsPayable } from '../services/wixFundsReport';

interface WixTreasuryModalProps {
  open: boolean;
  onClose: () => void;
}

type WixTreasuryTab = 'resgate' | 'relatorio';

export const WIX_SP_CONTABIL_TRANSFERS_URL = 'https://manage.wix.com/wix-payments/br/dashboard/1e7a5d33-26d6-4f39-8f4c-be9452b1eb10/002/transfer-history';

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const formatCents = (cents: number | null | undefined) => (cents === null || cents === undefined ? '—' : brl.format(cents / 100));
const formatDate = (value: string | null | undefined) => {
  const iso = (value || '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '—';
};

const currentMonth = () => {
  const today = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const first = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-01`;
  const last = new Date(today.getFullYear(), today.getMonth() + 1, 0);
  return { start: first, end: `${last.getFullYear()}-${pad(last.getMonth() + 1)}-${pad(last.getDate())}` };
};

const SITUATION_STYLES: Record<WixSaleSituation, string> = {
  resgatado: 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300',
  liberado: 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300',
  disponivel: 'bg-blue-50 text-blue-800 dark:bg-blue-950/30 dark:text-blue-300',
  em_liberacao: 'bg-amber-50 text-amber-800 dark:bg-amber-950/30 dark:text-amber-300',
  aguardando_cliente: 'bg-amber-50 text-amber-800 dark:bg-amber-950/30 dark:text-amber-300',
  fora_wix_payments: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  cancelado: 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400',
  pago: 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300',
  conferir: 'bg-red-50 text-red-800 dark:bg-red-950/30 dark:text-red-300',
};

const SummaryCard: React.FC<{ label: string; value: string; hint?: string }> = ({ label, value, hint }) => (
  <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</p>
    <p className="mt-1 text-lg font-semibold tabular-nums text-slate-900 dark:text-white">{value}</p>
    {hint && <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{hint}</p>}
  </div>
);

const WixSalesReport: React.FC = () => {
  const [range, setRange] = useState(currentMonth);
  const [baseReport, setReport] = useState<WixTreasuryReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [funds, setFunds] = useState<{ payables: WixFundsPayable[]; fileName: string } | null>(null);
  const [fundsError, setFundsError] = useState('');
  const funded = useMemo(() => (baseReport && funds ? applyWixFunds(baseReport, funds.payables, funds.fileName) : null), [baseReport, funds]);
  const report = funded?.report || baseReport;
  const fundsSummary = funded?.summary || null;

  // O arquivo é lido só no navegador: nada é enviado ao servidor nem gravado no Financeiro.
  const importFunds = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setFundsError('');
    try {
      setFunds({ payables: parseWixFundsCsv(await file.text()), fileName: file.name });
    } catch (err) {
      setFunds(null);
      setFundsError(err instanceof Error ? err.message : 'Não foi possível ler o relatório de pagamentos da Wix.');
    }
  };

  const generate = async () => {
    if (loading) return;
    setLoading(true);
    setError('');
    try {
      setReport(await fetchWixTreasuryReport(range.start, range.end));
    } catch (err) {
      setReport(null);
      setError(err instanceof Error ? err.message : 'Não foi possível gerar o relatório Wix.');
    } finally {
      setLoading(false);
    }
  };

  const exportCsv = () => {
    if (!report) return;
    const blob = new Blob([wixReportToCsv(report)], { type: 'text/csv;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `tesouraria-wix-${report.period.start}-a-${report.period.end}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  };

  const totals = report?.totals;
  const rows = report?.rows || [];

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <label className="block text-sm">
          <span className="font-medium text-slate-700 dark:text-slate-300">De</span>
          <input type="date" value={range.start} max={range.end} onChange={event => setRange(prev => ({ ...prev, start: event.target.value }))}
            className="mt-1 block min-h-[44px] w-full rounded-lg border border-slate-300 bg-white px-3 text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-white" />
        </label>
        <label className="block text-sm">
          <span className="font-medium text-slate-700 dark:text-slate-300">Até</span>
          <input type="date" value={range.end} min={range.start} onChange={event => setRange(prev => ({ ...prev, end: event.target.value }))}
            className="mt-1 block min-h-[44px] w-full rounded-lg border border-slate-300 bg-white px-3 text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-white" />
        </label>
        <button type="button" onClick={generate} disabled={loading || !range.start || !range.end}
          className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg bg-blue-700 px-4 text-sm font-semibold text-white shadow-sm hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-50">
          {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <RefreshCw className="h-4 w-4" aria-hidden="true" />}
          {loading ? 'Consultando a Wix…' : 'Gerar relatório'}
        </button>
        {report?.configured && rows.length > 0 && (
          <button type="button" onClick={exportCsv}
            className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg border border-slate-300 px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800">
            <Download className="h-4 w-4" aria-hidden="true" />
            Exportar CSV
          </button>
        )}
        {report?.configured && (
          <label className="inline-flex min-h-[44px] cursor-pointer items-center justify-center gap-2 rounded-lg border border-slate-300 px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 focus-within:ring-2 focus-within:ring-blue-600 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800">
            <Upload className="h-4 w-4" aria-hidden="true" />
            {funds ? 'Trocar relatório de pagamentos' : 'Importar relatório de pagamentos'}
            <input type="file" accept=".csv,text/csv" onChange={importFunds} className="sr-only" />
          </label>
        )}
      </div>

      {fundsError && (
        <div role="alert" className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900/60 dark:bg-red-950/20 dark:text-red-200">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
          <p>{fundsError}</p>
        </div>
      )}

      {error && (
        <div role="alert" className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900/60 dark:bg-red-950/20 dark:text-red-200">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
          <p>{error}</p>
        </div>
      )}

      {!report && !error && !loading && (
        <p className="rounded-xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
          Escolha o período e gere o relatório para confrontar as vendas da loja Wix com o que já foi resgatado e o que ainda está a receber.
        </p>
      )}

      {report && !report.configured && (
        <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-200">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
          <p>Integração Wix ainda não ligada no servidor. Falta cadastrar: <strong>{(report.missing || []).join(', ')}</strong>.</p>
        </div>
      )}

      {report?.configured && totals && (
        <>
          {fundsSummary && (
            <div className="flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900 dark:border-emerald-900/60 dark:bg-emerald-950/20 dark:text-emerald-200">
              <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
              <p>
                Confrontado com <strong>{fundsSummary.fileName}</strong>: {fundsSummary.payables} parcela(s) de {formatDate(fundsSummary.fileStart)} a {formatDate(fundsSummary.fileEnd)}, {fundsSummary.matchedOrders} pedido(s) do período encontrados.
                {!fundsSummary.coversPeriod && ' O arquivo não cobre todo o período escolhido: exporte de novo com as datas certas.'}
              </p>
            </div>
          )}
          {!report.paymentsEnabled && !fundsSummary && (
            <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-200">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
              <p>Mostrando só as vendas. Para confrontar com o que a Wix já liberou e o que falta receber, exporte em Wix Pagamentos &gt; <strong>Relatório de pagamentos</strong> e use <strong>Importar relatório de pagamentos</strong>.</p>
            </div>
          )}
          {report.truncated && (
            <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-200">
              O período tem mais registros do que o limite de uma consulta. Reduza o período para ver todos.
            </p>
          )}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <SummaryCard label="Vendido" value={formatCents(totals.soldCents)} hint={`${totals.orders} pedido(s)${totals.canceled ? `, ${totals.canceled} cancelado(s) fora da soma` : ''}`} />
            {fundsSummary ? (
              <>
                <SummaryCard label="Liberado pela Wix" value={formatCents(fundsSummary.releasedCents)} hint="Líquido das vendas do período já liberado para a conta" />
                <SummaryCard label="A receber da Wix" value={formatCents(fundsSummary.pendingCents)} hint="Parcelas das vendas do período ainda em liberação" />
              </>
            ) : (
              <>
                <SummaryCard label="Resgatado" value={formatCents(totals.withdrawnCents)} hint="Líquido das vendas do período já transferido ao banco" />
                <SummaryCard label="A receber da Wix" value={formatCents(totals.pendingReleaseCents === null || totals.availableCents === null ? null : totals.pendingReleaseCents + totals.availableCents)}
                  hint={`Em liberação ${formatCents(totals.pendingReleaseCents)} · Disponível ${formatCents(totals.availableCents)}`} />
              </>
            )}
            <SummaryCard label="A receber de clientes" value={formatCents(totals.awaitingCustomersCents)} hint="Pedidos ainda não pagos" />
            <SummaryCard label="Pago pelos clientes" value={formatCents(totals.paidByCustomersCents)} />
            <SummaryCard label="Taxas Wix Payments" value={formatCents(totals.feesCents)} />
            <SummaryCard label="Pago fora do Wix Payments" value={formatCents(totals.outsideWixPaymentsCents)} hint={fundsSummary ? 'Pedidos pagos sem parcela no relatório da Wix' : 'Conferir no banco ou no pedido'} />
            <SummaryCard label="Não lançados no Financeiro" value={String(totals.notInFinance)} hint="Pedidos pagos sem lançamento Wix" />
          </div>

          {fundsSummary && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <SummaryCard label="Liberado no período" value={formatCents(fundsSummary.releasedInPeriodCents)} hint="Tudo que a Wix liberou nestas datas, de qualquer venda" />
              <SummaryCard label="A receber da Wix hoje" value={formatCents(fundsSummary.pendingAllCents)}
                hint={fundsSummary.nextRelease ? `${fundsSummary.pendingAllCount} parcela(s) · próxima ${formatDate(fundsSummary.nextRelease.date)}: ${formatCents(fundsSummary.nextRelease.cents)}` : 'Nenhuma parcela pendente'} />
              <SummaryCard label="Recebimentos sem pedido da loja" value={formatCents(fundsSummary.noOrderInPeriodCents)} hint={`${fundsSummary.noOrderInPeriodCount} parcela(s) de faturas ou links de pagamento no período`} />
              <SummaryCard label="Estornos e chargebacks" value={formatCents(fundsSummary.reversalsInPeriodCents)} hint={`${fundsSummary.reversalsInPeriodCount} no período`} />
            </div>
          )}

          {report.paymentsEnabled && !fundsSummary && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <SummaryCard label="Saldo Wix em liberação hoje" value={formatCents(report.balance?.pendingCents)} />
              <SummaryCard label="Saldo disponível para resgate hoje" value={formatCents(report.balance?.availableCents)} />
              <SummaryCard label="Resgates enviados no período" value={formatCents(totals.payoutsSentCents)}
                hint={`${(report.payouts || []).length} transferência(s)${totals.payoutsFailed ? `, ${totals.payoutsFailed} com falha` : ''}`} />
            </div>
          )}

          <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
            <table className="min-w-full text-sm">
              <caption className="sr-only">Vendas Wix no período e situação do valor</caption>
              <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:bg-slate-800/60 dark:text-slate-400">
                <tr>
                  <th scope="col" className="px-3 py-2">Pedido</th>
                  <th scope="col" className="px-3 py-2">Data</th>
                  <th scope="col" className="px-3 py-2">Cliente</th>
                  <th scope="col" className="px-3 py-2 text-right">Vendido</th>
                  <th scope="col" className="px-3 py-2 text-right">Líquido Wix</th>
                  <th scope="col" className="px-3 py-2">Situação</th>
                  <th scope="col" className="px-3 py-2">Financeiro</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {rows.length === 0 && (
                  <tr><td colSpan={7} className="px-3 py-6 text-center text-slate-500 dark:text-slate-400">Nenhuma venda na loja Wix neste período.</td></tr>
                )}
                {rows.map(row => (
                  <tr key={row.id} className="text-slate-700 dark:text-slate-300">
                    <td className="whitespace-nowrap px-3 py-2 font-medium">{row.number ? `#${row.number}` : '—'}</td>
                    <td className="whitespace-nowrap px-3 py-2 tabular-nums">{formatDate(row.purchasedDate || row.createdDate)}</td>
                    <td className="px-3 py-2">
                      <span className="block">{row.buyer}</span>
                      {row.items.length > 0 && <span className="block text-xs text-slate-500 dark:text-slate-400">{row.items.join(', ')}</span>}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{formatCents(row.totalCents)}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{formatCents(row.netCents)}</td>
                    <td className="px-3 py-2">
                      <span className={`inline-block rounded-md px-2 py-0.5 text-xs font-semibold ${SITUATION_STYLES[row.situation]}`}>{WIX_SITUATION_LABELS[row.situation]}</span>
                      {row.situation === 'em_liberacao' && row.availableOn && <span className="block text-xs text-slate-500 dark:text-slate-400">{row.pendingCents !== undefined ? `${formatCents(row.pendingCents)} a receber · próxima em ${formatDate(row.availableOn)}` : `Libera em ${formatDate(row.availableOn)}`}</span>}
                      {row.situation === 'liberado' && row.payoutDate && <span className="block text-xs text-slate-500 dark:text-slate-400">Liberado em {formatDate(row.payoutDate)}{row.installments && row.installments > 1 ? ` · ${row.installments} parcelas` : ''}</span>}
                      {row.situation === 'resgatado' && row.payoutDate && <span className="block text-xs text-slate-500 dark:text-slate-400">Resgate em {formatDate(row.payoutDate)}</span>}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2">{row.inFinance ? 'Lançado' : row.situation === 'cancelado' || row.situation === 'aguardando_cliente' ? '—' : 'Não lançado'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {(report.otherRecords || []).length > 0 && (
            <p className="text-sm text-slate-600 dark:text-slate-400">
              Também entraram no saldo Wix Payments {report.otherRecords!.length} movimento(s) sem pedido da loja neste período (faturas Wix, estornos ou ajustes), somando {formatCents(totals.otherRecordsNetCents)} líquidos.
            </p>
          )}
          <p className="text-xs text-slate-500 dark:text-slate-400">Consulta somente leitura à Wix em {formatDate(report.generatedAt)}. {fundsSummary ? 'O relatório de pagamentos é lido só neste navegador. ' : ''}Nenhum valor ou lançamento é alterado.</p>
        </>
      )}
    </div>
  );
};

export const WixTreasuryModal: React.FC<WixTreasuryModalProps> = ({ open, onClose }) => {
  const [tab, setTab] = useState<WixTreasuryTab>('resgate');

  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const openWixTreasury = () => {
    window.open(WIX_SP_CONTABIL_TRANSFERS_URL, '_blank', 'noopener,noreferrer');
  };

  const tabClass = (value: WixTreasuryTab) => `inline-flex min-h-[44px] items-center gap-2 border-b-2 px-3 text-sm font-semibold ${tab === value
    ? 'border-blue-700 text-blue-700 dark:border-blue-300 dark:text-blue-300'
    : 'border-transparent text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'}`;

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/65 p-4 print:hidden"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="wix-treasury-title"
        className={`flex max-h-[calc(100vh-2rem)] w-full flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900 ${tab === 'relatorio' ? 'max-w-6xl' : 'max-w-xl'}`}
      >
        <div className="flex items-start justify-between border-b border-slate-200 px-6 py-5 dark:border-slate-800">
          <div className="flex items-start gap-3">
            <div className="rounded-xl bg-blue-100 p-2.5 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
              <Wallet className="h-6 w-6" />
            </div>
            <div>
              <h2 id="wix-treasury-title" className="text-xl font-bold text-slate-900 dark:text-white">Tesouraria Wix</h2>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                {tab === 'resgate' ? 'Acesso compartilhado à página oficial de transferências.' : 'Vendas da loja Wix confrontadas com resgates e valores a receber.'}
              </p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200" aria-label="Fechar modal">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div role="tablist" aria-label="Seções da Tesouraria Wix" className="flex gap-2 border-b border-slate-200 px-6 dark:border-slate-800">
          <button type="button" role="tab" aria-selected={tab === 'resgate'} onClick={() => setTab('resgate')} className={tabClass('resgate')}>
            <Wallet className="h-4 w-4" aria-hidden="true" />
            Resgate
          </button>
          <button type="button" role="tab" aria-selected={tab === 'relatorio'} onClick={() => setTab('relatorio')} className={tabClass('relatorio')}>
            <FileBarChart className="h-4 w-4" aria-hidden="true" />
            Relatório de vendas
          </button>
        </div>

        {tab === 'resgate' ? (
          <div className="space-y-5 overflow-y-auto px-6 py-6">
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-900/60 dark:bg-emerald-950/20">
              <div className="flex items-start gap-3">
                <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-400" />
                <div>
                  <p className="font-semibold text-emerald-900 dark:text-emerald-200">Disponível em qualquer computador</p>
                  <p className="mt-1 text-sm leading-6 text-emerald-800 dark:text-emerald-300">O botão abre a conta <strong>SPcontabil</strong> diretamente na página de transferências da Wix. Não é necessário instalar automação local.</p>
                </div>
              </div>
            </div>

            <ol className="space-y-3 text-sm text-slate-700 dark:text-slate-300">
              <li className="flex gap-3"><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-bold dark:bg-slate-800">1</span><span>Acesse a sessão compartilhada da Wix no seu navegador.</span></li>
              <li className="flex gap-3"><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-bold dark:bg-slate-800">2</span><span>Na página de transferências, selecione <strong>Transferir</strong> para preparar o resgate.</span></li>
              <li className="flex gap-3"><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-bold dark:bg-slate-800">3</span><span>Confira o valor e a conta bancária antes de confirmar na Wix.</span></li>
            </ol>

            <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-200">
              <LockKeyhole className="mt-0.5 h-5 w-5 shrink-0" />
              <p>O Dashboard apenas abre a Wix para o resgate. Ele não recebe senha, não prepara transferências e não confirma movimentações financeiras. O relatório de vendas só lê pedidos e o relatório de pagamentos exportado da Wix.</p>
            </div>
          </div>
        ) : (
          <div className="overflow-y-auto px-6 py-6">
            <WixSalesReport />
          </div>
        )}

        <div className="flex flex-col-reverse gap-3 border-t border-slate-200 bg-slate-50 px-6 py-4 sm:flex-row sm:justify-end dark:border-slate-800 dark:bg-slate-950/40">
          <button type="button" onClick={onClose} className="rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-white dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800">Cancelar</button>
          <button type="button" onClick={openWixTreasury} className="inline-flex items-center justify-center gap-2 rounded-lg bg-blue-700 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-blue-800">
            Abrir Tesouraria Wix
            <ArrowUpRight className="h-4 w-4" />
          </button>
        </div>
      </section>
    </div>
  );
};
