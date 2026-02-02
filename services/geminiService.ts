import { GoogleGenAI, Type } from "@google/genai";
import { FilterState } from "../types";

// Note: In a production React app, we usually proxy this through a backend to hide the key.
// For this standalone demo, we use the env variable directly as requested.
const apiKey = process.env.API_KEY || '';
const ai = new GoogleGenAI({ apiKey });

export const GeminiService = {
  /**
   * Interprets a natural language query and returns structured filter data.
   */
  interpretQuery: async (query: string): Promise<{ filters: Partial<FilterState>; explanation: string }> => {
    if (!apiKey) {
      return {
        filters: {},
        explanation: "Chave de API não configurada. Por favor, adicione sua chave da API Gemini para usar a IA.",
      };
    }

    try {
      const modelId = "gemini-3-flash-preview"; // Using a fast model for UI responsiveness
      const today = new Date();
      const todayStr = today.toISOString().split('T')[0];
      
      const systemInstruction = `
        You are an AI assistant for a financial dashboard (CashFlow Pro).
        Your goal is to convert natural language queries (in Portuguese) into a JSON object representing filters.

        Current Date: ${todayStr} (YYYY-MM-DD).

        Business Logic Mapping (Apply these rules strictly):
        - "A pagar" (To pay) -> movement: 'Saída', status: 'Pendente'.
        - "A receber" (To receive) -> movement: 'Entrada', status: 'Pendente'.
        - "Contas pagas" (Paid bills) -> status: 'Pago'.
        - "Recebimentos" (Receipts) -> movement: 'Entrada'.
        - "Despesas" / "Gastos" / "Saídas" -> movement: 'Saída'.
        
        Date Logic:
        - "Deste mês" (This month) -> Calculate startDate (first day of current month) and endDate (last day of current month).
        - "Mês passado" (Last month) -> Calculate startDate and endDate for the previous month.
        - "Hoje" (Today) -> startDate: ${todayStr}, endDate: ${todayStr}.
        
        Available Filter Fields (Exact values required):
        - startDate (YYYY-MM-DD)
        - endDate (YYYY-MM-DD)
        - bankAccount (string, exact match from common banks like 'Itau', 'Bradesco', 'Santander', 'Nubank', 'Inter', 'Caixa')
        - type (string, partial match)
        - status ('Pago', 'Pendente', 'Agendado')
        - client (string, partial match)
        - paidBy (string, partial match)
        - movement ('Entrada', 'Saída')
        - search (string, for general terms not fitting above)

        Return a JSON object with:
        1. "filters": The filter object containing ONLY the fields mentioned or implied.
        2. "explanation": A short, concise sentence in Portuguese explaining what filters were applied (e.g., "Filtrando contas a pagar de Outubro").
      `;

      const response = await ai.models.generateContent({
        model: modelId,
        contents: query,
        config: {
          systemInstruction: systemInstruction,
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              filters: {
                type: Type.OBJECT,
                properties: {
                  startDate: { type: Type.STRING, nullable: true },
                  endDate: { type: Type.STRING, nullable: true },
                  bankAccount: { type: Type.STRING, nullable: true },
                  type: { type: Type.STRING, nullable: true },
                  status: { type: Type.STRING, nullable: true },
                  client: { type: Type.STRING, nullable: true },
                  paidBy: { type: Type.STRING, nullable: true },
                  movement: { type: Type.STRING, nullable: true },
                  search: { type: Type.STRING, nullable: true },
                },
              },
              explanation: { type: Type.STRING },
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
      console.error("Gemini API Error:", error);
      return { filters: {}, explanation: "Erro ao conectar com a inteligência artificial." };
    }
  },
};