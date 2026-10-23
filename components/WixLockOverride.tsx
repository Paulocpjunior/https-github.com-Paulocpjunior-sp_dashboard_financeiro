import React from 'react';
import '../design-system/tokens.css';

export type WixLockInvoice = { id: string; kind?: 'fatura' | 'pedido'; number: string; client: string; dueDate: string; amount?: number; status: string };

// Trava Wix: a cobrança foi recusada porque a empresa já tem, no Wix, cobrança com
// o mesmo valor e o mesmo vencimento (cobrança em dobro).
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
      <h3 className="font-semibold">Mesma cobrança já existe no Wix (mesmo valor e vencimento)</h3>
      <ul className="text-sm my-2">
        {invoices.map((i) => <li key={i.id}>{i.kind === 'pedido' ? 'Pedido Wix' : 'Fatura Wix'} #{i.number}{typeof i.amount === 'number' ? ` · ${i.amount.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}` : ''} · venc. {i.dueDate ? i.dueDate.split('-').reverse().join('/') : 'sem data'} · {i.status || 'sem situação'}</li>)}
      </ul>
      {canOverride ? (
        <label className="block text-sm">
          Motivo da exceção (obrigatório, fica no histórico)
          <textarea className="sp-field w-full" minLength={15} maxLength={1000} value={reason} disabled={disabled} onChange={(e) => onReason(e.target.value)} />
          <span className="sp-muted">Preencha e envie de novo para liberar esta cobrança mesmo com a cobrança no Wix.</span>
        </label>
      ) : (
        <p className="text-sm">Se for outro serviço, ajuste valor ou vencimento. Se for a mesma cobrança, cobre pelo Wix ou peça ao administrador master uma exceção.</p>
      )}
    </section>
  );
}
