import React, { useEffect, useRef, useState } from 'react';
import '../design-system/tokens.css';
import { CheckCircle2, AlertTriangle, Loader2, Mail, MessageCircle } from 'lucide-react';
import {
  DELIVERY_CHANNELS,
  DeliveryChannel,
  DeliveryInfo,
  SendOutcome,
  deliverAfterIssue,
  fetchDelivery,
  sendBoleto,
} from '../services/boletoDeliveryService';

const channelLabel: Record<DeliveryChannel, string> = { email: 'E-mail', whatsapp: 'WhatsApp' };
const brDate = (iso?: string) => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '');

function describe(channel: DeliveryChannel, info: DeliveryInfo, outcome?: SendOutcome): { text: string; tone: 'ok' | 'warn' | 'muted' | 'busy' } {
  if (outcome?.state === 'sending') return { text: 'Enviando…', tone: 'busy' };
  if (outcome?.pending) return { text: 'Aguardando o banco confirmar o registro para enviar.', tone: 'warn' };
  const current = outcome && outcome.state !== 'failed' ? outcome : info.deliveries[channel];
  if (current.state === 'sent') return { text: `Enviado${current.at ? ` em ${brDate(current.at)}` : ''} para ${current.to}${current.resends ? ` (${current.resends} reenvio(s))` : ''}`, tone: 'ok' };
  if (current.state === 'unknown') return { text: `Envio sem confirmação${current.to ? ` para ${current.to}` : ''}. Confira antes de enviar de novo.`, tone: 'warn' };
  if (current.state === 'sending') return { text: 'Envio em andamento.', tone: 'busy' };
  if (outcome?.state === 'failed') return { text: outcome.error || 'Envio não concluído.', tone: 'warn' };
  if (info.problems[channel]) return { text: info.problems[channel], tone: 'muted' };
  if (channel === 'email' && !info.emailEnabled) return { text: 'Envio por e-mail aguardando habilitação (Microsoft 365).', tone: 'muted' };
  if (info.deliveries[channel].state === 'failed') return { text: `Falhou: ${info.deliveries[channel].error || 'tente de novo'}`, tone: 'warn' };
  return { text: 'Não enviado', tone: 'muted' };
}

// Situação do envio ao cliente por canal, com envio e reenvio (motivo obrigatório).
// Com `auto`, envia sozinho logo após a emissão pelos meios do cadastro.
export default function BoletoDeliveryStatus({ id, auto = false, compact = false, startDelay = 0 }: { id: string; auto?: boolean; compact?: boolean; startDelay?: number }) {
  const [info, setInfo] = useState<DeliveryInfo | null>(null);
  const [outcomes, setOutcomes] = useState<Partial<Record<DeliveryChannel, SendOutcome>>>({});
  const [busy, setBusy] = useState<DeliveryChannel | null>(null);
  const [error, setError] = useState('');
  const [resend, setResend] = useState<{ channel: DeliveryChannel; reason: string } | null>(null);
  const alive = useRef(true);

  const reload = () => fetchDelivery(id).then((value) => alive.current && setInfo(value)).catch((e) => alive.current && setError(e instanceof Error ? e.message : 'Situação do envio indisponível.'));

  useEffect(() => {
    alive.current = true;
    setInfo(null);
    setOutcomes({});
    setError('');
    (async () => {
      // No lote, os envios começam escalonados para não sobrecarregar o emissor.
      if (auto && startDelay) await new Promise((resolve) => setTimeout(resolve, startDelay));
      if (auto && alive.current)
        await deliverAfterIssue(id, (channel, outcome) => alive.current && setOutcomes((o) => ({ ...o, [channel]: outcome })), { cancelled: () => !alive.current });
      await reload();
    })();
    return () => {
      alive.current = false;
    };
  }, [id, auto]);

  async function send(channel: DeliveryChannel, reason?: string) {
    if (busy) return;
    setBusy(channel);
    setOutcomes((o) => ({ ...o, [channel]: { state: 'sending' } }));
    const outcome = await sendBoleto(id, channel, reason);
    if (!alive.current) return;
    setOutcomes((o) => ({ ...o, [channel]: outcome }));
    if (!outcome.alreadySent) setResend(null);
    setBusy(null);
    await reload();
  }

  if (error && !info) return <p className="text-sm" style={{ color: 'var(--sp-danger)' }}>{error}</p>;
  if (!info) return <p className="text-sm inline-flex items-center gap-1 sp-muted"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />Conferindo envio ao cliente…</p>;
  if (!info.available) return compact ? null : <p className="text-sm sp-muted">Envio ao cliente só para boletos de produção.</p>;

  return (
    <div className="space-y-1 text-sm" aria-label="Envio ao cliente">
      {DELIVERY_CHANNELS.map((channel) => {
        const Icon = channel === 'email' ? Mail : MessageCircle;
        const { text, tone } = describe(channel, info, outcomes[channel]);
        const state = outcomes[channel]?.state === 'sent' || outcomes[channel]?.state === 'unknown' ? outcomes[channel]!.state : info.deliveries[channel].state;
        const configured = !info.problems[channel] && (channel !== 'email' || info.emailEnabled);
        const already = state === 'sent' || state === 'unknown';
        return (
          <div key={channel} className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <Icon className="h-4 w-4" aria-hidden="true" />
              <span className="font-semibold">{channelLabel[channel]}:</span>
              <span style={{ color: tone === 'ok' ? 'var(--sp-success)' : tone === 'warn' ? 'var(--sp-warning)' : undefined }} className={tone === 'muted' ? 'sp-muted' : undefined}>
                {tone === 'busy' ? <Loader2 className="inline h-4 w-4 animate-spin" aria-hidden="true" /> : tone === 'ok' ? <CheckCircle2 className="inline h-4 w-4" aria-hidden="true" /> : tone === 'warn' ? <AlertTriangle className="inline h-4 w-4" aria-hidden="true" /> : null} {text}
              </span>
              {configured && info.issued && !already && state !== 'sending' && (
                <button type="button" className="sp-button" disabled={Boolean(busy)} onClick={() => send(channel)}>Enviar</button>
              )}
              {configured && info.issued && already && resend?.channel !== channel && (
                <button type="button" className="sp-button" disabled={Boolean(busy)} onClick={() => setResend({ channel, reason: '' })}>Reenviar</button>
              )}
            </div>
            {resend?.channel === channel && (
              <div className="flex flex-wrap items-center gap-2">
                <input className="sp-field" style={{ minWidth: '16rem' }} placeholder="Motivo do reenvio (obrigatório)" value={resend.reason} onChange={(e) => setResend({ channel, reason: e.target.value })} />
                <button type="button" className="sp-button sp-button-primary" disabled={Boolean(busy) || resend.reason.trim().length < 10} onClick={() => send(channel, resend.reason.trim())}>Confirmar reenvio</button>
                <button type="button" className="sp-button" disabled={Boolean(busy)} onClick={() => setResend(null)}>Cancelar</button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
