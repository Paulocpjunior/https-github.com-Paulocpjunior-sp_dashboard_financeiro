import React, { useEffect, useRef, useState } from "react";
import { ClipboardList, UserPlus } from "lucide-react";
import { ClientRegistration, EntryClient } from "../services/nativeEntryService";
import { ChecklistRecord, ChecklistReview, fetchChecklistReview } from "../services/checklistReviewService";
import { matchesClientSearch } from "../utils/clientSearch";

const digits = (value: unknown) => String(value || "").replace(/\D/g, "");
const formatDocument = (value: string) => {
  const d = digits(value);
  if (d.length === 14) return d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
  if (d.length === 11) return d.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4");
  return value;
};
const empty = { client: "", cpfCnpj: "", clientNumber: "", reason: "", submissionId: "" };

/**
 * Cliente novo que está no Checklist do Legal, mas ainda não no cadastro conferido do Financeiro.
 * Os dados vêm do Checklist; o servidor confere CPF/CNPJ, N.Cliente duplicado e registra quem cadastrou.
 */
export default function ChecklistClientRegistration({
  search,
  noMatches,
  incomplete,
  register,
  onRegistered,
  deactivate,
  onDeactivated,
  loadChecklist = fetchChecklistReview,
}: {
  search: string;
  noMatches: boolean;
  /** Cadastro escolhido na lista que está sem CPF/CNPJ: não serve para lançar até ser completado. */
  incomplete?: EntryClient;
  register: (input: ClientRegistration) => Promise<{ client: EntryClient; existing: boolean; replaced?: string[] }>;
  onRegistered: (client: EntryClient, existing: boolean, replaced: string[]) => void;
  /** Tira da Nova cobrança um cadastro que não deve mais ser cobrado (ex.: filial baixada); o servidor guarda o registro e o motivo. */
  deactivate?: (input: { requestId: string; clientRegistryId: string; reason: string }) => Promise<{ deactivated: string }>;
  onDeactivated?: (id: string) => void;
  loadChecklist?: (signal: AbortSignal) => Promise<ChecklistReview>;
}) {
  const [open, setOpen] = useState(false),
    [checklist, setChecklist] = useState<ChecklistReview | null>(null),
    [checklistError, setChecklistError] = useState(""),
    [loading, setLoading] = useState(false),
    [form, setForm] = useState(empty),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const requestId = useRef(crypto.randomUUID());
  const visible = open || noMatches || Boolean(incomplete);
  useEffect(() => {
    if (!incomplete) return;
    setForm({ ...empty, client: incomplete.client, clientNumber: digits(incomplete.clientNumber) });
    requestId.current = crypto.randomUUID();
    setError("");
  }, [incomplete?.id]);
  useEffect(() => {
    if (!visible || checklist || loading || checklistError) return;
    const controller = new AbortController();
    setLoading(true);
    loadChecklist(controller.signal)
      .then(setChecklist)
      .catch((e) => { if (!controller.signal.aborted) setChecklistError((e as Error).message || "Checklist indisponível."); })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [visible]);
  if (!visible)
    return (
      <button type="button" className="inline-flex items-center gap-2 text-sm font-semibold text-blue-700 dark:text-blue-300" onClick={() => setOpen(true)}>
        <UserPlus className="h-4 w-4" aria-hidden /> Cliente novo do Checklist não aparece? Cadastrar
      </button>
    );
  const records = (checklist?.records || [])
    .filter((r) => r.client && search.trim() && matchesClientSearch([r.client, r.document, r.clientNumber], search))
    .slice(0, 8);
  const update = (changes: Partial<typeof empty>) => {
    setForm((f) => ({ ...f, ...changes }));
    requestId.current = crypto.randomUUID();
    setError("");
  };
  const pickRecord = (r: ChecklistRecord) =>
    update({ client: r.client || "", cpfCnpj: formatDocument(r.document || ""), clientNumber: digits(r.clientNumber), submissionId: r.submissionId, reason: "" });
  const fromChecklist = Boolean(form.submissionId);
  // Completar um cadastro antigo substitui o registro sem documento: o servidor exige o motivo.
  const reasonRequired = !fromChecklist || Boolean(incomplete);
  async function save() {
    setBusy(true);
    setError("");
    try {
      const result = await register({
        requestId: requestId.current,
        client: form.client,
        cpfCnpj: form.cpfCnpj,
        clientNumber: form.clientNumber.trim(),
        source: fromChecklist ? "checklist" : "manual",
        checklistSubmissionId: form.submissionId || undefined,
        reason: form.reason.trim(),
      });
      onRegistered(result.client, result.existing, result.replaced || []);
      setForm(empty);
      setOpen(false);
      requestId.current = crypto.randomUUID();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function retire() {
    if (!incomplete || !deactivate) return;
    setBusy(true);
    setError("");
    try {
      await deactivate({ requestId: requestId.current, clientRegistryId: incomplete.id, reason: form.reason.trim() });
      onDeactivated?.(incomplete.id);
      setForm(empty);
      requestId.current = crypto.randomUUID();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="rounded-xl border border-blue-200 dark:border-blue-900/60 bg-blue-50/60 dark:bg-blue-950/20 p-4 space-y-3" aria-label="Cadastrar cliente novo do Checklist">
      <div className="flex items-start gap-2">
        <ClipboardList className="h-5 w-5 shrink-0 text-blue-700 dark:text-blue-300" aria-hidden />
        <div>
          <h4 className="font-semibold">{incomplete ? "Este cadastro está sem CPF/CNPJ" : noMatches ? "Cliente não está no cadastro conferido" : "Cadastrar cliente novo"}</h4>
          <p className="text-xs text-slate-600 dark:text-slate-400">
            {incomplete
              ? `Para lançar, informe o CPF/CNPJ de ${incomplete.client} (N.Cliente ${incomplete.clientNumber}) e o motivo. O cadastro antigo fica guardado como substituído; nada é apagado. Se for filial baixada ou cliente encerrado, informe o motivo e use “Não usar mais este cadastro”.`
              : "Clientes que entraram pelo Checklist do Legal são incluídos aqui com nome, CPF/CNPJ e N.Cliente. O cadastro fica registrado com seu nome e data."}
          </p>
        </div>
      </div>
      {loading && <p className="text-sm" role="status">Consultando o Checklist do Legal…</p>}
      {checklistError && (
        <p className="text-sm text-amber-800 dark:text-amber-300" role="status">
          Checklist indisponível agora ({checklistError}). Você pode cadastrar manualmente informando o motivo.
        </p>
      )}
      {checklist && search.trim() && (
        records.length ? (
          <ul className="space-y-2">
            {records.map((r) => (
              <li key={r.submissionId} className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-3 flex flex-wrap items-center justify-between gap-2">
                <div className="text-sm">
                  <div className="font-semibold">{r.client}</div>
                  <div className="text-xs text-slate-500">
                    {formatDocument(r.document || "") || "sem CPF/CNPJ"} · Nº {r.clientNumber || "—"}{r.entryDate ? ` · entrada ${r.entryDate.split("-").reverse().join("/")}` : ""}
                  </div>
                  {r.issues.length > 0 && <div className="text-xs text-amber-800 dark:text-amber-300">Conferir: {r.issues.join("; ")}</div>}
                </div>
                <button type="button" className="rounded-lg border border-slate-300 dark:border-slate-600 px-3 py-2 text-sm font-semibold" onClick={() => pickRecord(r)}>
                  Usar dados do Checklist
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-slate-600 dark:text-slate-400">Nenhuma resposta do Checklist encontrada para “{search.trim()}”.</p>
        )
      )}
      <div className="grid sm:grid-cols-3 gap-3">
        <label className="block text-sm sm:col-span-3">
          Nome do cliente *
          <input className="sp-form-field" value={form.client} onChange={(e) => update({ client: e.target.value })} />
        </label>
        <label className="block text-sm sm:col-span-2">
          CPF/CNPJ *
          <input className="sp-form-field" inputMode="numeric" value={form.cpfCnpj} onChange={(e) => update({ cpfCnpj: e.target.value })} />
        </label>
        <label className="block text-sm">
          N.Cliente *
          <input className="sp-form-field" inputMode="numeric" value={form.clientNumber} onChange={(e) => update({ clientNumber: e.target.value })} />
        </label>
        <label className="block text-sm sm:col-span-3">
          {!reasonRequired ? "Observação (opcional)" : incomplete ? "Motivo (origem do documento, ou por que não usar mais) *" : "Motivo e origem do cadastro manual *"}
          <input className="sp-form-field" value={form.reason} placeholder={!reasonRequired ? "" : incomplete ? "Ex.: CNPJ conferido no contrato / cartão CNPJ" : "Ex.: contrato assinado em 20/10, ainda fora do Checklist"} onChange={(e) => update({ reason: e.target.value })} />
        </label>
      </div>
      <p className="text-xs text-slate-500">
        {fromChecklist ? `Origem: Checklist do Legal (resposta ${form.submissionId}).` : "Origem: cadastro manual."} Um cadastro já conferido não é substituído.
      </p>
      {error && <p className="text-sm text-red-700 dark:text-red-300" role="alert">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={busy || !form.client.trim() || !form.cpfCnpj.trim() || !form.clientNumber.trim() || (reasonRequired && form.reason.trim().length < 10)} className="sp-form-primary rounded-lg bg-blue-600 text-white px-4 py-2 text-sm font-semibold disabled:opacity-50" onClick={save}>
          {busy ? "Cadastrando…" : incomplete ? "Completar e selecionar" : "Cadastrar e selecionar"}
        </button>
        {incomplete && deactivate && (
          <button type="button" disabled={busy || form.reason.trim().length < 10} className="rounded-lg border border-slate-300 dark:border-slate-600 px-4 py-2 text-sm disabled:opacity-50" onClick={retire} title="Para filial baixada ou cliente encerrado: o cadastro sai da Nova cobrança e fica guardado com o motivo.">
            Não usar mais este cadastro
          </button>
        )}
        {open && !noMatches && !incomplete && (
          <button type="button" className="rounded-lg border border-slate-300 dark:border-slate-600 px-4 py-2 text-sm" onClick={() => { setOpen(false); setForm(empty); }}>
            Cancelar
          </button>
        )}
      </div>
    </section>
  );
}
