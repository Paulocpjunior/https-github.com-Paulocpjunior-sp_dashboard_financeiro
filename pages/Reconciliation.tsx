import React, { useRef, useState } from "react";
import Layout from "../components/Layout";
import { auth } from "../firebase";
import { downloadCsv } from "../utils/downloadCsv";
interface History {
  at: string;
  userId: string;
  action: string;
  entryId: string;
  transactionId: string;
  reason: string;
}
interface Candidate {
  bankAccount?: string;
  id: string;
  client: string;
  date: string;
  amountCents: number;
  fingerprint: string;
  differenceCents: number;
}
interface Row {
  id: string;
  date: string;
  amountCents: number;
  name: string;
  memo: string;
  bankFingerprint: string;
  stale: boolean;
  candidates: Candidate[];
  link: null | {
    transactionId: string;
    client: string;
    confirmedAt: string;
    confirmedBy: string;
    reason: string;
  };
}
const money = (cents: number) =>
  (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
async function request(path: string, body?: unknown) {
  const token = await auth.currentUser?.getIdToken();
  if (!token) throw new Error("Entre novamente para consultar.");
  const response = await fetch(`/api/itau/reconciliation${path}`, {
    method: body ? "POST" : "GET",
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!response.headers.get("content-type")?.includes("application/json"))
    throw new Error("Conciliação indisponível.");
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Não foi possível concluir.");
  return data;
}
export default function Reconciliation() {
  const today = new Date().toLocaleDateString("en-CA");
  const [start, setStart] = useState(today.slice(0, 8) + "01"),
    [end, setEnd] = useState(today);
  const [rows, setRows] = useState<Row[]>([]),
    [loaded, setLoaded] = useState(false),
    [loading, setLoading] = useState(false),
    [error, setError] = useState("");
  const [filter, setFilter] = useState("all");
  const [history, setHistory] = useState<History[]>([]);
  const [action, setAction] = useState<{
      row: Row;
      candidate?: Candidate;
    } | null>(null),
    [reason, setReason] = useState("");
  const generation = useRef(0);
  const load = async () => {
    const current = ++generation.current;
    setLoading(true);
    setRows([]);
    setLoaded(false);
    setError("");
    try {
      const data = await request(`?start=${start}&end=${end}`);
      if (current === generation.current) {
        setRows(data.rows);
        setHistory(data.history || []);
        setLoaded(true);
      }
    } catch (e) {
      if (current === generation.current) setError((e as Error).message);
    } finally {
      if (current === generation.current) setLoading(false);
    }
  };
  const changeDates = (setter: (v: string) => void, value: string) => {
    generation.current++;
    setter(value);
    setRows([]);
    setLoaded(false);
    setLoading(false);
    setAction(null);
  };
  const status = (row: Row) =>
    row.stale
      ? "Revisar alteração"
      : row.link
        ? "Conciliado"
        : row.candidates.some((c) => c.differenceCents !== 0)
          ? "Divergência para revisão"
          : row.candidates.length > 1
            ? "Múltiplas sugestões"
            : row.candidates.length
              ? "Sugestão para revisão"
              : "Sem correspondência";
  const visible = rows.filter(
    (row) =>
      filter === "all" ||
      (filter === "done" ? !!row.link && !row.stale : !row.link || row.stale),
  );
  const confirm = async () => {
    if (!action) return;
    setLoading(true);
    setError("");
    try {
      await request("", {
        action: action.candidate ? "confirm" : "undo",
        entryId: action.row.id,
        transactionId: action.candidate?.id,
        bankFingerprint: action.row.bankFingerprint,
        sourceFingerprint: action.candidate?.fingerprint,
        reason,
      });
      setAction(null);
      setReason("");
      await load();
    } catch (e) {
      setError((e as Error).message);
      setLoading(false);
    }
  };
  return (
    <Layout>
      <div className="space-y-5">
        <h1 className="text-2xl font-bold">Conciliação bancária</h1>
        <p>
          Compare o OFX importado com lançamentos por vencimento ou pagamento no
          período. Sugestões usam valor e proximidade de até 3 dias; confirme a
          identidade na fonte. Lançamentos fora do período e pagamentos
          agrupados exigem revisão separada.
        </p>
        <p className="rounded border border-blue-200 bg-blue-50 p-3 text-blue-900">
          A confirmação registra apenas o vínculo de conferência. Não altera
          valores, situação ou datas dos lançamentos.
        </p>
        <div className="flex flex-wrap gap-3 items-center">
          <label>
            De{" "}
            <input
              type="date"
              value={start}
              disabled={!!action}
              onChange={(e) => changeDates(setStart, e.target.value)}
            />
          </label>
          <label>
            Até{" "}
            <input
              type="date"
              value={end}
              disabled={!!action}
              onChange={(e) => changeDates(setEnd, e.target.value)}
            />
          </label>
          <button
            className="border rounded p-2"
            disabled={loading || !!action}
            onClick={load}
          >
            {loading ? "Consultando…" : "Consultar"}
          </button>
          <select
            aria-label="Filtrar conciliação"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          >
            <option value="all">Todos</option>
            <option value="pending">Pendências</option>
            <option value="done">Conciliados</option>
          </select>
          <button
            className="border rounded p-2"
            disabled={!loaded || loading}
            onClick={() =>
              downloadCsv(`conciliacao-${start}-${end}.csv`, [
                [
                  "Data",
                  "Histórico bancário",
                  "Valor",
                  "Situação",
                  "Lançamento",
                  "Cliente",
                  "Conferido por",
                  "Conferido em",
                  "Justificativa",
                ],
                ...visible.map((r) => [
                  r.date,
                  `${r.name} ${r.memo}`,
                  r.amountCents / 100,
                  status(r),
                  r.link?.transactionId || "",
                  r.link?.client || "",
                  r.link?.confirmedBy || "",
                  r.link?.confirmedAt || "",
                  r.link?.reason || "",
                ]),
              ])
            }
          >
            Exportar relatório
          </button>
        </div>
        {error && (
          <p role="alert" className="text-red-700">
            {error}
          </p>
        )}
        {loaded && (
          <p>
            {rows.length} movimentações ·{" "}
            {rows.filter((r) => r.link && !r.stale).length} conciliadas ·{" "}
            {rows.filter((r) => !r.link || r.stale).length} pendentes
          </p>
        )}
        {loaded && !visible.length && (
          <p>
            Nenhuma movimentação para este filtro. Importe o OFX no menu Extrato
            Itaú ou ajuste o período.
          </p>
        )}
        <div className="space-y-3">
          {visible.map((row) => (
            <article
              key={row.id}
              className="border rounded p-4 bg-white dark:bg-slate-900"
            >
              <div className="font-semibold">
                {row.date} · {money(row.amountCents)} · {status(row)}
              </div>
              <p>
                {row.name} {row.memo}
              </p>
              {row.link ? (
                <div className="mt-2">
                  <p>
                    Vínculo: {row.link.client} · {row.link.transactionId}
                  </p>
                  <p className="text-sm">
                    {row.link.reason} ·{" "}
                    {new Date(row.link.confirmedAt).toLocaleString("pt-BR")}
                  </p>
                  <button
                    className="underline"
                    disabled={loading}
                    onClick={() => {
                      setAction({ row });
                      setReason("");
                    }}
                  >
                    Desfazer vínculo
                  </button>
                </div>
              ) : (
                row.candidates.map((c) => (
                  <div
                    key={c.id}
                    className="mt-2 border-t pt-2 flex flex-wrap gap-3 items-center"
                  >
                    <span>
                      {c.client} · {c.date} · {money(c.amountCents)} · {c.id} ·
                      Conta informada: {c.bankAccount || "não informada"}
                    </span>
                    {c.differenceCents !== 0 ? (
                      <span className="text-amber-700">
                        Diferença: {money(c.differenceCents)} — revisar na fonte
                      </span>
                    ) : (
                      <button
                        className="border rounded p-2"
                        disabled={loading}
                        onClick={() => {
                          setAction({ row, candidate: c });
                          setReason("");
                        }}
                      >
                        Conferir correspondência
                      </button>
                    )}
                  </div>
                ))
              )}
            </article>
          ))}
        </div>
        {loaded && (
          <details className="border rounded p-4">
            <summary>Histórico de conferências ({history.length})</summary>
            <button
              className="underline my-3"
              onClick={() =>
                downloadCsv(`historico-conciliacao-${start}-${end}.csv`, [
                  [
                    "Data da ação",
                    "Usuário",
                    "Ação",
                    "Movimentação",
                    "Lançamento",
                    "Justificativa",
                  ],
                  ...history.map((h) => [
                    h.at,
                    h.userId,
                    h.action,
                    h.entryId,
                    h.transactionId,
                    h.reason,
                  ]),
                ])
              }
            >
              Exportar histórico
            </button>
            {history.map((h, i) => (
              <p key={i} className="text-sm py-2 border-t">
                {new Date(h.at).toLocaleString("pt-BR")} ·{" "}
                {h.action === "confirm" ? "Confirmado" : "Desfeito"} ·{" "}
                {h.transactionId} · {h.reason} · Usuário: {h.userId}
              </p>
            ))}
          </details>
        )}
        {action && (
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Conferir vínculo"
            className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4"
          >
            <div className="bg-white text-slate-900 rounded p-6 max-w-xl space-y-4">
              <h2 className="font-bold">
                {action.candidate
                  ? "Confirmar correspondência"
                  : "Desfazer conciliação"}
              </h2>
              <p>
                Banco: {action.row.date} · {money(action.row.amountCents)} ·{" "}
                {action.row.name} {action.row.memo}
              </p>
              {action.candidate && (
                <p>
                  Lançamento: {action.candidate.client} ·{" "}
                  {action.candidate.date} ·{" "}
                  {money(action.candidate.amountCents)} · {action.candidate.id}{" "}
                  · Conta informada:{" "}
                  {action.candidate.bankAccount || "não informada"}
                </p>
              )}
              <label className="block">
                Justificativa da conferência
                <textarea
                  className="block border w-full p-2"
                  value={reason}
                  maxLength={500}
                  onChange={(e) => setReason(e.target.value)}
                />
              </label>
              {error && (
                <p role="alert" className="text-red-700">
                  {error}
                </p>
              )}
              <div className="flex gap-4">
                <button disabled={loading} onClick={() => setAction(null)}>
                  Cancelar
                </button>
                <button
                  className="bg-blue-700 text-white rounded p-2"
                  disabled={loading || reason.trim().length < 5}
                  onClick={confirm}
                >
                  Confirmar {action.candidate ? "vínculo" : "desfazimento"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}
