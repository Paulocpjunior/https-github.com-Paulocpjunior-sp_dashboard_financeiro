import { auth } from '../firebase';

const SP_CONNECT_API_URL = String(
  import.meta.env.VITE_SP_CONNECT_API_URL ||
  'https://consultor-fiscal-inteligente-zricstsjqa-uw.a.run.app'
).replace(/\/+$/, '');

export interface SpConnectTemplateVariable {
  chave: string;
  rotulo: string;
}

export interface SpConnectRegisteredTemplate {
  id: string;
  departamento: string;
  nome: string;
  idioma: string;
  descricao?: string;
  temDocumento?: boolean;
  variaveis: SpConnectTemplateVariable[];
  ativo?: boolean;
}

export interface SpConnectMetaTemplate {
  nome: string;
  idioma: string;
  status: string;
  categoria: string;
  temDocumento: boolean;
  formatoCabecalho: string;
  variaveis: number;
  corpo: string;
}

export interface SpConnectResult {
  ok: boolean;
  error?: string;
  acao?: string;
  indeterminado?: boolean;
  [key: string]: unknown;
}

async function request<T extends SpConnectResult>(path: string, init?: RequestInit): Promise<T> {
  const user = auth.currentUser;
  if (!user) {
    return { ok: false, error: 'Sessão expirada. Entre novamente para usar o SP Connect.' } as T;
  }

  let token: string;
  try {
    token = await user.getIdToken();
  } catch {
    return { ok: false, error: 'Não foi possível validar sua sessão. Entre novamente.' } as T;
  }
  let response: Response;
  try {
    response = await fetch(`${SP_CONNECT_API_URL}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
        ...(init?.headers || {}),
      },
    });
  } catch {
    return {
      ok: false,
      error: 'Não foi possível comunicar com o SP Connect. Tente novamente em instantes.',
      indeterminado: init?.method === 'POST',
    } as T;
  }

  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) {
    return {
      ...data,
      ok: false,
      error: data.error || data.erro || `SP Connect respondeu HTTP ${response.status}.`,
    } as T;
  }
  return data as T;
}

export const SpConnectGateway = {
  getAvailability: async () => {
    const [status, registered, meta] = await Promise.all([
      request<SpConnectResult & { pronto?: boolean }>('/api/admin/whatsapp/status'),
      request<SpConnectResult & { templates?: SpConnectRegisteredTemplate[] }>(
        '/api/admin/whatsapp/templates?departamento=financeiro'
      ),
      request<SpConnectResult & { templates?: SpConnectMetaTemplate[] }>(
        '/api/admin/whatsapp/templates-meta'
      ),
    ]);

    return {
      status,
      registered: registered.ok
        ? (registered.templates || []).filter((item) => item.ativo !== false && !item.temDocumento)
        : [],
      meta: meta.ok
        ? (meta.templates || []).filter(
            (item) => item.status === 'APPROVED' && !item.temDocumento
          )
        : [],
      error: !status.ok ? status.error : !registered.ok && !meta.ok ? registered.error || meta.error : undefined,
    };
  },

  // Modelo do Financeiro com cabeçalho de DOCUMENTO: o único que leva o PDF do boleto.
  documentTemplate: async (): Promise<{ template?: SpConnectRegisteredTemplate; error?: string }> => {
    const result = await request<SpConnectResult & { templates?: SpConnectRegisteredTemplate[] }>(
      '/api/admin/whatsapp/templates?departamento=financeiro'
    );
    if (!result.ok) return { error: result.error };
    const withDocument = (result.templates || []).filter((item) => item.ativo !== false && item.temDocumento);
    if (withDocument.length === 1) return { template: withDocument[0] };
    return {
      error: withDocument.length
        ? `Há ${withDocument.length} modelos de WhatsApp do Financeiro com documento. Deixe só um ativo no SP Connect para o envio do boleto.`
        : 'Falta no SP Connect um modelo de WhatsApp do Financeiro com documento (PDF) aprovado pela Meta.',
    };
  },

  sendTemplate: (input: {
    para: string;
    template: string;
    variaveis: Record<string, string>;
    pdfBase64: string;
    nomeArquivo: string;
    referencia?: string;
    // Final do link do botão de URL dinâmica do modelo ("Adicionar à agenda").
    botaoUrl?: string;
  }) =>
    request<SpConnectResult & { messageId?: string; numeroEnviado?: string }>('/api/admin/whatsapp/enviar', {
      method: 'POST',
      body: JSON.stringify({ departamento: 'financeiro', ...input }),
    }),

  startConversation: (input: {
    para: string;
    nomeContato?: string;
    template?: string;
    variaveis?: Record<string, string>;
    templateDireto?: { nome: string; idioma: string };
    variaveisPosicionais?: string[];
  }) =>
    request<SpConnectResult & { numero?: string; messageId?: string }>(
      '/api/admin/whatsapp/conversas/iniciar',
      {
        method: 'POST',
        body: JSON.stringify({ departamento: 'financeiro', ...input }),
      }
    ),
};
