import React, { useEffect, useMemo, useState } from "react";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { db } from "../services/firebaseConfig";
import Layout from "../components/Layout";
import DataTable from "../components/DataTable";
import { Transaction } from "../types";
import { AuthService } from "../services/authService";
import { hasFinancialPermission } from "../utils/financialPermissions";
import {
  getOriginalAmount,
  getOutstandingAmount,
  isPaidStatus,
} from "../utils/transactionAmounts";
import {
  sortTransactions,
  TransactionSortField,
  TransactionSortDirection,
} from "../utils/transactionTable";
import { downloadCsv } from "../utils/downloadCsv";

export default function Receivables() {
  const [rows, setRows] = useState<Transaction[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("open");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [page, setPage] = useState(1);
  const [sortField, setSortField] = useState<TransactionSortField>("dueDate");
  const [direction, setDirection] = useState<TransactionSortDirection>("asc");
  useEffect(
    () =>
      onSnapshot(
        query(
          collection(db, "transactions"),
          where("movement", "==", "Entrada"),
          where("type", "==", "Entrada de Caixa / Contas a Receber"),
        ),
        (snapshot) => {
          setRows(
            snapshot.docs
              .map((d) => ({ ...d.data(), id: d.id }) as Transaction)
              .filter((t) => !t.isExcluded),
          );
          setLoading(false);
          setError("");
        },
        () => {
          setRows([]);
          setLoading(false);
          setError(
            "Não foi possível consultar os recebíveis. Verifique seu acesso e atualize a página.",
          );
        },
      ),
    [],
  );
  useEffect(
    () => setPage(1),
    [search, status, start, end, sortField, direction],
  );
  const filtered = useMemo(
    () =>
      sortTransactions(
        rows.filter(
          (t) =>
            (!search ||
              `${t.client} ${t.cpfCnpj || ""} ${t.clientNumber || ""}`
                .toLowerCase()
                .includes(search.toLowerCase())) &&
            (status === "all" ||
              (status === "paid"
                ? isPaidStatus(t.status)
                : !isPaidStatus(t.status))) &&
            (!start || t.dueDate >= start) &&
            (!end || t.dueDate <= end),
        ),
        sortField,
        direction,
      ),
    [rows, search, status, start, end, sortField, direction],
  );
  const money = (v: number) =>
    v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  const pages = Math.max(1, Math.ceil(filtered.length / 50));
  return (
    <Layout>
      <div className="space-y-5">
        <h1 className="text-2xl font-bold">Contas a Receber</h1>
        <p>Consulta e cobrança de clientes. Datas filtradas pelo vencimento.</p>
        {error && (
          <p role="alert" className="text-red-700">
            {error}
          </p>
        )}
        <div className="flex flex-wrap gap-3">
          <input
            aria-label="Buscar cliente"
            placeholder="Cliente, documento ou código"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="border rounded p-2"
          />
          <select
            aria-label="Situação"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="border rounded p-2"
          >
            <option value="open">Em aberto</option>
            <option value="paid">Recebidos</option>
            <option value="all">Todos os recebíveis</option>
          </select>
          <label>
            De{" "}
            <input
              aria-label="Vencimento inicial"
              type="date"
              value={start}
              onChange={(e) => setStart(e.target.value)}
            />
          </label>
          <label>
            Até{" "}
            <input
              aria-label="Vencimento final"
              type="date"
              value={end}
              onChange={(e) => setEnd(e.target.value)}
            />
          </label>
          <button
            className="border rounded p-2"
            onClick={() =>
              downloadCsv("contas-a-receber.csv", [
                ["Cliente", "Documento", "Vencimento", "Situação", "Valor"],
                ...filtered.map((t) => [
                  t.client,
                  t.cpfCnpj || "",
                  t.dueDate,
                  t.status,
                  getOriginalAmount(t),
                ]),
              ])
            }
          >
            Exportar recebíveis
          </button>
        </div>
        <p className="rounded border p-4 font-semibold">
          {filtered.length} recebíveis · Em aberto:{" "}
          {money(
            filtered.reduce(
              (total, t) =>
                total + (isPaidStatus(t.status) ? 0 : getOutstandingAmount(t)),
              0,
            ),
          )}
        </p>
        <DataTable
          data={filtered.slice(
            (Math.min(page, pages) - 1) * 50,
            Math.min(page, pages) * 50,
          )}
          allData={filtered}
          page={Math.min(page, pages)}
          totalPages={pages}
          onPageChange={setPage}
          isLoading={loading}
          isReceivablesMode
          selectedType="Entrada de Caixa / Contas a Receber"
          canExportBoletoCloud={hasFinancialPermission(
            AuthService.getCurrentUser(),
            "billing.boleto-cloud.issue",
          )}
          sortField={sortField}
          sortDirection={direction}
          onSortChange={(f, d) => {
            setSortField(f);
            setDirection(d);
          }}
        />
      </div>
    </Layout>
  );
}
