import React, { useEffect, useState } from "react";
import { auth } from "../firebase";
type Candidate = {
  id: string;
  name: string;
  cpfCnpj: string;
  dueDate: string;
  amountCents: number;
  bankAccount: string;
  status: string;
  reference: string;
  differences: string[];
};
type Decision = {
  state: string;
  reason: string;
  payment?: { date: string; cents: number };
};
type Preview = { previewId: string; row: Candidate; decision: Decision };
type Result = {
  rows: Candidate[];
  truncated: boolean;
  link: null | {
    transactionId: string;
    state: string;
    reason: string;
    confirmedAt: string;
    checkedAt: string;
  };
};
const money = (n: number) =>
  (n / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const date = (s: string) => (s ? s.split("-").reverse().join("/") : "—");
const button =
  "rounded-lg bg-blue-700 px-4 py-2 text-white font-semibold disabled:opacity-40";
export default function BoletoReconciliation({
  boletoId,
}: {
  boletoId: string;
}) {
  const [result, setResult] = useState<Result | null>(null),
    [preview, setPreview] = useState<Preview | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [confirmed, setConfirmed] = useState(""),
    [transactionId, setTransactionId] = useState("");
  async function request(operation: string, body?: object) {
    const user = auth.currentUser;
    if (!user) throw Error("Entre novamente.");
    const response = await fetch(
      `/api/boleto-cloud/history/${boletoId}/${operation}`,
      {
        method: body ? "POST" : "GET",
        headers: {
          Authorization: `Bearer ${await user.getIdToken()}`,
          "Content-Type": "application/json",
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      },
    );
    const data = await response.json();
    if (!response.ok) throw Error(data.error || "Conciliação indisponível.");
    return data;
  }
  useEffect(() => {
    let live = true;
    setBusy(true);
    request("reconcile")
      .then((data) => {
        if (live) setResult(data);
      })
      .catch((e) => {
        if (live) setError(e.message);
      })
      .finally(() => {
        if (live) setBusy(false);
      });
    return () => {
      live = false;
    };
  }, [boletoId]);
  async function review(id: string) {
    setBusy(true);
    setError("");
    setPreview(null);
    try {
      setPreview(await request("reconcile-preview", { transactionId: id }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível revisar.");
    } finally {
      setBusy(false);
    }
  }
  async function confirm() {
    if (!preview) return;
    setBusy(true);
    setError("");
    try {
      const data = await request("reconcile-confirm", {
        previewId: preview.previewId,
      });
      setConfirmed(
        data.state === "settled" || data.state === "ready"
          ? "Vínculo confirmado e baixa bancária registrada."
          : data.reason,
      );
      setPreview(null);
      setResult(await request("reconcile"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Confirmação indisponível.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      aria-label="Conciliar boleto antigo"
      className="border-t border-slate-500 pt-4 space-y-4"
    >
      <h3 className="font-bold text-lg">Conciliar boleto antigo</h3>
      <p className="text-sm">
        Escolha o lançamento existente em Contas a Receber e revise o retorno da
        API. A confirmação autoriza a baixa integral quando o banco informar o
        pagamento. Nenhuma receita nova será criada.
      </p>
      {busy && <p role="status">Conferindo dados…</p>}
      {error && (
        <p role="alert" className="text-red-600 dark:text-red-300">
          {error}
        </p>
      )}
      {confirmed && (
        <p role="status" className="text-green-700 dark:text-green-300">
          {confirmed}
        </p>
      )}
      {result?.link ? (
        <div>
          <p className="font-semibold">Vínculo confirmado</p>
          <p>Lançamento: {result.link.transactionId}</p>
          <p>{result.link.reason}</p>
          <p className="text-xs">
            Conferido em{" "}
            {new Date(result.link.checkedAt).toLocaleString("pt-BR")}
          </p>
        </div>
      ) : (
        !confirmed && (
          <>
            {result && !preview && (
              <>
                <p className="text-sm">
                  Sugestões com o mesmo vencimento e CPF/CNPJ ou valor. A
                  seleção exige sua conferência da referência da cobrança.
                </p>
                {result.truncated && (
                  <p role="status">
                    Exibindo parte dos lançamentos desse vencimento. Use o
                    identificador abaixo para conferir um lançamento específico.
                  </p>
                )}
                {!result.rows.length && (
                  <p>
                    Nenhum candidato encontrado. O boleto permanece sem vínculo.
                  </p>
                )}
                {result.rows.map((row) => (
                  <div
                    key={row.id}
                    className="rounded-lg border border-slate-400 p-3 space-y-1"
                  >
                    <p className="font-semibold">
                      {row.name} · {money(row.amountCents)}
                    </p>
                    <p className="text-sm">
                      CPF/CNPJ: {row.cpfCnpj || "Ausente"} · Vencimento:{" "}
                      {date(row.dueDate)} · {row.status}
                    </p>
                    <p className="text-sm">
                      {row.bankAccount} · Referência: {row.reference}
                    </p>
                    <p className="text-xs break-all">Identificador: {row.id}</p>
                    {row.differences.map((x) => (
                      <p
                        key={x}
                        className="text-amber-700 dark:text-amber-300 text-sm"
                      >
                        {x}
                      </p>
                    ))}
                    <button
                      className={button}
                      disabled={busy || !!row.differences.length}
                      onClick={() => review(row.id)}
                    >
                      Revisar este lançamento
                    </button>
                  </div>
                ))}
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    review(transactionId.trim());
                  }}
                  className="space-y-2"
                >
                  <label className="block text-sm">
                    Identificador de outro lançamento
                    <input
                      className="block w-full rounded border border-slate-500 bg-transparent p-2"
                      value={transactionId}
                      onChange={(e) => setTransactionId(e.target.value)}
                    />
                  </label>
                  <button
                    className={button}
                    disabled={busy || !transactionId.trim()}
                  >
                    Conferir identificador
                  </button>
                </form>
              </>
            )}
            {preview && (
              <div className="rounded-lg border-2 border-blue-500 p-4 space-y-3">
                <h4 className="font-bold">Revisão antes da confirmação</h4>
                <p>
                  {preview.row.name} · {money(preview.row.amountCents)} ·{" "}
                  {date(preview.row.dueDate)}
                </p>
                <p>
                  CPF/CNPJ: {preview.row.cpfCnpj} · Referência:{" "}
                  {preview.row.reference}
                </p>
                <p>{preview.decision.reason}</p>
                {preview.decision.payment && (
                  <p>
                    Banco confirmou {money(preview.decision.payment.cents)} em{" "}
                    {date(preview.decision.payment.date)}.
                  </p>
                )}
                {preview.decision.state !== "review" && (
                  <button className={button} disabled={busy} onClick={confirm}>
                    {preview.decision.state === "ready"
                      ? "Confirmar vínculo e baixa"
                      : preview.decision.state === "already-paid"
                        ? "Confirmar vínculo sem nova baixa"
                        : "Confirmar vínculo e baixa futura automática"}
                  </button>
                )}
                <button
                  className="ml-3 underline"
                  disabled={busy}
                  onClick={() => setPreview(null)}
                >
                  Cancelar revisão
                </button>
              </div>
            )}
          </>
        )
      )}
    </section>
  );
}
