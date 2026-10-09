import React, { useEffect, useRef, useState } from "react";
import { downloadEntryAttachment } from "../services/nativeEntryService";
import { auth } from "../services/firebaseConfig";
import { toLocalISODate } from "../utils/dateUtils";
import { getOriginalAmount } from "../utils/transactionAmounts";
import { Transaction } from "../types";
async function defaultApi(path: string, body?: unknown) {
  if (!auth.currentUser) throw Error("Entre novamente.");
  const r = await fetch("/api/financial-entries/payables/" + path, {
    method: body ? "POST" : "GET",
    headers: {
      Authorization: `Bearer ${await auth.currentUser.getIdToken()}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json();
  if (!r.ok)
    throw Object.assign(Error(data.error || "Operação não confirmada."), {
      status: r.status,
    });
  return data;
}
const cls =
  "w-full border rounded p-2 bg-white text-slate-900 dark:bg-slate-800 dark:text-white";
const btn = "rounded px-3 py-2 bg-blue-600 text-white disabled:opacity-50";
const fileInputClass =
  "block w-full cursor-pointer rounded-lg border border-slate-300 bg-slate-50 p-3 text-sm text-slate-700 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 file:mr-4 file:cursor-pointer file:rounded-md file:border-0 file:bg-blue-600 file:px-4 file:py-3 file:font-semibold file:text-white hover:file:bg-blue-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500";
const brl = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
export default function PayablesModal({
  id,
  onClose,
  onSaved,
  api = defaultApi,
}: {
  id?: string;
  onClose: () => void;
  onSaved: () => void;
  api?: (path: string, body?: any) => Promise<any>;
}) {
  const dialog = useRef<HTMLDialogElement>(null),
    gate = useRef(false),
    attempt = useRef(crypto.randomUUID());
  const [selected, setSelected] = useState(id || ""),
    [data, setData] = useState<any>(null),
    [rules, setRules] = useState<any[]>([]),
    [tab, setTab] = useState("payment"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [review, setReview] = useState<any>(null),
    [uncertain, setUncertain] = useState(false);
  const [payment, setPayment] = useState({
    date: toLocalISODate(new Date()),
    amount: "",
    bankAccount: "",
    method: "",
    note: "",
  });
  const [ruleRecipients, setRuleRecipients] = useState("");
  const [recipients, setRecipients] = useState(""),
    [attachment, setAttachment] = useState<any>(null),
    [invoiceHash, setInvoiceHash] = useState("");
  const [rule, setRule] = useState({
    start: toLocalISODate(new Date()).slice(0, 7),
    end: toLocalISODate(new Date()).slice(0, 4) + "-12",
    day: 5,
    mode: "fixed",
    active: true,
    ruleRevision: 0,
  });
  const [month, setMonth] = useState(toLocalISODate(new Date()).slice(0, 7)),
    [variableAmount, setVariableAmount] = useState("");
  async function load(key = selected) {
    const list = await api("rules");
    setRules(list.rules);
    if (key) {
      const d = await api("items/" + encodeURIComponent(key));
      setData(d);
      setRecipients(d.recipients.join("; "));
      setPayment({
        date: toLocalISODate(new Date()),
        amount: getOriginalAmount(d.transaction).toFixed(2),
        bankAccount: d.transaction.bankAccount || "",
        method: d.transaction.metodoPagamento || "",
        note: "",
      });
      const existing = list.rules.find((r: any) => r.id === key);
      setRuleRecipients((existing?.recipients || []).join("; "));
      setRule(
        existing
          ? { ...existing, ruleRevision: existing.revision }
          : {
              start: String(d.transaction.dueDate).slice(0, 7),
              end: String(d.transaction.dueDate).slice(0, 4) + "-12",
              day: Number(String(d.transaction.dueDate).slice(-2)),
              mode: "fixed",
              active: true,
              ruleRevision: 0,
            },
      );
    }
  }
  useEffect(() => {
    dialog.current?.showModal();
    void load().catch((e) => setError(e.message));
  }, []);
  function edit(fn: () => void) {
    if (uncertain) return;
    fn();
    setReview(null);
    attempt.current = crypto.randomUUID();
    setMessage("");
  }
  async function select(key: string) {
    if (busy || uncertain) return;
    setSelected(key);
    setData(null);
    setReview(null);
    setAttachment(null);
    setInvoiceHash("");
    attempt.current = crypto.randomUUID();
    setError("");
    try {
      await load(key);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  const to = () =>
    recipients
      .split(/[;,\n]+/)
      .map((x) => x.trim())
      .filter(Boolean);
  async function run(path: string, extra: any = {}) {
    if (gate.current) return;
    gate.current = true;
    setBusy(true);
    setError("");
    try {
      const result = await api(path, {
        id: selected,
        requestId: attempt.current,
        version: data?.version,
        ...extra,
      });
      return result;
    } catch (e) {
      setError((e as Error).message);
      if ([400, 403, 409].includes((e as any).status)) {
        setUncertain(false);
        setReview(null);
      }
      throw e;
    } finally {
      gate.current = false;
      setBusy(false);
    }
  }
  async function settle() {
    try {
      const payload = { payment, attachments: attachment ? [attachment] : [] };
      if (!review) {
        setReview(await run("payment/preview", payload));
      } else {
        setUncertain(true);
        const r = await run("payment/commit", {
          ...payload,
          confirmHash: review.reviewHash,
        });
        if (r) {
          setUncertain(false);
          setReview(null);
          setAttachment(null);
          setMessage("Pagamento registrado na mesma conta.");
          onSaved();
          await load();
        }
      }
    } catch {
      /* Keep the same attempt after uncertain response. */
    }
  }
  async function saveRule() {
    try {
      const r = await run("rules/save", {
        ...rule,
        recipients: ruleRecipients
          .split(/[;,\n]+/)
          .map((x) => x.trim())
          .filter(Boolean),
      });
      if (r) {
        setMessage(
          "Recorrência salva. As provisões serão geradas após revisão.",
        );
        attempt.current = crypto.randomUUID();
        await load();
      }
    } catch {}
  }
  async function generate() {
    try {
      const payload = { month, amount: variableAmount };
      if (!review) {
        setReview(await run("rules/preview", payload));
      } else {
        setUncertain(true);
        const r = await run("rules/generate", {
          ...payload,
          confirmHash: review.reviewHash,
        });
        if (r) {
          setUncertain(false);
          setReview(null);
          setMessage("Provisão criada: " + r.transaction.dueDate);
          onSaved();
          attempt.current = crypto.randomUUID();
        }
      }
    } catch {}
  }
  async function invite(format: string) {
    try {
      const r = await run("invite/download", {
        format,
        recipients: to(),
        attachmentHash: invoiceHash,
        attachments: attachment ? [{ ...attachment, kind: "fatura" }] : [],
      });
      if (r) {
        const bytes = Uint8Array.from(atob(r.base64), (c: string) =>
          c.charCodeAt(0),
        );
        const url = URL.createObjectURL(new Blob([bytes], { type: r.type }));
        const a = document.createElement("a");
        a.href = url;
        a.download = r.name;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        setMessage("Arquivo preparado. Nenhum e-mail foi enviado.");
      }
    } catch {}
  }
  async function upload(file?: File) {
    if (!file) {
      setAttachment(null);
      return;
    }
    if (file.size > 2_000_000) {
      setError("Anexo deve ter até 2 MB.");
      return;
    }
    const buffer = await file.arrayBuffer();
    let binary = "";
    for (const n of new Uint8Array(buffer)) binary += String.fromCharCode(n);
    edit(() =>
      setAttachment({
        name: file.name,
        type: file.type,
        kind: tab === "invite" ? "fatura" : "comprovante",
        base64: btoa(binary),
      }),
    );
  }
  const row: Transaction | undefined = data?.transaction;
  const isPaid = row?.status === "Pago";
  const field = (label: string, node: React.ReactNode) => (
    <label className="block text-sm space-y-1">
      <span className="block">{label}</span>
      {node}
    </label>
  );
  const emailField = field(
    "E-mails dos destinatários (separados por ponto e vírgula)",
    <textarea
      className={cls}
      value={recipients}
      onChange={(e) => edit(() => setRecipients(e.target.value))}
    />,
  );
  return (
    <dialog
      ref={dialog}
      onCancel={(e) => {
        e.preventDefault();
        if (!busy && !uncertain) onClose();
      }}
      className="m-auto w-[min(900px,95vw)] max-h-[90vh] overflow-auto rounded-xl p-6 bg-white dark:bg-slate-900 text-slate-900 dark:text-white backdrop:bg-black/60"
    >
      <div className="flex justify-between gap-4">
        <h2 className="text-xl font-bold">
          Contas a pagar — baixa, recorrência e INVITE
        </h2>
        <button disabled={busy || uncertain} onClick={onClose}>
          Fechar
        </button>
      </div>
      <p className="text-sm my-3">
        Registrar pagamento atualiza a conta selecionada. Não executa
        transferência bancária.
      </p>
      {!id &&
        field(
          "Recorrências cadastradas",
          <select
            className={cls}
            value={selected}
            onChange={(e) => void select(e.target.value)}
            disabled={busy || uncertain}
          >
            <option value="">Selecione uma regra</option>
            {rules.map((r) => (
              <option key={r.id} value={r.id}>
                {r.description} · {r.supplier} ·{" "}
                {r.active ? "Ativa" : "Pausada"}
              </option>
            ))}
          </select>,
        )}
      {!id && !rules.length && (
        <p>
          Abra uma conta na tabela e use “Recorrência” para cadastrar a primeira
          regra.
        </p>
      )}
      {row && (
        <>
          <p className="my-3 font-semibold">
            {row.description || row.client} · {brl(getOriginalAmount(row))} ·{" "}
            {row.dueDate} · {row.status}
          </p>
          {data.transaction.payableSettlement && (
            <p className="text-sm">
              Baixa manual registrada por{" "}
              {data.transaction.payableSettlement.actor} em {row.paymentDate}.{" "}
              {data.transaction.payableSettlement.note}
            </p>
          )}
          {row.attachments?.length ? (
            <div className="flex gap-2 flex-wrap my-2">
              {row.attachments.map((a) => (
                <button
                  key={a.sha256}
                  className="text-blue-600 underline text-sm"
                  onClick={() =>
                    void downloadEntryAttachment(selected, a.sha256).catch(
                      (e) => setError(e.message),
                    )
                  }
                >
                  Baixar {a.name}
                </button>
              ))}
            </div>
          ) : null}
          <nav className="flex flex-wrap gap-2 my-4">
            {[
              ["payment", "Registrar pagamento"],
              ["recurrence", "Recorrência"],
              ["generate", "Gerar competência"],
              ["invite", "INVITE"],
            ].map(([key, title]) => (
              <button
                key={key}
                className={tab === key ? btn : "border rounded px-3 py-2"}
                disabled={busy || uncertain}
                onClick={() =>
                  edit(() => {
                    setTab(key);
                    setAttachment(null);
                    setReview(null);
                  })
                }
              >
                {title}
              </button>
            ))}
          </nav>
          <fieldset disabled={busy || uncertain} className="space-y-3">
            {tab === "payment" &&
              (isPaid ? (
                <p>Conta já paga. O histórico financeiro foi preservado.</p>
              ) : (
                <>
                  <div className="grid sm:grid-cols-2 gap-3">
                    {field(
                      "Data efetiva",
                      <input
                        className={cls}
                        type="date"
                        value={payment.date}
                        onChange={(e) =>
                          edit(() =>
                            setPayment({ ...payment, date: e.target.value }),
                          )
                        }
                      />,
                    )}
                    {field(
                      "Valor pago",
                      <input
                        className={cls}
                        type="number"
                        step="0.01"
                        value={payment.amount}
                        onChange={(e) =>
                          edit(() =>
                            setPayment({ ...payment, amount: e.target.value }),
                          )
                        }
                      />,
                    )}
                    {field(
                      "Conta bancária",
                      <select
                        className={cls}
                        value={payment.bankAccount}
                        onChange={(e) =>
                          edit(() =>
                            setPayment({
                              ...payment,
                              bankAccount: e.target.value,
                            }),
                          )
                        }
                      >
                        <option value="">Selecione</option>
                        {data.catalog.banks.map((v: string) => (
                          <option key={v} value={v}>
                            {v}
                          </option>
                        ))}
                      </select>,
                    )}
                    {field(
                      "Forma de pagamento",
                      <select
                        className={cls}
                        value={payment.method}
                        onChange={(e) =>
                          edit(() =>
                            setPayment({ ...payment, method: e.target.value }),
                          )
                        }
                      >
                        <option value="">Selecione</option>
                        {data.catalog.paymentMethods.map((v: string) => (
                          <option key={v} value={v}>
                            {v}
                          </option>
                        ))}
                      </select>,
                    )}
                  </div>
                  {field(
                    "Observação",
                    <textarea
                      className={cls}
                      value={payment.note}
                      onChange={(e) =>
                        edit(() =>
                          setPayment({ ...payment, note: e.target.value }),
                        )
                      }
                    />,
                  )}
                  {field(
                    "Comprovante (PDF ou imagem, até 2 MB)",
                    <input
                      type="file"
                      className={fileInputClass}
                      accept="application/pdf,image/png,image/jpeg"
                      onChange={(e) => void upload(e.target.files?.[0])}
                    />,
                  )}
                  <p className="text-sm">
                    Baixa integral pelo valor provisionado. Pagamento parcial,
                    juros e descontos ainda não estão liberados.
                  </p>
                </>
              ))}
            {tab === "recurrence" && (
              <>
                <p>
                  Cadastre a regra a partir da conta original. A competência de
                  origem não será gerada novamente. Dias 29–31 são ajustados ao
                  último dia do mês, sem ajuste automático de dia útil.
                </p>
                <div className="grid sm:grid-cols-2 gap-3">
                  {field(
                    "Início",
                    <input
                      className={cls}
                      type="month"
                      value={rule.start}
                      onChange={(e) =>
                        edit(() => setRule({ ...rule, start: e.target.value }))
                      }
                    />,
                  )}
                  {field(
                    "Fim",
                    <input
                      className={cls}
                      type="month"
                      value={rule.end}
                      onChange={(e) =>
                        edit(() => setRule({ ...rule, end: e.target.value }))
                      }
                    />,
                  )}
                  {field(
                    "Dia de vencimento",
                    <input
                      className={cls}
                      type="number"
                      min="1"
                      max="31"
                      value={rule.day}
                      onChange={(e) =>
                        edit(() =>
                          setRule({ ...rule, day: Number(e.target.value) }),
                        )
                      }
                    />,
                  )}
                  {field(
                    "Valor",
                    <select
                      className={cls}
                      value={rule.mode}
                      onChange={(e) =>
                        edit(() => setRule({ ...rule, mode: e.target.value }))
                      }
                    >
                      <option value="fixed">
                        Fixo — valor da conta original
                      </option>
                      <option value="variable">
                        Variável — informar a cada competência
                      </option>
                    </select>,
                  )}
                </div>
                <label>
                  <input
                    type="checkbox"
                    checked={rule.active}
                    onChange={(e) =>
                      edit(() => setRule({ ...rule, active: e.target.checked }))
                    }
                  />{" "}
                  Regra ativa
                </label>
                {field(
                  "Destinatários padrão das novas provisões",
                  <textarea
                    className={cls}
                    value={ruleRecipients}
                    onChange={(e) =>
                      edit(() => setRuleRecipients(e.target.value))
                    }
                  />,
                )}
                <button className={btn} onClick={() => void saveRule()}>
                  Salvar regra e destinatários
                </button>
              </>
            )}
            {tab === "generate" && (
              <>
                {field(
                  "Competência",
                  <input
                    className={cls}
                    type="month"
                    value={month}
                    onChange={(e) => edit(() => setMonth(e.target.value))}
                  />,
                )}
                {rule.mode === "variable" &&
                  field(
                    "Valor confirmado da fatura",
                    <input
                      className={cls}
                      type="number"
                      step="0.01"
                      value={variableAmount}
                      onChange={(e) =>
                        edit(() => setVariableAmount(e.target.value))
                      }
                    />,
                  )}
                <p>
                  A geração é manual e revisada, uma competência por vez.
                  Faturas e comprovantes antigos não são copiados.
                </p>
              </>
            )}
            {tab === "invite" && (
              <>
                {emailField}
                <button
                  className={btn}
                  onClick={() =>
                    void run("invite/settings", { recipients: to() })
                      .then((r) => {
                        if (r) setMessage("Destinatários salvos.");
                      })
                      .catch(() => {})
                  }
                >
                  Salvar destinatários desta conta
                </button>
                {field(
                  "PDF já anexado à conta",
                  <select
                    className={cls}
                    value={invoiceHash}
                    onChange={(e) => edit(() => setInvoiceHash(e.target.value))}
                  >
                    <option value="">Sem seleção</option>
                    {row.attachments
                      ?.filter(
                        (a) =>
                          a.type === "application/pdf" && a.kind === "fatura",
                      )
                      .map((a) => (
                        <option key={a.sha256} value={a.sha256}>
                          {a.name}
                        </option>
                      ))}
                  </select>,
                )}
                {field(
                  "Ou anexar PDF da fatura ao convite",
                  <input
                    type="file"
                    className={fileInputClass}
                    accept="application/pdf"
                    onChange={(e) => void upload(e.target.files?.[0])}
                  />,
                )}
                <div className="flex gap-2">
                  <button className={btn} onClick={() => void invite("ics")}>
                    Baixar INVITE (.ics)
                  </button>
                  <button className={btn} onClick={() => void invite("eml")}>
                    Preparar e-mail com INVITE
                  </button>
                </div>
                <p className="text-sm">
                  O PDF selecionado acompanha o convite e o rascunho de e-mail.
                  Sem PDF selecionado, o convite terá apenas o lembrete. Confira
                  destinatários e envie pelo seu aplicativo de e-mail. O
                  destinatário precisa importar o evento; lembretes e anexos
                  dependem do calendário. Não há envio nem atualização
                  automática após a baixa.
                </p>
              </>
            )}
          </fieldset>
          {review && (
            <div className="border rounded p-3 my-3">
              <strong>
                Revisão —{" "}
                {tab === "payment" ? "baixa na mesma conta" : "nova provisão"}
              </strong>
              <p>
                {tab === "payment"
                  ? `Pagamento de ${brl(Number(payment.amount))} em ${payment.date}, conta ${payment.bankAccount}, forma ${payment.method}.`
                  : `${review.transaction.description}: ${brl(getOriginalAmount(review.transaction))}, vencimento ${review.transaction.dueDate}.`}
              </p>
              {attachment && <p>Anexo: {attachment.name}</p>}
            </div>
          )}
          {tab === "payment" && !isPaid && (
            <button
              className={btn + " mt-3"}
              disabled={busy}
              onClick={() => void settle()}
            >
              {busy
                ? "Processando…"
                : review
                  ? uncertain
                    ? "Consultar/repetir a mesma confirmação"
                    : "Confirmar baixa da conta"
                  : "Revisar pagamento"}
            </button>
          )}
          {tab === "generate" && (
            <button
              className={btn + " mt-3"}
              disabled={busy}
              onClick={() => void generate()}
            >
              {busy
                ? "Processando…"
                : review
                  ? uncertain
                    ? "Consultar/repetir a mesma confirmação"
                    : "Confirmar provisão"
                  : "Revisar provisão"}
            </button>
          )}
          {uncertain && (
            <p className="text-amber-700">
              A confirmação ainda não foi recebida. Repita a mesma tentativa
              acima; não crie outro lançamento.
            </p>
          )}
        </>
      )}
      {message && (
        <p role="status" className="mt-3 text-green-700">
          {message}
        </p>
      )}
      {error && (
        <p role="alert" className="mt-3 text-red-600">
          {error}
        </p>
      )}
    </dialog>
  );
}
