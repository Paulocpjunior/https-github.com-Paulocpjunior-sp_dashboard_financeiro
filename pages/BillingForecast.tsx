import React, { FormEvent, useEffect, useMemo, useState } from 'react';
import Layout from '../components/Layout';
import { AuthService } from '../services/authService';
import { BillingReportService } from '../services/billingReportService';
import { FirebaseService } from '../services/firebaseService';
import { BillingDeliveryChannel, BillingForecastRow, BillingProfile, Transaction } from '../types';
import {
  addMonths,
  buildBillingForecastRows,
  formatDeliveryChannels,
  getBillingIdentityKey,
  getMonthRange,
  makeBillingProfileId,
  sortBillingForecastRows,
  BillingSortDirection,
  BillingSortField,
} from '../utils/billingForecast';
import { formatISODateBR } from '../utils/dateUtils';
import { logger } from '../utils/logger';
import { warmPDFDownloadService } from '../utils/pdfDownload';
import {
  AlertTriangle, Building2, CalendarDays, CheckCircle2, Download, FileSpreadsheet, FileText,
  Mail, MessageCircle, Pencil, Plus, Printer, RefreshCw, Search, Send, X, ArrowUp, ArrowDown,
} from 'lucide-react';

const currentMonth = new Date().toISOString().slice(0, 7);

const emptyProfile = (): BillingProfile => ({
  id: '',
  identityKey: '',
  client: '',
  cpfCnpj: '',
  clientNumber: '',
  groupName: '',
  billingMethod: '',
  issueDay: undefined,
  dueDay: undefined,
  deliveryChannels: [],
  billingEmail: '',
  whatsapp: '',
  printedDeliveryDetails: '',
  billingInstructions: '',
  active: true,
});

const formatCurrency = (value: number) => new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
}).format(value || 0);

const formatMonth = (month: string) => {
  const [year, monthNumber] = month.split('-').map(Number);
  return new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric' }).format(new Date(year, monthNumber - 1, 1));
};

const BillingForecast: React.FC = () => {
  const user = AuthService.getCurrentUser();
  const isAdmin = (user?.role || '').toLowerCase() === 'admin';
  const [referenceMonth, setReferenceMonth] = useState(currentMonth);
  const [targetMonth, setTargetMonth] = useState(addMonths(currentMonth, 1));
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [profiles, setProfiles] = useState<BillingProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [onlyPending, setOnlyPending] = useState(false);
  const [sortField, setSortField] = useState<BillingSortField>('groupName');
  const [sortDirection, setSortDirection] = useState<BillingSortDirection>('asc');
  const [downloadMessage, setDownloadMessage] = useState('');
  const [downloadingPDF, setDownloadingPDF] = useState(false);
  const [preparedPDF, setPreparedPDF] = useState<Awaited<ReturnType<typeof BillingReportService.preparePDF>> | null>(null);
  const [editingProfile, setEditingProfile] = useState<BillingProfile | null>(null);

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const range = getMonthRange(referenceMonth);
      const [loadedTransactions, loadedProfiles] = await Promise.all([
        FirebaseService.fetchTransactionsByRange('dueDate', range.startDate, range.endDate),
        FirebaseService.fetchBillingProfiles(),
      ]);
      setTransactions(loadedTransactions);
      setProfiles(loadedProfiles);
    } catch (loadError: any) {
      logger.error('Erro ao carregar a base de faturamento:', loadError);
      setError(loadError?.message || 'Não foi possível carregar a base de faturamento.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [referenceMonth]);

  useEffect(() => {
    warmPDFDownloadService();
  }, []);

  const allRows = useMemo(
    () => buildBillingForecastRows(transactions, profiles, referenceMonth, targetMonth),
    [transactions, profiles, referenceMonth, targetMonth],
  );

  const rows = useMemo(() => {
    const normalizedSearch = search.trim().toLocaleLowerCase('pt-BR');
    const filtered = allRows.filter(row => {
      if (onlyPending && row.missingFields.length === 0) return false;
      if (!normalizedSearch) return true;
      return [row.groupName, row.client, row.cpfCnpj, row.clientNumber, row.billingMethod]
        .join(' ')
        .toLocaleLowerCase('pt-BR')
        .includes(normalizedSearch);
    });

    return sortBillingForecastRows(filtered, sortField, sortDirection);
  }, [allRows, onlyPending, search, sortDirection, sortField]);

  useEffect(() => {
    setPreparedPDF(null);
    if (loading || !rows.length) return;

    let cancelled = false;
    const timer = window.setTimeout(() => {
      void BillingReportService.preparePDF(rows, user)
        .then(prepared => {
          if (!cancelled) setPreparedPDF(prepared);
        })
        .catch(prepareError => logger.warn('Não foi possível antecipar o PDF:', prepareError));
    }, 300);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [loading, rows, user?.username]);

  const groupedRows = useMemo(() => {
    const groups = new Map<string, BillingForecastRow[]>();
    for (const row of rows) {
      const groupRows = groups.get(row.groupName) || [];
      groupRows.push(row);
      groups.set(row.groupName, groupRows);
    }
    return Array.from(groups.entries());
  }, [rows]);

  const summary = useMemo(() => ({
    total: allRows.reduce((sum, row) => sum + row.referenceAmount, 0),
    ready: allRows.filter(row => row.missingFields.length === 0).length,
    pending: allRows.filter(row => row.missingFields.length > 0).length,
    groups: new Set(allRows.map(row => row.groupName).filter(group => group !== 'Sem grupo')).size,
  }), [allRows]);

  const openEditor = (row?: BillingForecastRow) => {
    if (!row) {
      setEditingProfile(emptyProfile());
      return;
    }

    setEditingProfile({
      ...emptyProfile(),
      ...row.profile,
      id: row.profile?.id || makeBillingProfileId(row.identityKey),
      identityKey: row.identityKey,
      client: row.client,
      cpfCnpj: row.cpfCnpj,
      clientNumber: row.clientNumber,
      groupName: row.profile?.groupName || (row.groupName === 'Sem grupo' ? '' : row.groupName),
      billingMethod: row.billingMethod,
      issueDay: row.issueDate ? Number(row.issueDate.slice(-2)) : undefined,
      dueDay: row.dueDate ? Number(row.dueDate.slice(-2)) : undefined,
      deliveryChannels: [...row.deliveryChannels],
      billingEmail: row.billingEmail,
      whatsapp: row.whatsapp,
      printedDeliveryDetails: row.printedDeliveryDetails,
      billingInstructions: row.billingInstructions,
      active: true,
    });
  };

  const updateEditing = (updates: Partial<BillingProfile>) => {
    setEditingProfile(current => current ? { ...current, ...updates } : current);
  };

  const toggleChannel = (channel: BillingDeliveryChannel) => {
    if (!editingProfile) return;
    const selected = editingProfile.deliveryChannels.includes(channel);
    updateEditing({
      deliveryChannels: selected
        ? editingProfile.deliveryChannels.filter(item => item !== channel)
        : [...editingProfile.deliveryChannels, channel],
    });
  };

  const saveProfile = async (event: FormEvent) => {
    event.preventDefault();
    if (!editingProfile || !editingProfile.client.trim()) return;

    setSaving(true);
    try {
      const identityKey = editingProfile.identityKey || getBillingIdentityKey(editingProfile);
      const profile: BillingProfile = {
        ...editingProfile,
        id: editingProfile.id || makeBillingProfileId(identityKey),
        identityKey,
        client: editingProfile.client.trim(),
        cpfCnpj: editingProfile.cpfCnpj?.trim(),
        clientNumber: editingProfile.clientNumber?.trim(),
        groupName: editingProfile.groupName?.trim(),
        billingMethod: editingProfile.billingMethod?.trim(),
        billingEmail: editingProfile.billingEmail?.trim(),
        whatsapp: editingProfile.whatsapp?.trim(),
        printedDeliveryDetails: editingProfile.printedDeliveryDetails?.trim(),
        billingInstructions: editingProfile.billingInstructions?.trim(),
        updatedBy: user?.name || user?.username || '',
        active: true,
      };
      await FirebaseService.upsertBillingProfile(profile);
      setProfiles(current => [...current.filter(item => item.id !== profile.id), profile]);
      setEditingProfile(null);
    } catch (saveError: any) {
      logger.error('Erro ao salvar regra de faturamento:', saveError);
      alert(saveError?.message || 'Não foi possível salvar a regra de faturamento.');
    } finally {
      setSaving(false);
    }
  };

  const handlePDFDownload = async () => {
    if (downloadingPDF) return;
    setDownloadingPDF(true);
    setDownloadMessage('Preparando PDF...');
    try {
      await new Promise<void>(resolve => window.requestAnimationFrame(() => resolve()));
      let fileName: string;
      if (preparedPDF && preparedPDF.expiresAt > Date.now()) {
        preparedPDF.download();
        fileName = preparedPDF.fileName;
      } else {
        fileName = await BillingReportService.generatePDF(rows, user);
      }
      setDownloadMessage(`PDF gerado: ${fileName}`);
      window.setTimeout(() => setDownloadMessage(''), 6000);
    } catch (downloadError: any) {
      if (downloadError?.name === 'AbortError') {
        setDownloadMessage('Download cancelado.');
        return;
      }
      logger.error('Erro ao baixar PDF:', downloadError);
      setDownloadMessage(downloadError?.message || 'Não foi possível gerar o PDF.');
    } finally {
      setDownloadingPDF(false);
    }
  };

  return (
    <Layout>
      <div className="space-y-6 animate-in slide-in-from-bottom-4 duration-500">
        <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <FileSpreadsheet className="h-7 w-7 text-blue-600 dark:text-blue-400" />
              Base de Faturamento do Próximo Mês
            </h1>
            <p className="text-slate-500 dark:text-slate-400 mt-1">
              Organiza como, quando e por qual canal cada empresa deverá receber a cobrança.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {isAdmin && (
              <button type="button" onClick={() => openEditor()} className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold shadow-sm">
                <Plus className="h-4 w-4" /> Adicionar empresa
              </button>
            )}
            <button type="button" disabled={!rows.length} onClick={() => BillingReportService.exportCSV(rows)} className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 font-semibold disabled:opacity-50">
              <Download className="h-4 w-4" /> CSV
            </button>
            <button type="button" disabled={!rows.length || downloadingPDF} onClick={handlePDFDownload} className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-slate-900 dark:bg-blue-600 text-white font-semibold disabled:opacity-50">
              {downloadingPDF ? <RefreshCw className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
              {downloadingPDF ? 'Preparando...' : 'Baixar PDF'}
            </button>
          </div>
        </div>

        {downloadMessage && (
          <div role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 dark:bg-emerald-950/20 px-4 py-3 text-sm font-semibold text-emerald-700 dark:text-emerald-300">
            {downloadMessage}
          </div>
        )}

        <div className="rounded-xl border border-blue-200 dark:border-blue-900/60 bg-blue-50 dark:bg-blue-950/20 p-4 text-sm text-blue-900 dark:text-blue-200 flex items-start gap-3">
          <AlertTriangle className="h-5 w-5 shrink-0 mt-0.5" />
          <p><strong>Relatório preparatório:</strong> os valores são apenas a base real do mês de referência. Esta tela não emite boleto Itaú, não cria fatura Wix e não envia cobranças automaticamente.</p>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-4 gap-4">
          <div className="xl:col-span-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 grid sm:grid-cols-2 gap-4">
            <label className="text-sm font-semibold text-slate-700 dark:text-slate-200">
              Mês usado como base financeira
              <input type="month" value={referenceMonth} onChange={event => { setReferenceMonth(event.target.value); setTargetMonth(addMonths(event.target.value, 1)); }} className="mt-2 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2.5" />
            </label>
            <label className="text-sm font-semibold text-slate-700 dark:text-slate-200">
              Mês que será faturado
              <input type="month" value={targetMonth} onChange={event => setTargetMonth(event.target.value)} className="mt-2 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2.5" />
            </label>
          </div>
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
            <p className="text-xs uppercase tracking-wide text-slate-500 font-bold">Total de referência</p>
            <p className="text-2xl font-black text-blue-700 dark:text-blue-300 mt-1">{formatCurrency(summary.total)}</p>
            <p className="text-xs text-slate-500 mt-1">{formatMonth(referenceMonth)}</p>
          </div>
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 grid grid-cols-3 gap-2 text-center">
            <div><p className="text-xl font-black text-emerald-600">{summary.ready}</p><p className="text-[10px] uppercase text-slate-500">Prontos</p></div>
            <div><p className="text-xl font-black text-amber-600">{summary.pending}</p><p className="text-[10px] uppercase text-slate-500">Pendentes</p></div>
            <div><p className="text-xl font-black text-blue-600">{summary.groups}</p><p className="text-[10px] uppercase text-slate-500">Grupos</p></div>
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 flex flex-col xl:flex-row gap-3 xl:items-center">
          <div className="relative flex-1">
            <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input value={search} onChange={event => setSearch(event.target.value)} placeholder="Buscar empresa, grupo, CNPJ ou método..." className="w-full pl-9 pr-3 py-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950" />
          </div>
          <label className="inline-flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-200">
            <input type="checkbox" checked={onlyPending} onChange={event => setOnlyPending(event.target.checked)} className="rounded border-slate-300" />
            Mostrar apenas cadastros pendentes
          </label>
          <div className="flex gap-2">
            <label className="sr-only" htmlFor="billing-sort-field">Ordenar por</label>
            <select id="billing-sort-field" value={sortField} onChange={event => setSortField(event.target.value as BillingSortField)} className="min-w-44 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2.5 text-sm font-semibold">
              <option value="groupName">Ordenar por grupo</option>
              <option value="client">Ordenar por empresa</option>
              <option value="clientNumber">Ordenar por N.Cliente</option>
              <option value="referenceAmount">Ordenar por valor</option>
              <option value="issueDate">Ordenar por emissão</option>
              <option value="dueDate">Ordenar por vencimento</option>
              <option value="billingMethod">Ordenar por método</option>
              <option value="status">Ordenar por situação</option>
            </select>
            <button type="button" onClick={() => setSortDirection(current => current === 'asc' ? 'desc' : 'asc')} className="inline-flex items-center gap-2 px-3 py-2.5 rounded-lg border border-slate-300 dark:border-slate-700 text-sm font-semibold text-slate-600 dark:text-slate-300" title={sortDirection === 'asc' ? 'Crescente' : 'Decrescente'}>
              {sortDirection === 'asc' ? <ArrowUp className="h-4 w-4" /> : <ArrowDown className="h-4 w-4" />}
              {sortDirection === 'asc' ? 'Crescente' : 'Decrescente'}
            </button>
          </div>
          <button type="button" onClick={load} className="p-2.5 rounded-lg border border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-300" title="Atualizar">
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {error ? (
          <div className="rounded-xl border border-red-200 bg-red-50 dark:bg-red-950/20 p-6 text-red-700 dark:text-red-300">{error}</div>
        ) : loading ? (
          <div className="py-20 flex items-center justify-center text-slate-500"><RefreshCw className="h-7 w-7 animate-spin mr-3" /> Carregando base...</div>
        ) : groupedRows.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-300 dark:border-slate-700 p-12 text-center text-slate-500">Nenhuma empresa encontrada para os filtros selecionados.</div>
        ) : (
          <div className="space-y-5">
            {groupedRows.map(([groupName, groupRows]) => (
              <section key={groupName} className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden shadow-sm">
                <div className="px-5 py-4 bg-slate-50 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2"><Building2 className="h-5 w-5 text-blue-600" /><h2 className="font-bold text-slate-900 dark:text-white">{groupName}</h2><span className="text-xs text-slate-500">{groupRows.length} empresa(s)</span></div>
                  <span className="font-bold text-blue-700 dark:text-blue-300">{formatCurrency(groupRows.reduce((sum, row) => sum + row.referenceAmount, 0))}</span>
                </div>
                <div className="overflow-x-auto">
                  <table className="min-w-[1180px] w-full text-sm">
                    <thead className="bg-slate-50/70 dark:bg-slate-800/30 text-[11px] uppercase tracking-wide text-slate-500">
                      <tr><th className="px-4 py-3 text-left">Empresa</th><th className="px-4 py-3 text-right">Base financeira</th><th className="px-4 py-3 text-left">Como cobrar</th><th className="px-4 py-3 text-center">Quando cobrar</th><th className="px-4 py-3 text-left">Meio de envio</th><th className="px-4 py-3 text-left">Destino / orientação</th><th className="px-4 py-3 text-left">Situação</th><th className="px-4 py-3"></th></tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {groupRows.map(row => (
                        <tr key={row.identityKey} className="align-top hover:bg-slate-50/70 dark:hover:bg-slate-800/20">
                          <td className="px-4 py-4"><p className="font-bold text-slate-900 dark:text-white">{row.client}</p><p className="text-xs text-slate-500 mt-1">{row.cpfCnpj || 'CPF/CNPJ não informado'}{row.clientNumber ? ` • N.Cliente ${row.clientNumber}` : ''}</p></td>
                          <td className="px-4 py-4 text-right"><p className="font-black text-slate-900 dark:text-white">{formatCurrency(row.referenceAmount)}</p><p className="text-xs text-slate-500 mt-1">{row.hasReference ? `${row.referenceCount} cobrança(s) em ${formatMonth(referenceMonth)}` : 'Sem lançamento no mês-base'}</p></td>
                          <td className="px-4 py-4 font-semibold text-slate-700 dark:text-slate-200">{row.billingMethod || <span className="text-amber-600">Não cadastrado</span>}</td>
                          <td className="px-4 py-4 text-center"><div className="inline-flex flex-col gap-1 text-xs"><span className="flex items-center gap-1"><Send className="h-3.5 w-3.5 text-blue-500" /> Emitir {formatISODateBR(row.issueDate) || '-'}</span><span className="flex items-center gap-1"><CalendarDays className="h-3.5 w-3.5 text-slate-400" /> Vencer {formatISODateBR(row.dueDate) || '-'}</span></div></td>
                          <td className="px-4 py-4">{row.deliveryChannels.length ? <span className="font-semibold text-slate-700 dark:text-slate-200">{formatDeliveryChannels(row.deliveryChannels)}</span> : <span className="text-amber-600">Não cadastrado</span>}</td>
                          <td className="px-4 py-4 text-xs text-slate-600 dark:text-slate-300"><p>{[row.billingEmail, row.whatsapp, row.printedDeliveryDetails].filter(Boolean).join(' • ') || '-'}</p>{row.billingInstructions && <p className="mt-1 text-slate-500">{row.billingInstructions}</p>}</td>
                          <td className="px-4 py-4">{row.missingFields.length === 0 ? <span className="inline-flex items-center gap-1 text-emerald-600 font-bold text-xs"><CheckCircle2 className="h-4 w-4" /> Pronto</span> : <div className="text-amber-700 dark:text-amber-400 text-xs"><span className="inline-flex items-center gap-1 font-bold"><AlertTriangle className="h-4 w-4" /> Pendente</span><p className="mt-1 max-w-48">{row.missingFields.join(', ')}</p></div>}</td>
                          <td className="px-4 py-4 text-right">{isAdmin && <button type="button" onClick={() => openEditor(row)} className="p-2 rounded-lg text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950/30" title="Editar regra"><Pencil className="h-4 w-4" /></button>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            ))}
          </div>
        )}
      </div>

      {editingProfile && (
        <div className="fixed inset-0 z-[70] bg-slate-950/60 backdrop-blur-sm flex items-center justify-center p-4">
          <form onSubmit={saveProfile} className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 w-full max-w-3xl max-h-[92vh] overflow-hidden flex flex-col">
            <div className="px-6 py-5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between"><div><h2 className="font-black text-lg text-slate-900 dark:text-white">Regra de faturamento e envio</h2><p className="text-xs text-slate-500">Associe empresas do mesmo grupo usando exatamente o mesmo nome de grupo.</p></div><button type="button" onClick={() => setEditingProfile(null)} className="p-2 text-slate-400 hover:text-slate-700"><X className="h-5 w-5" /></button></div>
            <div className="p-6 overflow-y-auto space-y-5">
              <div className="grid sm:grid-cols-2 gap-4">
                <label className="text-sm font-semibold text-slate-700 dark:text-slate-200 sm:col-span-2">Empresa *<input required value={editingProfile.client} onChange={event => updateEditing({ client: event.target.value })} className="mt-1.5 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2.5" /></label>
                <label className="text-sm font-semibold text-slate-700 dark:text-slate-200">CPF/CNPJ<input value={editingProfile.cpfCnpj || ''} onChange={event => updateEditing({ cpfCnpj: event.target.value })} className="mt-1.5 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2.5" /></label>
                <label className="text-sm font-semibold text-slate-700 dark:text-slate-200">N.Cliente<input value={editingProfile.clientNumber || ''} onChange={event => updateEditing({ clientNumber: event.target.value })} className="mt-1.5 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2.5" /></label>
                <label className="text-sm font-semibold text-slate-700 dark:text-slate-200 sm:col-span-2">Grupo econômico<input value={editingProfile.groupName || ''} onChange={event => updateEditing({ groupName: event.target.value })} placeholder="Ex.: Grupo Empresa Alfa" className="mt-1.5 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2.5" /></label>
              </div>
              <div className="grid sm:grid-cols-3 gap-4">
                <label className="text-sm font-semibold text-slate-700 dark:text-slate-200">Como é cobrado<select value={editingProfile.billingMethod || ''} onChange={event => updateEditing({ billingMethod: event.target.value })} className="mt-1.5 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2.5"><option value="">Selecione...</option><option value="Boleto Itaú">Boleto Itaú</option><option value="Fatura Wix">Fatura Wix</option><option value="Boleto Itaú + Fatura Wix">Boleto Itaú + Fatura Wix</option><option value="Outro">Outro</option></select></label>
                <label className="text-sm font-semibold text-slate-700 dark:text-slate-200">Dia de emissão<input type="number" min="1" max="31" value={editingProfile.issueDay || ''} onChange={event => updateEditing({ issueDay: event.target.value ? Number(event.target.value) : undefined })} className="mt-1.5 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2.5" /></label>
                <label className="text-sm font-semibold text-slate-700 dark:text-slate-200">Dia do vencimento<input type="number" min="1" max="31" value={editingProfile.dueDay || ''} onChange={event => updateEditing({ dueDay: event.target.value ? Number(event.target.value) : undefined })} className="mt-1.5 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2.5" /></label>
              </div>
              <fieldset><legend className="text-sm font-bold text-slate-700 dark:text-slate-200 mb-2">Meio de envio</legend><div className="grid sm:grid-cols-3 gap-3">{([{ value: 'email', label: 'E-mail', icon: Mail }, { value: 'whatsapp', label: 'WhatsApp', icon: MessageCircle }, { value: 'printed', label: 'Físico impresso', icon: Printer }] as const).map(item => { const Icon = item.icon; const selected = editingProfile.deliveryChannels.includes(item.value); return <button key={item.value} type="button" onClick={() => toggleChannel(item.value)} className={`p-3 rounded-lg border flex items-center gap-2 font-semibold ${selected ? 'bg-blue-50 dark:bg-blue-950/30 border-blue-400 text-blue-700 dark:text-blue-300' : 'border-slate-300 dark:border-slate-700 text-slate-500'}`}><Icon className="h-4 w-4" />{item.label}</button>; })}</div></fieldset>
              <div className="grid sm:grid-cols-2 gap-4">
                <label className="text-sm font-semibold text-slate-700 dark:text-slate-200">E-mail de faturamento<input type="email" value={editingProfile.billingEmail || ''} onChange={event => updateEditing({ billingEmail: event.target.value })} className="mt-1.5 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2.5" /></label>
                <label className="text-sm font-semibold text-slate-700 dark:text-slate-200">WhatsApp<input value={editingProfile.whatsapp || ''} onChange={event => updateEditing({ whatsapp: event.target.value })} placeholder="(00) 00000-0000" className="mt-1.5 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2.5" /></label>
                <label className="text-sm font-semibold text-slate-700 dark:text-slate-200 sm:col-span-2">Detalhes da entrega física<input value={editingProfile.printedDeliveryDetails || ''} onChange={event => updateEditing({ printedDeliveryDetails: event.target.value })} placeholder="Endereço, responsável ou instrução de retirada" className="mt-1.5 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2.5" /></label>
                <label className="text-sm font-semibold text-slate-700 dark:text-slate-200 sm:col-span-2">Orientações de faturamento<textarea rows={3} value={editingProfile.billingInstructions || ''} onChange={event => updateEditing({ billingInstructions: event.target.value })} placeholder="Ex.: enviar todas as empresas do grupo em um único e-mail; boleto separado por CNPJ." className="mt-1.5 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2.5" /></label>
              </div>
            </div>
            <div className="px-6 py-4 border-t border-slate-200 dark:border-slate-800 flex justify-end gap-3"><button type="button" onClick={() => setEditingProfile(null)} className="px-4 py-2.5 rounded-lg border border-slate-300 dark:border-slate-700 font-semibold text-slate-600 dark:text-slate-300">Cancelar</button><button type="submit" disabled={saving} className="px-5 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-bold disabled:opacity-60">{saving ? 'Salvando...' : 'Salvar regra'}</button></div>
          </form>
        </div>
      )}
    </Layout>
  );
};

export default BillingForecast;
