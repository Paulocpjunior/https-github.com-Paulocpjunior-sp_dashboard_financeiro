import React, { useEffect, useRef, useState } from "react";
import { Transaction } from "../types";
import { downloadEntryAttachment } from "../services/nativeEntryService";
import { AuthService } from "../services/authService";
export default function NativeEntryDetails({
  row,
  onClose,
}: {
  row: Transaction;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  const entry = row.nativeEntry;
  return (
    <dialog
      ref={dialog}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      aria-label="Detalhes do lançamento"
      className="m-auto rounded-xl p-6 w-[min(650px,95vw)] max-h-[90vh] bg-white dark:bg-slate-900 text-slate-900 dark:text-white backdrop:bg-black/60"
    >
      <div className="flex justify-between">
        <h2 className="font-bold text-xl">Detalhes do lançamento</h2>
        <button onClick={onClose} aria-label="Fechar detalhes">
          ✕
        </button>
      </div>
      <div className="space-y-3 mt-4 text-sm">
        <p>{row.client}</p>
        <p>{row.description}</p>
        <p>Fornecedor: {entry?.supplier || "—"}</p>
        <p>Conta: {row.bankAccount}</p>
        <p>Registrado por: {row.createdByName || "—"}</p>
        <p>Autorizado por (declarado): {entry?.authorizedBy || "—"}</p>
        <p>Envio/pagamento: {row.metodoPagamento || "—"}</p>
        <p>Recebimento: {entry?.receiptMethod || "—"}</p>
        <p>{row.observacao || row.observacaoAPagar || "Sem observações."}</p>
        {entry?.address && (
          <p>
            Endereço:{" "}
            {Object.values(entry.address).filter(Boolean).join(", ") || "—"}
          </p>
        )}
        <p>
          Contato:{" "}
          {[entry?.email, entry?.phone].filter(Boolean).join(" · ") || "—"}
        </p>
        <h3 className="font-bold">Anexos</h3>
        {error && (
          <p role="alert" className="text-red-600">
            {error}
          </p>
        )}
        {!row.attachments?.length && <p>Sem anexos.</p>}
        {row.attachments?.map((a) => (
          <button
            className="block underline"
            key={a.sha256 + a.kind}
            disabled={busy || AuthService.getCurrentUser()?.role !== "admin"}
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                await downloadEntryAttachment(row.id, a.sha256);
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            {a.kind}: {a.name} ({Math.ceil(a.size / 1024)} KB)
          </button>
        ))}
        <p className="text-xs text-slate-500">
          No piloto, o download de anexos é restrito aos administradores.
        </p>
      </div>
    </dialog>
  );
}
