import { boletoRequest } from './boletoIssueStatus';
import { SpConnectGateway } from './spConnectGateway';

// Envio do boleto emitido ao cliente. Contatos da Regra de faturamento; cada
// boleto vai uma vez por canal e reenviar exige motivo (servidor confere).
export type DeliveryChannel = 'email' | 'whatsapp';
export const DELIVERY_CHANNELS: DeliveryChannel[] = ['email', 'whatsapp'];
export type DeliveryState = { state: 'none' | 'sending' | 'sent' | 'failed' | 'unknown'; to?: string; at?: string; error?: string; resends?: number };
export type DeliveryInfo = {
  available: boolean;
  emailEnabled: boolean;
  issued: boolean;
  contacts: null | { channels: string[]; email: string[]; whatsapp: string };
  problems: Record<DeliveryChannel, string>;
  deliveries: Record<DeliveryChannel, DeliveryState>;
};
export type SendOutcome = DeliveryState & { pending?: boolean; alreadySent?: boolean; notConfigured?: boolean; needsContact?: boolean };

const path = (id: string, action: string) => `items/${encodeURIComponent(id)}/${action}`;

export async function fetchDelivery(id: string): Promise<DeliveryInfo> {
  return (await boletoRequest(path(id, 'delivery'))).json();
}

function failure(error: unknown): SendOutcome {
  const details = (error as { details?: Record<string, unknown> })?.details || {};
  return {
    state: 'failed',
    error: error instanceof Error ? error.message : 'Envio não concluído.',
    pending: details.pending === true,
    alreadySent: details.alreadySent === true,
    notConfigured: details.notConfigured === true,
    needsContact: details.needsContact === true,
  };
}

export async function sendBoleto(id: string, channel: DeliveryChannel, resendReason?: string): Promise<SendOutcome> {
  const extra = resendReason ? { resendReason } : {};
  if (channel === 'email') {
    try {
      return (await (await boletoRequest(path(id, 'delivery'), { channel, ...extra })).json()).delivery;
    } catch (error) {
      return failure(error);
    }
  }
  // O modelo é conferido antes de reservar o envio: sem modelo, nada é registrado.
  const { template, error: templateError } = await SpConnectGateway.documentTemplate();
  if (!template) return { state: 'failed', error: templateError || 'Modelo de WhatsApp indisponível.', notConfigured: true };
  let prepared: { attemptId: string; para: string; pdfBase64: string; nomeArquivo: string; referencia: string; botaoUrl?: string; variaveis: Record<string, string> };
  try {
    prepared = await (await boletoRequest(path(id, 'delivery'), { channel, ...extra })).json();
  } catch (error) {
    return failure(error);
  }
  const result = await SpConnectGateway.sendTemplate({
    para: prepared.para,
    template: template.nome,
    variaveis: prepared.variaveis,
    pdfBase64: prepared.pdfBase64,
    nomeArquivo: prepared.nomeArquivo,
    referencia: prepared.referencia,
    botaoUrl: prepared.botaoUrl,
  });
  try {
    const saved = await (await boletoRequest(path(id, 'delivery-result'), {
      channel,
      attemptId: prepared.attemptId,
      ok: result.ok === true,
      messageId: typeof result.messageId === 'string' ? result.messageId : '',
      indeterminado: result.indeterminado === true,
      error: result.ok ? '' : String(result.error || ''),
    })).json();
    return saved.delivery;
  } catch {
    // O WhatsApp pode ter saído; o registro fica "sem confirmação" e não repete sozinho.
    return { state: 'unknown', error: result.ok ? 'Enviado, mas o registro não foi gravado. Não reenvie sem conferir.' : String(result.error || 'Envio não confirmado.') };
  }
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Após a emissão: envia pelos meios cadastrados que ainda não foram enviados.
// Recém-emitido aguarda o registro do banco (tenta por cerca de 2 minutos).
export async function deliverAfterIssue(
  id: string,
  onUpdate: (channel: DeliveryChannel, outcome: SendOutcome) => void,
  { attempts = 8, interval = 15000, cancelled = () => false }: { attempts?: number; interval?: number; cancelled?: () => boolean } = {},
): Promise<void> {
  let info: DeliveryInfo;
  try {
    info = await fetchDelivery(id);
  } catch {
    return;
  }
  if (!info.available || !info.issued) return;
  const channels = DELIVERY_CHANNELS.filter((c) => info.contacts?.channels.includes(c) && !info.problems[c] && info.deliveries[c].state === 'none');
  for (const channel of channels) {
    if (channel === 'email' && !info.emailEnabled) continue;
    for (let attempt = 0; attempt < attempts && !cancelled(); attempt++) {
      if (attempt) await wait(interval);
      if (cancelled()) return;
      const outcome = await sendBoleto(id, channel);
      onUpdate(channel, outcome);
      if (!outcome.pending) break;
    }
  }
}
