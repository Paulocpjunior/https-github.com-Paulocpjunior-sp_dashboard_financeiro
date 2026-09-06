import { logger } from '../utils/logger';
import { FilterState } from "../types";

const CLIENT_AI_ENABLED = import.meta.env.DEV && import.meta.env.VITE_ENABLE_CLIENT_AI === 'true';
// Paulo, 06/09: *"precisamos alterar nosso motor em todos os apps, do gemini,
// 3.7 para 3.8 em todos"*. Estava em `gemini-3-flash-preview` (build que a
// Google retira sem aviso), escrito três vezes — agora um lugar só.
const GEMINI_MODEL = 'gemini-3.8-flash';
const CLIENT_AI_KEY = CLIENT_AI_ENABLED ? String(import.meta.env.VITE_GEMINI_API_KEY || '') : '';
const AI_UNAVAILABLE_MESSAGE = 'IA financeira desativada neste ambiente por segurança. Configure um backend seguro para habilitar esta função em produção.';

let lastCallTime = 0;
const RATE_LIMIT_MS = 1500;
let aiClientPromise: Promise<{ ai: any; Type: any }> | null = null;

const getAIClient = async () => {
  if (!CLIENT_AI_KEY) return null;

  if (!aiClientPromise) {
    aiClientPromise = import('@google/genai').then(({ GoogleGenAI, Type }) => ({
      ai: new GoogleGenAI({ apiKey: CLIENT_AI_KEY }),
      Type,
    }));
  }

  return aiClientPromise;
};

const waitRateLimit = async () => {
  const now = Date.now();
  const diff = now - lastCallTime;
  if (diff < RATE_LIMIT_MS) {
    await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_MS - diff));
  }
  lastCallTime = Date.now();
};

export const GeminiService = {
  isAvailable: (): boolean => Boolean(CLIENT_AI_KEY),

  /**
   * Detects the intent of the user query.
   */
  detectMode: async (query: string): Promise<'filter' | 'analysis' | 'forecast'> => {
    const q = query.toLowerCase();
    if (q.includes('previsão') || q.includes('projetar') || q.includes('forecast') || q.includes('futuro')) return 'forecast';
    if (q.includes('quem') || q.includes('qual') || q.includes('análise') || q.includes('resumo') || q.includes('por que') || q.includes('como')) return 'analysis';
    return 'filter';
  },

  /**
   * Interprets a natural language query and returns structured filter data.
   */
  interpretQuery: async (query: string): Promise<{ filters: Partial<FilterState>; explanation: string }> => {
    const client = await getAIClient();
    if (!client) {
      return {
        filters: {},
        explanation: AI_UNAVAILABLE_MESSAGE,
      };
    }

    await waitRateLimit();

    try {
      const modelId = GEMINI_MODEL;
      const today = new Date();
      const todayStr = today.toISOString().split('T')[0];
      
      const systemInstruction = `
        You are an AI assistant for a financial dashboard (CashFlow Pro).
        Your goal is to convert natural language queries (in Portuguese) into a JSON object representing filters.

        Current Date Reference: ${todayStr} (YYYY-MM-DD).

        1. Business Logic Mapping (Apply these rules strictly):
        - "A pagar" / "Contas a Pagar" / "Vencendo" -> movement: 'Saída', status: 'Pendente'.
        - "A receber" / "Contas a Receber" -> movement: 'Entrada', status: 'Pendente'.
        - "Pago" / "Pagas" / "Quitado" / "Liquidado" -> status: 'Pago'.
        - "Pendente" / "Em aberto" / "Não pago" -> status: 'Pendente'.
        - "Agendado" / "Futuro" -> status: 'Agendado'.
        - "Receitas" / "Entradas" / "Ganhos" / "Faturamento" / "Vendas" -> movement: 'Entrada'.
        - "Despesas" / "Gastos" / "Saídas" / "Custos" / "Pagamentos" -> movement: 'Saída'.

        2. Date Logic (Calculate exact YYYY-MM-DD strings based on Current Date):
        - "Hoje" -> startDate: ${todayStr}, endDate: ${todayStr}.
        - "Ontem" -> startDate: (yesterday), endDate: (yesterday).
        - "Deste mês" / "Mês atual" -> startDate: (1st of current month), endDate: (last day of current month).
        - "Mês passado" -> startDate: (1st of previous month), endDate: (last day of previous month).
        - "Próximo mês" -> startDate: (1st of next month), endDate: (last day of next month).
        - "Este ano" -> startDate: (Jan 1st current year), endDate: (Dec 31st current year).
        - "Ano passado" -> startDate: (Jan 1st previous year), endDate: (Dec 31st previous year).
        - Specific months (e.g. "Janeiro", "Março") -> Assume current year unless context implies last/next year.

        3. Available Filter Fields (Exact values required):
        - startDate (YYYY-MM-DD)
        - endDate (YYYY-MM-DD)
        - bankAccount (Map specific variations to: 'Itau', 'Bradesco', 'Santander', 'Nubank', 'Inter', 'Caixa'. Ex: 'Nu' -> 'Nubank').
        - type (string, partial match allowed e.g. 'Impostos', 'Serviço', 'Aluguel').
        - status (Exact values: 'Pago', 'Pendente', 'Agendado').
        - client (string, partial match for company names or people).
        - paidBy (string, partial match).
        - movement (Exact values: 'Entrada', 'Saída').
        - search (string, use for terms that don't fit specific categories).

        Return a JSON object with:
        1. "filters": The filter object containing ONLY the fields mentioned or implied.
        2. "explanation": A short, concise sentence in Portuguese explaining what filters were applied (e.g., "Filtrando contas a pagar de Outubro").
      `;

      const response = await client.ai.models.generateContent({
        model: modelId,
        contents: query,
        config: {
          systemInstruction: systemInstruction,
          responseMimeType: "application/json",
          responseSchema: {
            type: client.Type.OBJECT,
            properties: {
              filters: {
                type: client.Type.OBJECT,
                properties: {
                  startDate: { type: client.Type.STRING, nullable: true },
                  endDate: { type: client.Type.STRING, nullable: true },
                  bankAccount: { type: client.Type.STRING, nullable: true },
                  type: { type: client.Type.STRING, nullable: true },
                  status: { type: client.Type.STRING, nullable: true },
                  client: { type: client.Type.STRING, nullable: true },
                  paidBy: { type: client.Type.STRING, nullable: true },
                  movement: { type: client.Type.STRING, nullable: true },
                  search: { type: client.Type.STRING, nullable: true },
                },
              },
              explanation: { type: client.Type.STRING },
            },
          }
        },
      });

      if (response.text) {
        const result = JSON.parse(response.text);
        return {
          filters: result.filters || {},
          explanation: result.explanation || "Filtros aplicados com sucesso.",
        };
      }
      
      return { filters: {}, explanation: "Não foi possível entender a consulta." };

    } catch (error) {
      logger.error("Gemini API Error:", error);
      return { filters: {}, explanation: "Erro ao conectar com a inteligência artificial." };
    }
  },

  /**
   * Analyzes financial data and returns a text response.
   */
  analyzeData: async (query: string, transactions: any[]): Promise<string> => {
    const client = await getAIClient();
    if (!client) return AI_UNAVAILABLE_MESSAGE;
    await waitRateLimit();

    try {
      const summary = {
        totalEntradas: transactions.filter(t => t.movement === 'Entrada').reduce((acc, t) => acc + (t.valueReceived || 0), 0),
        totalSaidas: transactions.filter(t => t.movement === 'Saída').reduce((acc, t) => acc + (t.valuePaid || 0), 0),
        pendentesReceber: transactions.filter(t => t.movement === 'Entrada' && t.status !== 'Pago').reduce((acc, t) => acc + (t.totalCobranca || 0), 0),
        pendentesPagar: transactions.filter(t => t.movement === 'Saída' && t.status !== 'Pago').reduce((acc, t) => acc + (t.valuePaid || 0), 0),
        vencidos: transactions.filter(t => t.status !== 'Pago' && t.dueDate < new Date().toISOString().split('T')[0]).length,
        topClientesPendentes: Object.entries(
          transactions.filter(t => t.movement === 'Entrada' && t.status !== 'Pago')
            .reduce((acc, t) => {
              acc[t.client] = (acc[t.client] || 0) + (t.totalCobranca || 0);
              return acc;
            }, {} as Record<string, number>)
        ).sort((a, b) => (b[1] as number) - (a[1] as number)).slice(0, 10),
        saldoPorBanco: transactions.reduce((acc, t) => {
          const val = t.movement === 'Entrada' ? (t.valueReceived || 0) : -(t.valuePaid || 0);
          acc[t.bankAccount] = (acc[t.bankAccount] || 0) + val;
          return acc;
        }, {} as Record<string, number>)
      };

      const systemInstruction = `
        Você é um analista financeiro sênior. 
        Analise os dados fornecidos e responda à pergunta do usuário de forma clara, profissional e baseada em dados.
        Use Markdown para formatar tabelas ou listas se necessário.
        Dados atuais: ${JSON.stringify(summary)}
      `;

      const response = await client.ai.models.generateContent({
        model: GEMINI_MODEL,
        contents: query,
        config: { systemInstruction }
      });

      return response.text || "Não foi possível realizar a análise.";
    } catch (error) {
      logger.error("Gemini Analysis Error:", error);
      return "Erro ao processar análise de dados.";
    }
  },

  /**
   * Forecasts cash flow for the next 30 days.
   */
  forecastCashFlow: async (transactions: any[]): Promise<string> => {
    const client = await getAIClient();
    if (!client) return AI_UNAVAILABLE_MESSAGE;
    await waitRateLimit();

    try {
      const futureTransactions = transactions.filter(t => t.dueDate >= new Date().toISOString().split('T')[0]);
      
      const systemInstruction = `
        Você é um especialista em projeção de fluxo de caixa.
        Com base nas transações futuras fornecidas, projete o fluxo de caixa para os próximos 30 dias.
        Identifique possíveis gargalos (dias com saldo negativo) e dê recomendações.
        Transações Futuras: ${JSON.stringify(futureTransactions.slice(0, 50))}
      `;

      const response = await client.ai.models.generateContent({
        model: GEMINI_MODEL,
        contents: "Gere uma projeção de fluxo de caixa para os próximos 30 dias.",
        config: { systemInstruction }
      });

      return response.text || "Não foi possível gerar a previsão.";
    } catch (error) {
      logger.error("Gemini Forecast Error:", error);
      return "Erro ao gerar previsão de caixa.";
    }
  }
};
