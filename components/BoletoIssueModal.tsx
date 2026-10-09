import React, { useEffect, useRef, useState } from "react";
import { X, Loader2 } from "lucide-react";
import { auth } from "../firebase";
import { Transaction } from "../types";
import { getOriginalAmount } from "../utils/transactionAmounts";
import { PossibleDuplicateScan } from "../utils/transactionTable";

type RecordState = {
  environment: string;
  enabled: boolean;
  state: string;
  fields?: Record<string, string>;
  previewHash?: string;
  number?: string;
  error?: string;
  canRecover?: boolean;
  registration?: {
    registeredAt: string | null;
    rejected: boolean;
    checkedAt: string;
  };
};
const addressFields = {
  cep: "CEP",
  uf: "UF",
  localidade: "Cidade",
  bairro: "Bairro",
  logradouro: "Logradouro",
  numero: "Número",
  complemento: "Complemento (opcional)",
};
const labels: Record<string, string> = {
  new: "Não emitido",
  draft: "Revisão pronta",
  issuing: "Emissão em andamento ou aguardando confirmação",
  unknown: "Resultado não confirmado",
  issued: "Boleto criado — confira o registro bancário",
  rejected: "Emissão recusada",
};
export default function BoletoIssueModal({
  rows,
  duplicates,
  onClose,
}: {
  rows: Transaction[];
  duplicates?: PossibleDuplicateScan;
  onClose: () => void;
}) {
  const [id, setId] = useState("");
  const [record, setRecord] = useState<RecordState | null>(null);
  const [address, setAddress] = useState<Record<string, string>>({});
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const generation = useRef(0);
  const row = rows.find((r) => r.id === id);
  async function request(action = "", body?: unknown) {
    const user = auth.currentUser;
    if (!user) throw new Error("Entre novamente para continuar.");
    const response = await fetch(
      `/api/boleto-cloud/items/${encodeURIComponent(id)}${action ? `/${action}` : ""}`,
      {
        method: body === undefined ? "GET" : "POST",
        headers: {
          Authorization: `Bearer ${await user.getIdToken()}`,
          "Content-Type": "application/json",
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      },
    );
    if (!response.ok) {
      const result = await response.json();
      throw new Error(result.error || "Não foi possível concluir.");
    }
    return response;
  }
  useEffect(() => {
    const current = ++generation.current;
    setRecord(null);
    setError("");
    setChecked(false);
    setAddress({});
    if (!id) return;
    setBusy(true);
    request()
      .then((r) => r.json())
      .then((value) => {
        if (current !== generation.current) return;
        setRecord(value);
        setAddress(
          Object.fromEntries(
            Object.keys(addressFields).map((k) => [
              k,
              value.fields?.[`boleto.pagador.endereco.${k}`] || row?.nativeEntry?.address?.[k] || "",
            ]),
          ),
        );
      })
      .catch((e) => {
        if (current === generation.current) setError(e.message);
      })
      .finally(() => {
        if (current === generation.current) setBusy(false);
      });
    return () => {
      generation.current++;
    };
  }, [id]);
  async function perform(action: string) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const body =
        action === "preview"
          ? { address }
          : ["issue", "recover"].includes(action)
            ? { previewHash: record?.previewHash, legacyChecked: checked }
            : undefined;
      const response = await request(action, body);
      if (["pdf", "invite", "invite-email"].includes(action)) {
        const url = URL.createObjectURL(await response.blob());
        const a = document.createElement("a");
        a.href = url;
        a.download = `boleto-${record?.number || "cobranca"}.${action === "invite" ? "ics" : action === "invite-email" ? "eml" : "pdf"}`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      } else {
        setRecord(await response.json());
        setChecked(false);
      }
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Operação não confirmada. Consulte antes de repetir.",
      );
    } finally {
      setBusy(false);
    }
  }
  const duplicate = row && duplicates?.byTransactionId.has(row.id);
  const editable =
    !record || ["new", "draft", "rejected"].includes(record.state);
  const currency = (n: number) =>
    n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  const button =
    "px-4 py-2 rounded-lg bg-emerald-700 text-white disabled:opacity-40 disabled:cursor-not-allowed";
  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="boleto-title"
        className="bg-white dark:bg-slate-900 text-slate-900 dark:text-white rounded-xl w-full max-w-3xl max-h-[90vh] overflow-auto p-6 space-y-4"
      >
        <div className="flex justify-between">
          <h2 id="boleto-title" className="text-lg font-bold">
            Emissão Boleto Cloud
          </h2>
          <button aria-label="Fechar" disabled={busy} onClick={onClose}>
            <X />
          </button>
        </div>
        <p className="text-sm">
          Conta Itaú — agência 3145, conta 99791-6. Selecione uma cobrança para
          revisar ou consultar a emissão.
        </p>
        <label className="block">
          Cobrança
          <select
            className="block w-full border rounded p-2 bg-white dark:bg-slate-800"
            value={id}
            disabled={busy}
            onChange={(e) => setId(e.target.value)}
          >
            <option value="">Selecione</option>
            {rows.map((r) => (
              <option key={r.id} value={r.id}>
                {r.client} — {r.dueDate} — {currency(getOriginalAmount(r))} —{" "}
                {r.id}
              </option>
            ))}
          </select>
        </label>
        {busy && (
          <p role="status" className="flex gap-2">
            <Loader2 className="animate-spin" />
            Processando…
          </p>
        )}
        {error && (
          <p role="alert" className="bg-red-50 text-red-800 p-3 rounded">
            {error}
          </p>
        )}
        {row && record && (
          <>
            <p className="font-semibold">
              {record.environment === "production"
                ? "PRODUÇÃO — boletos reais, sujeitos a tarifas"
                : "SANDBOX — boletos de teste, sem valor"}
            </p>
            {!record.enabled && (
              <p className="text-amber-700">
                Emissão aguardando habilitação e credenciais no servidor. A
                revisão pode ser preparada.
              </p>
            )}
            <p>
              {labels[record.state] || record.state}
              {record.number && ` · Nosso número: ${record.number}`}
            </p>
            {record.error && <p role="alert">{record.error}</p>}
            {duplicate && (
              <p className="text-red-700">
                Há indício de duplicidade neste lançamento. Revise antes de
                emitir.
              </p>
            )}
            <p>
              {row.client} · CPF/CNPJ: {row.cpfCnpj || "ausente"} ·{" "}
              {currency(getOriginalAmount(row))} · Vencimento: {row.dueDate}
            </p>
            {editable && (
              <>
                <p className="text-sm">
                  Confira o endereço do pagador. Para corrigir nome, documento,
                  valor ou vencimento, atualize a cobrança na origem.
                </p>
                <div className="grid grid-cols-2 gap-3">
                  {Object.entries(addressFields).map(([key, label]) => (
                    <label key={key}>
                      {label}
                      <input
                        className="block border rounded w-full p-2 bg-white dark:bg-slate-800"
                        value={address[key] || ""}
                        maxLength={120}
                        disabled={busy}
                        onChange={(e) => {
                          setAddress({ ...address, [key]: e.target.value });
                          setRecord({
                            ...record,
                            state: "new",
                            previewHash: undefined,
                          });
                          setChecked(false);
                        }}
                      />
                    </label>
                  ))}
                </div>
                <button
                  className={button}
                  disabled={busy || Boolean(duplicate)}
                  onClick={() => perform("preview")}
                >
                  Revisar cobrança
                </button>
              </>
            )}
            {record.state === "draft" && (
              <div className="border rounded p-3 space-y-3">
                <p>
                  Dados confirmados para emissão: {record.fields?.["boleto.pagador.nome"]}{" "}
                  · {currency(Number(record.fields?.["boleto.valor"] || 0))} · Vencimento{" "}
                  {record.fields?.["boleto.vencimento"]}
                </p>
                <label className="flex gap-2">
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={busy}
                    onChange={(e) => setChecked(e.target.checked)}
                  />
                  Conferi no Boleto Cloud que esta cobrança não foi emitida
                  anteriormente pelo painel ou por importação CSV.
                </label>
                <button
                  className={button}
                  disabled={
                    busy || !checked || !record.enabled || Boolean(duplicate)
                  }
                  onClick={() => perform("issue")}
                >
                  {record.environment === "production"
                    ? "Confirmar emissão real"
                    : "Emitir no Sandbox"}
                </button>
              </div>
            )}
            {["unknown", "issuing"].includes(record.state) && (
              <div className="space-x-2">
                <button
                  className={button}
                  disabled={busy}
                  onClick={() => perform("")}
                >
                  Atualizar consulta
                </button>
                <button
                  className={button}
                  disabled={busy || !record.canRecover || !record.enabled}
                  onClick={() => perform("recover")}
                >
                  Recuperar tentativa
                </button>
                <p className="text-sm">
                  Aguarde um minuto. A recuperação consulta o identificador
                  original no Boleto Cloud e não reenvia a emissão.
                </p>
              </div>
            )}
            {record.state === "issued" && (
              <div className="space-y-3">
                <div className="flex flex-wrap gap-2">
                  <button
                    className={button}
                    disabled={busy}
                    onClick={() => perform("pdf")}
                  >
                    Baixar PDF
                  </button>
                  <button
                    className={button}
                    disabled={busy}
                    onClick={() => perform("registration")}
                  >
                    Consultar registro no Itaú
                  </button>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button className={button} disabled={busy} onClick={() => perform("invite")}>Baixar INVITE com PDF (.ics)</button>
                  <button className={button} disabled={busy} onClick={() => perform("invite-email")}>Preparar e-mail com INVITE e PDF</button>
                </div>
                <p className="text-sm">O cliente precisa importar o convite na agenda. Inclui o vencimento e lembrete na véspera; o calendário controla os avisos. O PDF fica dentro do convite e separado no e-mail preparado. Alguns calendários não exibem anexos. O e-mail é um rascunho (.eml): escolha o destinatário e envie no seu aplicativo de e-mail. Nenhum envio é automático. Após pagamento ou cancelamento, remova o evento da agenda.</p>
                <p>
                  {!record.registration
                    ? "Registro bancário ainda não consultado."
                    : record.registration.rejected
                      ? "Registro rejeitado pelo banco. Consulte o painel Boleto Cloud."
                      : record.registration.registeredAt
                        ? `Registrado em ${record.registration.registeredAt}`
                        : "Aguardando confirmação de registro."}
                </p>
                <p className="text-sm">
                  Emitir não marca a cobrança como paga e não confirma entrega
                  ao cliente.
                </p>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}
