import React, { useEffect, useRef, useState } from "react";
import {
  EntryAPI,
  EntryAttachment,
  EntryConfig,
  EntryDraft,
  EntryKind,
  EntryReview,
  nativeEntryAPI,
  downloadEntryAttachment,
} from "../services/nativeEntryService";
import { Transaction } from "../types";
import { auth } from "../services/firebaseConfig";
import { toLocalISODate } from "../utils/dateUtils";
const empty = (kind: EntryKind): EntryDraft => ({
  kind,
  clientRegistryId: "",
  bankAccount: "",
  category: "",
  supplier: "",
  date: toLocalISODate(new Date()),
  dueDate: "",
  description: "",
  amount: "",
  honorarios: "",
  extras: "0",
  extraItems: [],
  interestRate: "0",
  paid: false,
  paidAmount: "0",
  paymentDate: "",
  paymentMethod: "",
  deliveryMethod: "",
  receiptMethod: "",
  paidBy: "",
  authorizedBy: "",
  personType: "PJ",
  extraDescription: "",
  observation: "",
  email: "",
  phone: "",
  address: {},
});
const money = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const inputClass =
  "w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-slate-900 dark:text-white";
export default function NativeEntryModal({
  kind,
  onClose,
  onSaved,
  api = nativeEntryAPI,
  simulation = false,
}: {
  kind: EntryKind;
  onClose: () => void;
  onSaved: (t: Transaction) => void;
  api?: EntryAPI;
  simulation?: boolean;
}) {
  const [config, setConfig] = useState<EntryConfig | null>(null),
    [draft, setDraft] = useState(empty(kind)),
    [search, setSearch] = useState("");
  const [attachments, setAttachments] = useState<EntryAttachment[]>([]),
    [review, setReview] = useState<EntryReview | null>(null),
    [saved, setSaved] = useState<Transaction | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [uncertain, setUncertain] = useState(false),
    [checked, setChecked] = useState(false);
  const requestId = useRef<string>(crypto.randomUUID());
  const gate = useRef(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const storageKey = `native-entry-pending-${simulation ? 'demo' : auth.currentUser?.uid || 'anonymous'}-${kind}`;
  const receivable = kind === "receber";
  useEffect(() => {
    dialog.current?.showModal();
    let live = true;
    api
      .config()
      .then((c) => {
        if (live) setConfig(c);
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    const pending = sessionStorage.getItem(storageKey);
    if (pending) {
      requestId.current = pending;
      setUncertain(true);
    }
    return () => {
      live = false;
    };
  }, []);
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (uncertain || busy) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [uncertain, busy]);
  function change(key: keyof EntryDraft, value: unknown) {
    setDraft((d) => ({ ...d, [key]: value }));
    setReview(null);
    setChecked(false);
  }
  const amount = receivable
    ? Math.round(
        (Number(draft.honorarios || 0) + (draft.extraItems || []).reduce((sum, item) => sum + Math.round(Number(item.amount || 0) * 100), 0) / 100) * 100,
      ) / 100
    : Number(draft.amount || 0);
  const selected = config?.clients.find((c) => c.id === draft.clientRegistryId);
  const matches =
    config?.clients
      .filter((c) =>
        `${c.clientNumber} ${c.client} ${c.cpfCnpj}`
          .toLocaleLowerCase()
          .includes(search.toLocaleLowerCase()),
      )
      .slice(0, 30) || [];
  function reset() {
    requestId.current = crypto.randomUUID();
    setDraft(empty(kind));
    setAttachments([]);
    setReview(null);
    setSaved(null);
    setError("");
    setUncertain(false);
    setChecked(false);
    setSearch("");
  }
  async function recover() {
    setBusy(true);
    setError("");
    try {
      const result = await api.status(requestId.current);
      if (result.state === "saved" && result.transaction) {
        setSaved(result.transaction);
        setUncertain(false);
        sessionStorage.removeItem(storageKey);
        onSaved(result.transaction);
      } else
        setError(
          "Ainda não há gravação confirmada. Se esta tela mantém a revisão, reenvie a mesma tentativa. Não crie outro lançamento. Se recarregou a página, peça conferência ao administrador.",
        );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function submit() {
    if (gate.current) return;
    gate.current = true;
    setBusy(true);
    setError("");
    try {
      if (!review) {
        setReview(await api.preview(requestId.current, draft, attachments));
        setChecked(false);
      } else {
        sessionStorage.setItem(storageKey, requestId.current);
        setUncertain(true);
        const result = await api.commit(
          requestId.current,
          draft,
          attachments,
          review.previewHash,
        );
        setSaved(result.transaction);
        setUncertain(false);
        sessionStorage.removeItem(storageKey);
        onSaved(result.transaction);
      }
    } catch (e) {
      setError((e as Error).message);
      if ([400, 403, 409].includes((e as any).status)) {
        setUncertain(false);
        sessionStorage.removeItem(storageKey);
        requestId.current = crypto.randomUUID();
        setReview(null);
        setChecked(false);
      }
    } finally {
      setBusy(false);
      gate.current = false;
    }
  }
  async function addFiles(list: FileList | null, kind: string) {
    if (!list) return;
    setBusy(true);
    setError("");
    try {
      if (attachments.length + list.length > 4)
        throw new Error("Máximo de quatro arquivos.");
      let bytes = attachments.reduce(
        (n, a) => n + (a.base64.length * 3) / 4,
        0,
      );
      const next: EntryAttachment[] = [];
      for (const file of Array.from(list)) {
        bytes += file.size;
        if (bytes > 2 * 1024 * 1024) throw new Error("Limite total: 2 MB.");
        const base64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result).split(",")[1]);
          reader.onerror = () => reject(new Error("Falha ao ler arquivo."));
          reader.readAsDataURL(file);
        });
        next.push({ name: file.name, type: file.type, kind, base64 });
      }
      setAttachments([...attachments, ...next]);
      setReview(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function field(
    key: keyof EntryDraft,
    label: string,
    type = "text",
    required = false,
  ) {
    return (
      <label className="block text-sm space-y-1">
        <span>
          {label}
          {required ? " *" : ""}
        </span>
        <input
          className={inputClass}
          type={type}
          required={required}
          step={type === "number" ? "0.01" : undefined}
          min={type === "number" ? "0" : undefined}
          value={String(draft[key] ?? "")}
          onInput={(e) => change(key, e.currentTarget.value)}
          onChange={(e) => change(key, e.target.value)}
        />
      </label>
    );
  }
  function select(
    key: keyof EntryDraft,
    label: string,
    options: string[],
    required = false,
  ) {
    return (
      <label className="block text-sm space-y-1">
        <span>
          {label}
          {required ? " *" : ""}
        </span>
        <select
          className={inputClass}
          required={required}
          value={String(draft[key])}
          onChange={(e) => change(key, e.target.value)}
        >
          <option value="">Selecione</option>
          {options.map((v, i) => (
            <option key={`${v}-${i}`} value={v}>{v}</option>
          ))}
        </select>
      </label>
    );
  }
  const canClose = !busy && !uncertain;
  return (
    <dialog
      ref={dialog}
      onCancel={(e) => {
        e.preventDefault();
        if (canClose) onClose();
      }}
      aria-label={`Nova conta a ${kind}`}
      className="m-auto w-[min(960px,96vw)] max-h-[94vh] rounded-2xl p-0 bg-white dark:bg-slate-900 text-slate-900 dark:text-white backdrop:bg-black/60"
    >
      <div className="p-6 border-b border-slate-200 dark:border-slate-700 flex justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold">Nova conta a {kind}</h2>
          <p className="text-sm text-slate-500">
            {simulation
              ? "Demonstração local · nenhum dado será enviado"
              : "Piloto · lançamentos simples, sem recorrência ou pagamentos parciais"}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          disabled={!canClose}
          aria-label="Fechar lançamento"
        >
          ✕
        </button>
      </div>
      <div className="p-6 space-y-5">
        {error && (
          <p role="alert" className="rounded-lg bg-red-50 text-red-800 p-3">
            {error}
          </p>
        )}
        {uncertain && (
          <div className="bg-amber-50 text-amber-900 p-3 rounded-lg">
            <p>
              A tentativa está pendente de confirmação. Consulte antes de
              repetir.
            </p>
            <button
              type="button"
              disabled={busy}
              onClick={recover}
              className="underline"
            >
              Consultar resultado da tentativa
            </button>
          </div>
        )}
        {saved ? (
          <div className="space-y-4">
            <h3 className="text-lg font-bold text-green-600">
              {simulation ? "Simulação concluída" : "Lançamento salvo"}
            </h3>
            <p>
              {saved.client} · {money(Number(saved.valorOriginal))} ·{" "}
              {saved.dueDate.split("-").reverse().join("/")} · {saved.status}
            </p>
            {saved.attachments?.map((a) => (
              <button
                key={a.sha256}
                type="button"
                className="block underline"
                onClick={() =>
                  downloadEntryAttachment(saved.id, a.sha256).catch((e) =>
                    setError(e.message),
                  )
                }
              >
                Baixar {a.name}
              </button>
            ))}
            <p className="text-sm break-all">Identificador: {saved.id}</p>
            <p>
              {receivable
                ? "A emissão do boleto é uma etapa separada. Use “Emitir / consultar boletos” em Contas a Receber após conferir este lançamento."
                : "O registro da despesa não executa uma transferência ou pagamento bancário."}
            </p>
            <div className="flex gap-3">
              <button
                className="bg-blue-600 text-white rounded-lg px-4 py-2"
                onClick={reset}
              >
                Lançar outra conta a {kind}
              </button>
              <button className="min-h-12 rounded-lg bg-emerald-700 px-5 py-3 font-semibold text-white hover:bg-emerald-800" onClick={onClose}>Concluir e fechar lançamento</button>
            </div>
          </div>
        ) : !config ? (
          <p>Carregando configuração…</p>
        ) : !config.enabled ? (
          <p>Lançamentos nativos ainda não ativados neste ambiente.</p>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
            className="space-y-5"
          >
            <fieldset
              disabled={busy || Boolean(review) || uncertain}
              className="space-y-5 disabled:opacity-75"
            >
              <div className="grid sm:grid-cols-2 gap-4">
                {select(
                  "bankAccount",
                  "Conta bancária",
                  config.catalog.banks,
                  true,
                )}
                {field("date", "Data do lançamento", "date", true)}
                {field("dueDate", "Vencimento", "date", true)}
              </div>
              {receivable ? (
                <section className="space-y-3">
                  <h3 className="font-semibold">Cliente</h3>
                  <label className="block text-sm">
                    Buscar no cadastro conferido
                    <input
                      className={inputClass}
                      placeholder="N.Cliente, nome ou CPF/CNPJ"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                    />
                  </label>
                  <label className="block text-sm">
                    Cliente *
                    <select
                      className={inputClass}
                      required
                      value={draft.clientRegistryId}
                      onChange={(e) =>
                        change("clientRegistryId", e.target.value)
                      }
                    >
                      <option value="">Selecione um cliente</option>
                      {selected &&
                        !matches.some((c) => c.id === selected.id) && (
                          <option value={selected.id}>
                            {selected.clientNumber} — {selected.client}
                          </option>
                        )}
                      {matches.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.clientNumber} — {c.client} — {c.cpfCnpj}
                        </option>
                      ))}
                    </select>
                  </label>
                  <p className="text-xs text-slate-500">
                    Mostrando até 30 resultados. Nome e documento vêm do
                    cadastro conferido; não são alterados por este lançamento.
                  </p>
                  {field("description", "Descrição da cobrança", "text", true)}
                  <div className="grid sm:grid-cols-2 gap-4">
                    {field("honorarios", "Honorários (R$)", "number", true)}
                    <section className="sm:col-span-2 rounded-xl border border-slate-300 dark:border-slate-600 p-4 space-y-3">
                      <h4 className="font-semibold">Serviços extras</h4>
                      <p className="text-sm text-slate-500">Selecione cada serviço no plano de contas. Novas contas são cadastradas em Manutenção → Cobranças extras.</p>
                      {(draft.extraItems || []).map((item, index) => (
                        <div key={index} className="grid sm:grid-cols-[1fr_150px_auto] gap-3 items-end">
                          <label className="text-sm">Conta do serviço extra *
                            <select required className={inputClass} value={item.account} onChange={e => change("extraItems", draft.extraItems!.map((x, i) => i === index ? {...x, account: e.target.value} : x))}>
                              <option value="">Selecione a conta</option>
                              {config.catalog.extras.map(account => <option key={account} value={account}>{account}</option>)}
                            </select>
                          </label>
                          <label className="text-sm">Valor (R$) *
                            <input required type="number" min="0.01" step="0.01" className={inputClass} value={item.amount} onChange={e => change("extraItems", draft.extraItems!.map((x, i) => i === index ? {...x, amount: e.target.value} : x))}/>
                          </label>
                          <button type="button" className="rounded-lg border px-3 py-2" aria-label={`Remover serviço extra ${index + 1}`} onClick={() => change("extraItems", draft.extraItems!.filter((_, i) => i !== index))}>Remover</button>
                        </div>
                      ))}
                      <button type="button" disabled={(draft.extraItems?.length || 0) >= 30} className="rounded-lg bg-blue-600 text-white px-4 py-2" onClick={() => change("extraItems", [...(draft.extraItems || []), {account: "", amount: ""}])}>+ Adicionar serviço extra</button>
                      <p className="text-sm">Total dos extras: {money((draft.extraItems || []).reduce((sum, item) => sum + Math.round(Number(item.amount || 0) * 100), 0) / 100)}. O boleto mantém o valor total da cobrança.</p>
                    </section>
                    {select(
                      "deliveryMethod",
                      "Método de envio da cobrança",
                      config.catalog.deliveryMethods,
                      true,
                    )}
                    {select(
                      "receiptMethod",
                      "Método de recebimento",
                      config.catalog.receiptMethods,
                    )}
                  </div>
                  <p className="font-semibold">
                    Total: {money(amount)} · Juros: 0% neste piloto
                  </p>
                  <details>
                    <summary className="cursor-pointer">
                      Contato e endereço para a cobrança
                    </summary>
                    <div className="grid sm:grid-cols-2 gap-4 mt-3">
                      {field("email", "E-mail", "email")}
                      {field("phone", "Telefone")}
                      {Object.entries({
                        cep: "CEP",
                        uf: "UF",
                        localidade: "Cidade",
                        bairro: "Bairro",
                        logradouro: "Logradouro",
                        numero: "Número",
                        complemento: "Complemento",
                      }).map(([k, label]) => (
                        <label key={k} className="text-sm">
                          {label}
                          <input
                            className={inputClass}
                            value={draft.address[k] || ""}
                            onChange={(e) =>
                              change("address", {
                                ...draft.address,
                                [k]: e.target.value,
                              })
                            }
                          />
                        </label>
                      ))}
                    </div>
                    <p className="text-xs mt-2">
                      Dados informados ficam vinculados a esta cobrança. Salvar
                      não envia e-mail ou WhatsApp.
                    </p>
                  </details>
                </section>
              ) : (
                <div className="grid sm:grid-cols-2 gap-4">
                  {select(
                    "category",
                    "Movimentação",
                    config.catalog.categories,
                    true,
                  )}
                  {field("supplier", "Fornecedor / favorecido")}
                  {field("amount", "Valor original (R$)", "number", true)}
                  {select("personType", "Tipo de pessoa", ["PF", "PJ"], true)}
                  {select("paidBy", "Pago por", config.catalog.paidBy, true)}
                  {select(
                    "authorizedBy",
                    "Autorizado por (declarado)",
                    config.catalog.authorizedBy,
                    true,
                  )}
                  {select(
                    "paymentMethod",
                    "Método de pagamento",
                    config.catalog.paymentMethods,
                    true,
                  )}
                </div>
              )}
              <section className="space-y-3">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={draft.paid}
                    onChange={(e) => {
                      change("paid", e.target.checked);
                      change(
                        "paidAmount",
                        e.target.checked ? String(amount) : "0",
                      );
                      if (!e.target.checked) change("paymentDate", "");
                    }}
                  />
                  Documento integralmente {receivable ? "recebido" : "pago"}
                </label>
                {draft.paid && (
                  <div className="grid sm:grid-cols-2 gap-4">
                    {field(
                      "paymentDate",
                      "Data efetiva do pagamento",
                      "date",
                      true,
                    )}
                    {field(
                      "paidAmount",
                      "Valor efetivamente pago (R$)",
                      "number",
                      true,
                    )}
                  </div>
                )}
              </section>
              {field("observation", "Observação")}
              <section className="space-y-2">
                <h3 className="font-semibold">Anexos</h3>
                {config.attachmentsEnabled ? (
                  <>
                    <p className="text-xs">
                      PDF, PNG ou JPEG · até 4 arquivos e 2 MB no total
                    </p>
                    {(receivable
                      ? ["comprovante", "assinatura"]
                      : ["fatura", "comprovante"]
                    ).map((k) => (
                      <label key={k} className="block capitalize text-sm">
                        {k}
                        <input
                          type="file"
                          accept="application/pdf,image/png,image/jpeg"
                          multiple
                          className="block mt-1"
                          onChange={(e) => {
                            addFiles(e.target.files, k);
                            e.target.value = "";
                          }}
                        />
                      </label>
                    ))}
                    {attachments.map((a, i) => (
                      <p key={i} className="text-sm">
                        {a.name} ({a.kind}){" "}
                        <button
                          type="button"
                          className="underline"
                          onClick={() =>
                            setAttachments(
                              attachments.filter((_, j) => i !== j),
                            )
                          }
                        >
                          Remover
                        </button>
                      </p>
                    ))}
                  </>
                ) : (
                  <p className="text-sm text-amber-700">
                    Armazenamento ainda não ativado. Se este lançamento exige
                    anexo, use o fluxo atual até a configuração ser concluída.
                  </p>
                )}
              </section>
            </fieldset>
            {review && (
              <section className="rounded-xl border border-blue-300 p-4 space-y-3">
                <h3 className="font-bold">Confira antes de gravar</h3>
                <p>
                  {review.transaction.client} ·{" "}
                  {money(Number(review.transaction.valorOriginal))}
                </p>
                <p>
                  Vencimento:{" "}
                  {review.transaction.dueDate.split("-").reverse().join("/")} ·{" "}
                  {review.transaction.status}
                </p>
                <p>Conta: {review.transaction.bankAccount}</p>
                {receivable && <div>
                  <p>Honorários: {money(Number(review.transaction.honorarios || 0))}</p>
                  {review.transaction.extraItems?.map((item, index) => <p key={index}>{item.account}: {money(item.amount)}</p>)}
                </div>}
                <p>{receivable ? draft.description : draft.supplier}</p>
                <p>
                  Método:{" "}
                  {review.transaction.metodoPagamento ||
                    (receivable ? draft.deliveryMethod : draft.paymentMethod)}
                </p>
                {draft.paid && (
                  <p>
                    Pagamento:{" "}
                    {draft.paymentDate.split("-").reverse().join("/")} ·{" "}
                    {money(Number(draft.paidAmount))}
                  </p>
                )}
                <p className="text-sm">
                  {review.attachments.length} anexo(s). O lançamento não emite
                  nem envia boleto automaticamente.
                </p>
                <label className="flex gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(e) => setChecked(e.target.checked)}
                  />
                  Conferi os dados e verifiquei que este lançamento ainda não
                  existe.
                </label>
                {!uncertain && (
                  <button
                    type="button"
                    disabled={busy}
                    className="underline"
                    onClick={() => {
                      setReview(null);
                      setChecked(false);
                    }}
                  >
                    Corrigir dados
                  </button>
                )}
              </section>
            )}
            <button
              className="rounded-lg bg-blue-600 text-white px-5 py-2 disabled:opacity-40"
              disabled={
                busy || (Boolean(review) && !checked) || (uncertain && !review)
              }
            >
              {busy
                ? "Aguarde…"
                : review
                  ? uncertain
                    ? "Reenviar a mesma tentativa"
                    : "Confirmar e salvar"
                  : "Revisar lançamento"}
            </button>
          </form>
        )}
      </div>
    </dialog>
  );
}
