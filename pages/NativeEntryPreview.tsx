import React, { useState } from "react";
import NativeEntryModal from "../components/NativeEntryModal";
import catalog from "../cloud-run/pdf-download-service/native-entry-catalog.json";
import { EntryAPI, EntryKind } from "../services/nativeEntryService";
import { Transaction } from "../types";
const saved = new Map<string, Transaction>();
const api: EntryAPI = {
  config: async () => ({
    enabled: true,
    attachmentsEnabled: true,
    catalog,
    clients: [
      {
        id: "demo",
        client: "EMPRESA FICTÍCIA — TESTE LOCAL",
        clientNumber: "DEMO",
        cpfCnpj: "52998224725",
      },
    ],
  }),
  preview: async (id, d, attachments) => ({
    previewHash: "local-only",
    attachments: attachments.map((a) => ({
      ...a,
      size: (a.base64.length * 3) / 4,
    })),
    transaction: {
      id: `demo-${id}`,
      date: d.date,
      dueDate: d.dueDate,
      bankAccount: d.bankAccount,
      type:
        d.kind === "receber"
          ? "Entrada de Caixa / Contas a Receber"
          : "Saída de Caixa / Contas a Pagar",
      movement: d.kind === "receber" ? "Entrada" : "Saída",
      client:
        d.kind === "receber" ? "EMPRESA FICTÍCIA — TESTE LOCAL" : d.category,
      description: d.description,
      paidBy: "Demonstração",
      status: d.paid ? "Pago" : "Pendente",
      valuePaid: 0,
      valueReceived: 0,
      honorarios: Number(d.honorarios || 0),
      extraItems: d.extraItems?.map(item => ({account: item.account, amount: Number(item.amount)})),
      valorOriginal:
        d.kind === "receber"
          ? Number(d.honorarios) + (d.extraItems || []).reduce((sum, item) => sum + Math.round(Number(item.amount) * 100), 0) / 100
          : Number(d.amount),
    },
  }),
  commit: async (id, d, a) => {
    const transaction = (await api.preview(id, d, a)).transaction;
    const replayed = saved.has(id);
    saved.set(id, transaction);
    return { transaction, replayed };
  },
  status: async (id) => ({
    state: saved.has(id) ? "saved" : "not_confirmed",
    transaction: saved.get(id),
  }),
};
export default function NativeEntryPreview() {
  const [kind, setKind] = useState<EntryKind | null>(null);
  return (
    <main className="min-h-screen bg-slate-950 text-white p-10">
      <h1 className="text-3xl font-bold">Lançamentos nativos</h1>
      <p className="mt-3 mb-8">
        Demonstração local. Dados fictícios, sem gravação no Firestore, emissão
        de boleto ou envio de mensagens.
      </p>
      <div className="flex gap-4">
        <button
          className="bg-blue-600 rounded-lg p-3"
          onClick={() => setKind("receber")}
        >
          Nova conta a receber
        </button>
        <button
          className="bg-slate-700 rounded-lg p-3"
          onClick={() => setKind("pagar")}
        >
          Nova conta a pagar
        </button>
      </div>
      {kind && (
        <NativeEntryModal
          simulation
          kind={kind}
          api={api}
          onClose={() => setKind(null)}
          onSaved={() => {}}
        />
      )}
    </main>
  );
}
