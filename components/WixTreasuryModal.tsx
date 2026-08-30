import React, { useEffect } from 'react';
import { ArrowUpRight, CheckCircle2, ExternalLink, LockKeyhole, Wallet, X } from 'lucide-react';

interface WixTreasuryModalProps {
  open: boolean;
  onClose: () => void;
}

export const WIX_SP_CONTABIL_TRANSFERS_URL = 'https://manage.wix.com/wix-payments/br/dashboard/1e7a5d33-26d6-4f39-8f4c-be9452b1eb10/002/transfer-history';
export const WIX_TREASURY_AGENT_URL = 'spwix://prepare-transfer';

export const WixTreasuryModal: React.FC<WixTreasuryModalProps> = ({ open, onClose }) => {
  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const prepareWixTransfer = () => {
    window.location.href = WIX_TREASURY_AGENT_URL;
  };

  const openWixTransfersOnly = () => {
    window.open(WIX_SP_CONTABIL_TRANSFERS_URL, '_blank', 'noopener,noreferrer');
  };

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/65 p-4 print:hidden"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="wix-treasury-title"
        className="w-full max-w-xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900"
      >
        <div className="flex items-start justify-between border-b border-slate-200 px-6 py-5 dark:border-slate-800">
          <div className="flex items-start gap-3">
            <div className="rounded-xl bg-blue-100 p-2.5 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
              <Wallet className="h-6 w-6" />
            </div>
            <div>
              <h2 id="wix-treasury-title" className="text-xl font-bold text-slate-900 dark:text-white">Tesouraria Wix</h2>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Atalho seguro para consultar e transferir o saldo disponível.</p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200" aria-label="Fechar modal">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-5 px-6 py-6">
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-900/60 dark:bg-emerald-950/20">
            <div className="flex items-start gap-3">
              <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-400" />
              <div>
                <p className="font-semibold text-emerald-900 dark:text-emerald-200">Automação local habilitada</p>
                <p className="mt-1 text-sm leading-6 text-emerald-800 dark:text-emerald-300">No Mac autorizado, o botão abre a conta <strong>SPcontabil</strong>, aciona <strong>Transferir</strong> e para na tela de revisão. A confirmação final continua sob seu controle.</p>
              </div>
            </div>
          </div>

          <ol className="space-y-3 text-sm text-slate-700 dark:text-slate-300">
            <li className="flex gap-3"><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-bold dark:bg-slate-800">1</span><span>A Wix valida o usuário e as permissões da conta.</span></li>
            <li className="flex gap-3"><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-bold dark:bg-slate-800">2</span><span>O agente local abre automaticamente a revisão dos fundos disponíveis.</span></li>
            <li className="flex gap-3"><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-bold dark:bg-slate-800">3</span><span>Você confere o valor e a conta bancária antes de confirmar na Wix.</span></li>
          </ol>

          <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-200">
            <LockKeyhole className="mt-0.5 h-5 w-5 shrink-0" />
            <p>O agente reconhece somente o botão inicial <strong>Transferir</strong>. Ele nunca aciona <strong>Transferir fundos</strong>, não recebe sua senha Wix e não confirma movimentações financeiras.</p>
          </div>
        </div>

        <div className="flex flex-col-reverse gap-3 border-t border-slate-200 bg-slate-50 px-6 py-4 sm:flex-row sm:justify-end dark:border-slate-800 dark:bg-slate-950/40">
          <button type="button" onClick={onClose} className="rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-white dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800">Cancelar</button>
          <button type="button" onClick={openWixTransfersOnly} className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-white dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800">
            Abrir somente na Wix
            <ExternalLink className="h-4 w-4" />
          </button>
          <button type="button" onClick={prepareWixTransfer} className="inline-flex items-center justify-center gap-2 rounded-lg bg-blue-700 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-blue-800">
            Preparar resgate no Mac
            <ArrowUpRight className="h-4 w-4" />
          </button>
        </div>
      </section>
    </div>
  );
};
