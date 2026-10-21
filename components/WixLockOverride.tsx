import React from 'react';
import '../design-system/tokens.css';

export type WixLockInvoice = { id: string; number: string; client: string; dueDate: string; status: string };

// Trava de Fatura Wix: a cobrança foi recusada porque a empresa já tem Fatura Wix.
// Só o master libera exceção, com motivo; o servidor confere e registra o log.
export default function WixLockOverride({ invoices, canOverride, reason, onReason, disabled }: {
  invoices: WixLockInvoice[];
  canOverride: boolean;
  reason: string;
  onReason: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <section className="sp-card my-3" role="alert" style={{ borderColor: 'var(--sp-warning)' }} aria-label="Trava de Fatura Wix">
      <h3 className="font-semibold">Empresa com Fatura Wix emitida</h3>
      <ul className="text-sm my-2">
        {invoices.map((i) => <li key={i.id}>Fatura #{i.number} · venc. {i.dueDate ? i.dueDate.split('-').reverse().join('/') : 'sem data'} · {i.status || 'sem situação'}</li>)}
      </ul>
      {canOverride ? (
        <label className="block text-sm">
          Motivo da exceção (obrigatório, fica no histórico)
          <textarea className="sp-field w-full" minLength={15} maxLength={1000} value={reason} disabled={disabled} onChange={(e) => onReason(e.target.value)} />
          <span className="sp-muted">Preencha e envie de novo para liberar esta cobrança mesmo com a Fatura Wix.</span>
        </label>
      ) : (
        <p className="text-sm">Cobre pela Fatura Wix ou peça ao administrador master para liberar uma exceção.</p>
      )}
    </section>
  );
}
