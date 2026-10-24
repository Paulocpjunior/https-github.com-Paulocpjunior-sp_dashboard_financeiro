import React, { useEffect, useRef, useState } from "react";
import WixLockOverride, { WixLockInvoice } from "./WixLockOverride";
import { AuthService } from "../services/authService";
import { isMasterAccount } from "../utils/masterAccount";
import { X, Loader2 } from "lucide-react";
import { auth } from "../firebase";
import { Transaction } from "../types";
import { getOriginalAmount } from "../utils/transactionAmounts";
import { PossibleDuplicateScan } from "../utils/transactionTable";
import BoletoBatchIssue from "./BoletoBatchIssue";
import { boletoStatusLabel, useBoletoIssueStatus } from "../services/boletoIssueStatus";
import { BillingAddress, saveBillingAddress } from "../services/billingAddressService";
import BoletoDeliveryStatus from "./BoletoDeliveryStatus";
import "../design-system/tokens.css";
import "./BoletoIssue.css";

const OPEN_STATUSES = ["Pendente", "Agendado", "Vencida"];

type RecordState = {
  environment: string;
  enabled: boolean;
  state: string;
  fields?: Record<string, string>;
  previewHash?: string;
  number?: string;
  error?: string;
  canRecover?: boolean;
  suggestedAddress?: Record<string, string>;
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
  const [mode, setMode] = useState<"single" | "batch">("single");
  const [refresh, setRefresh] = useState(0);
  const openRows = rows.filter((r) => !r.isExcluded && OPEN_STATUSES.includes(r.status));
  const issueStatus = useBoletoIssueStatus(openRows.map((r) => r.id), openRows.length > 0, refresh);
  const [id, setId] = useState("");
  const [record, setRecord] = useState<RecordState | null>(null);
  const [address, setAddress] = useState<Record<string, string>>({});
  const [suggested, setSuggested] = useState<Record<string, string>>({});
  const [saveAddress, setSaveAddress] = useState(true);
  const [addressNote, setAddressNote] = useState("");
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [wixLock, setWixLock] = useState<WixLockInvoice[] | null>(null);
  const [wixReason, setWixReason] = useState("");
  const [justIssued, setJustIssued] = useState("");
  const canOverrideWix = isMasterAccount(AuthService.getCurrentUser());
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
      if (result.wixLock?.invoices) setWixLock(result.wixLock.invoices);
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
    setWixLock(null);
    setWixReason("");
    setAddressNote("");
    if (!id) return;
    setBusy(true);
    request()
      .then((r) => r.json())
      .then((value) => {
        if (current !== generation.current) return;
        setRecord(value);
        const initial = Object.fromEntries(
          Object.keys(addressFields).map((k) => [
            k,
            value.fields?.[`boleto.pagador.endereco.${k}`] || value.suggestedAddress?.[k] || row?.nativeEntry?.address?.[k] || "",
          ]),
        );
        setAddress(initial);
        setSuggested(initial);
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
      const wixOverride = wixLock && canOverrideWix && wixReason.trim() ? { wixOverride: { reason: wixReason.trim() } } : {};
      const body =
        action === "preview"
          ? { address, ...wixOverride }
          : ["issue", "recover"].includes(action)
            ? { previewHash: record?.previewHash, legacyChecked: checked, ...wixOverride }
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
        const next = await response.json();
        setRecord(next);
        // Emitido agora: envia ao cliente pelos meios da Regra de faturamento.
        if (["issue", "recover"].includes(action) && next.state === "issued") setJustIssued(id);
        setChecked(false);
        // Endereço digitado na revisão vai para o cadastro do cliente, com log, para os próximos boletos e o lote.
        const changed = Object.keys(addressFields).some((k) => (address[k] || "").trim() !== (suggested[k] || "").trim());
        if (action === "preview" && saveAddress && changed) {
          saveBillingAddress(id, address as BillingAddress, "emissao-individual")
            .then(() => { setSuggested(address); setAddressNote("Endereço salvo no cadastro do cliente."); })
            .catch((e) => setAddressNote(`Endereço não salvo no cadastro: ${e instanceof Error ? e.message : "erro"}`));
        }
        if (["issue", "recover"].includes(action)) setRefresh((n) => n + 1);
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
  const button = "sp-button";
  const primary = "sp-button sp-button-primary";
  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="boleto-title"
        className="sp-ui sp-boleto-dialog w-full max-w-3xl max-h-[90vh] overflow-auto p-6 space-y-4"
      >
        <div className="sp-boleto-header">
          <h2 id="boleto-title">
            Emissão Boleto Cloud
          </h2>
          <button type="button" className="sp-boleto-close" aria-label="Fechar" disabled={busy} onClick={onClose}>
            <X className="sp-icon" aria-hidden="true" />
          </button>
        </div>
        <p className="text-sm sp-muted">
          Conta Itaú — agência 3145, conta 99791-6. Selecione uma cobrança para
          revisar ou consultar a emissão, ou emita várias em lote pelos filtros.
        </p>
        <div role="tablist" aria-label="Modo de emissão" className="sp-boleto-tabs">
          {([["single", "Uma cobrança"], ["batch", "Em lote"]] as const).map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={mode === value}
              disabled={busy}
              className="sp-button"
              onClick={() => setMode(value)}
            >
              {label}
            </button>
          ))}
        </div>
        {issueStatus.loading && (
          <p role="status" className="text-sm flex gap-2"><Loader2 className="animate-spin h-4 w-4" />Conferindo boletos já emitidos…</p>
        )}
        {issueStatus.error && (
          <p role="alert" className="text-sm sp-boleto-notice">Situação da 1ª via indisponível: {issueStatus.error} A trava no servidor continua valendo.</p>
        )}
        {!issueStatus.historyAvailable && (
          <p role="alert" className="text-sm sp-boleto-notice">Histórico do painel Boleto Cloud indisponível: só as emissões feitas pelo app estão marcadas. A emissão fica bloqueada até o histórico voltar.</p>
        )}
        {mode === "batch" ? (
          <BoletoBatchIssue rows={openRows} status={issueStatus.items} duplicates={duplicates} onChanged={() => setRefresh((n) => n + 1)} />
        ) : (<>
        <label className="block">
          Cobrança
          <select
            className="sp-field"
            value={id}
            disabled={busy}
            onChange={(e) => setId(e.target.value)}
          >
            <option value="">Selecione</option>
            {rows.map((r) => {
              const issued = boletoStatusLabel(issueStatus.items[r.id]);
              return (
                <option key={r.id} value={r.id}>
                  {issued ? `[${issued.toUpperCase()}] ` : ""}
                  {r.client} — {r.dueDate} — {currency(getOriginalAmount(r))} —{" "}
                  {r.id}
                </option>
              );
            })}
          </select>
        </label>
        {busy && (
          <p role="status" className="flex gap-2">
            <Loader2 className="animate-spin" />
            Processando…
          </p>
        )}
        {error && (
          <p role="alert" className="sp-boleto-error">
            {error}
          </p>
        )}
        {wixLock && (
          <WixLockOverride invoices={wixLock} canOverride={canOverrideWix} reason={wixReason} onReason={setWixReason} disabled={busy} />
        )}
        {row && record && (
          <>
            <p>
              <span className="sp-boleto-env" data-env={record.environment}>
                {record.environment === "production"
                  ? "PRODUÇÃO — boletos reais, sujeitos a tarifas"
                  : "SANDBOX — boletos de teste, sem valor"}
              </span>
            </p>
            {!record.enabled && (
              <p className="sp-boleto-notice">
                Emissão aguardando habilitação e credenciais no servidor. A
                revisão pode ser preparada.
              </p>
            )}
            <p>
              {labels[record.state] || record.state}
              {record.number && ` · Nosso número: ${record.number}`}
            </p>
            {record.error && <p role="alert" className="sp-boleto-error">{record.error}</p>}
            {record.state !== "issued" && issueStatus.items[row.id]?.status === "issued" && (
              <p className="sp-boleto-danger font-semibold">
                {boletoStatusLabel(issueStatus.items[row.id])}. Não emita de novo; use o histórico Boleto Cloud para a 2ª via.
              </p>
            )}
            {duplicate && (
              <p className="sp-boleto-danger">
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
                <div className="grid grid-cols-2 gap-3 sp-boleto-address">
                  {Object.entries(addressFields).map(([key, label]) => (
                    <label key={key}>
                      {label}
                      <input
                        className="sp-field"
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
                <label className="flex gap-2 text-sm">
                  <input type="checkbox" checked={saveAddress} disabled={busy} onChange={(e) => setSaveAddress(e.target.checked)} />
                  Salvar este endereço no cadastro do cliente (vale para o lote e os próximos boletos)
                </label>
                <button
                  className={primary}
                  disabled={busy || Boolean(duplicate)}
                  onClick={() => perform("preview")}
                >
                  Revisar cobrança
                </button>
                {addressNote && <p role="status" className="text-sm">{addressNote}</p>}
              </>
            )}
            {record.state === "draft" && (
              <div className="sp-boleto-panel space-y-3">
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
                  className={primary}
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
              <div className="flex flex-wrap gap-2">
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
                <p className="text-sm sp-muted w-full">
                  Aguarde um minuto. A recuperação consulta o identificador
                  original no Boleto Cloud e não reenvia a emissão.
                </p>
              </div>
            )}
            {record.state === "issued" && (
              <div className="space-y-3">
                <div className="flex flex-wrap gap-2">
                  <button
                    className={primary}
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
                <div className="sp-boleto-panel space-y-2">
                  <p className="font-semibold">Envio ao cliente (INVITE com o PDF do boleto)</p>
                  <BoletoDeliveryStatus id={id} auto={justIssued === id} />
                </div>
                <div className="flex flex-wrap gap-2">
                  <button className={button} disabled={busy} onClick={() => perform("invite")}>Baixar INVITE com PDF (.ics)</button>
                  <button className={button} disabled={busy} onClick={() => perform("invite-email")}>Preparar e-mail com INVITE e PDF</button>
                </div>
                <p className="text-sm sp-muted">O cliente precisa importar o convite na agenda. Inclui o vencimento e lembrete na véspera; o calendário controla os avisos. O PDF fica dentro do convite e separado no e-mail preparado. Alguns calendários não exibem anexos. O envio ao cliente usa o e-mail e o WhatsApp da Regra de faturamento e acontece uma vez por canal, depois que o banco confirma o registro; reenviar pede motivo. O rascunho (.eml) continua disponível para envio manual. Após pagamento ou cancelamento, remova o evento da agenda.</p>
                <p>
                  {!record.registration
                    ? "Registro bancário ainda não consultado."
                    : record.registration.rejected
                      ? "Registro rejeitado pelo banco. Consulte o painel Boleto Cloud."
                      : record.registration.registeredAt
                        ? `Registrado em ${record.registration.registeredAt}`
                        : "Aguardando confirmação de registro."}
                </p>
                <p className="text-sm sp-muted">
                  Emitir não marca a cobrança como paga e não confirma entrega
                  ao cliente.
                </p>
              </div>
            )}
          </>
        )}
        </>)}
      </section>
    </div>
  );
}
