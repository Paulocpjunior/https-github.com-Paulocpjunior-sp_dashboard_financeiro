import { Transaction, User } from '../types';
import { MOCK_USERS } from '../constants';

// =========================================================================================
// CONFIGURAÇÃO DO BANCO DE DADOS (GOOGLE SHEETS)
// =========================================================================================
const DEFAULT_SPREADSHEET_ID = '17mHd8eqKoj7Cl6E2MCkr0PczFj-lKv_vmFRCY5hypwg'; 
const DEFAULT_GID = '1276925607';

const STORAGE_KEY_DB_SOURCE = 'cashflow_db_source_id';
const STORAGE_KEY_DB_GID = 'cashflow_db_gid';

export const BackendService = {
  
  isProduction: (): boolean => true,

  getSpreadsheetId: (): string => {
    return localStorage.getItem(STORAGE_KEY_DB_SOURCE) || DEFAULT_SPREADSHEET_ID;
  },

  getSpreadsheetGid: (): string => {
    return localStorage.getItem(STORAGE_KEY_DB_GID) || DEFAULT_GID;
  },

  updateSpreadsheetId: (input: string): void => {
    let cleanedId = input.trim();
    let gid = DEFAULT_GID;

    const gidMatch = input.match(/[?&]gid=([0-9]+)/) || input.match(/#gid=([0-9]+)/);
    if (gidMatch && gidMatch[1]) {
      gid = gidMatch[1];
    } else {
       if (cleanedId !== DEFAULT_SPREADSHEET_ID) {
           gid = '0'; 
       }
    }

    if (cleanedId.includes('/d/')) {
        const match = cleanedId.match(/\/d\/([a-zA-Z0-9-_]+)/);
        if (match && match[1]) {
            cleanedId = match[1];
        }
    }

    localStorage.setItem(STORAGE_KEY_DB_SOURCE, cleanedId);
    localStorage.setItem(STORAGE_KEY_DB_GID, gid);
  },

  resetSpreadsheetId: (): void => {
    localStorage.removeItem(STORAGE_KEY_DB_SOURCE);
    localStorage.removeItem(STORAGE_KEY_DB_GID);
  },

  fetchTransactions: async (): Promise<Transaction[]> => {
    const spreadsheetId = BackendService.getSpreadsheetId();
    const gid = BackendService.getSpreadsheetGid();
    
    const csvUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/export?format=csv&gid=${gid}`; 
    console.log(`Conectando à planilha: ${spreadsheetId} (Tab: ${gid})...`);
    
    try {
      const response = await fetch(csvUrl);
      
      if (!response.ok) {
        throw new Error(`Erro HTTP: ${response.status}. Verifique o ID e o compartilhamento.`);
      }
      
      let csvText = await response.text();

      if (csvText.charCodeAt(0) === 0xFEFF) {
        csvText = csvText.slice(1);
      }

      if (csvText.trim().startsWith('<!DOCTYPE html>') || csvText.includes('<html')) {
        throw new Error('A planilha está privada. Altere o compartilhamento para "Qualquer pessoa com o link".');
      }

      const rows = csvText.split(/\r?\n/);
      
      if (rows.length < 2) {
        return [];
      }

      // --- DYNAMIC HEADER MAPPING ---
      const headerRow = parseCSVLine(rows[0]);
      console.log('Headers detectados:', headerRow);
      
      const map = mapHeaders(headerRow);
      console.log('Mapeamento final:', map);

      if (map.date === -1 && map.valuePaid === -1 && map.valueReceived === -1) {
          throw new Error('Colunas obrigatórias não encontradas. Verifique se a aba correta (GID) foi carregada.');
      }

      // Parse Data
      const dataRows = rows.slice(1).filter(row => row.trim() !== '');

      return dataRows.map((rowString, index) => {
        const cols = parseCSVLine(rowString);
        const get = (idx: number) => (idx !== -1 && cols[idx] !== undefined) ? cols[idx] : '';

        // Extract raw values
        const rawId = get(map.id);
        const rawDate = get(map.date);
        const rawValorPago = get(map.valuePaid);
        const rawValorRecebido = get(map.valueReceived);
        const rawStatus = get(map.status);
        const rawMovimento = get(map.movement);

        // ID Logic: Use mapped column if valid, otherwise generate virtual ID
        // Prevent using timestamp-like strings as ID if specific ID column wasn't found (fallback safety)
        let finalId = `trx-${index}`;
        if (map.id !== -1 && rawId && rawId.trim().length > 0) {
            // Simple heuristic: IDs usually aren't super long sentences or timestamps (unless uuid)
            // If it looks like a timestamp (contains :) and we are not sure it's an ID, skip it.
            // But if header was explicitly "ID", we trust it.
            finalId = rawId.trim();
        }

        return {
          id: finalId,
          date: parseDate(rawDate),
          bankAccount: cleanString(get(map.bankAccount)) || 'Outros',
          type: cleanString(get(map.type)) || 'Outros',
          status: normalizeStatus(rawStatus),
          client: cleanString(get(map.client)) || 'Consumidor',
          paidBy: cleanString(get(map.paidBy)) || 'Financeiro',
          movement: normalizeMovement(rawMovimento, rawValorPago, rawValorRecebido),
          valuePaid: parseCurrency(rawValorPago),
          valueReceived: parseCurrency(rawValorRecebido),
        } as Transaction;
      });

    } catch (error: any) {
      console.error('Erro ao buscar dados:', error);
      throw new Error(error.message || 'Falha na conexão com a planilha.');
    }
  },

  fetchUsers: async (): Promise<User[]> => {
    return MOCK_USERS.map(({ passwordHash, ...u }) => u as User);
  },

  login: async (username: string, passwordHashInput: string): Promise<{ success: boolean; user?: User; message?: string }> => {
    const user = MOCK_USERS.find(u => u.username === username);
    if (!user) return { success: false, message: 'Usuário não encontrado.' };
    
    if (passwordHashInput === user.passwordHash && user.active) {
      const { passwordHash, ...safeUser } = user;
      return { success: true, user: safeUser as User };
    }
    return { success: false, message: 'Senha incorreta.' };
  },

  requestPasswordReset: async (username: string): Promise<{ success: boolean; message: string }> => {
    return { success: true, message: 'Solicitação enviada (Simulado).' };
  }
};

// --- HELPERS ---

function cleanString(str: string): string {
    return str ? str.replace(/^["']|["']$/g, '').trim() : '';
}

function normalizeHeader(h: string): string {
    if (!h) return '';
    return h.toLowerCase()
            .trim()
            .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // Remove acentos
            .replace(/[^a-z0-9]/g, ''); // Remove símbolos e espaços
}

// Maps CSV headers to internal field indices
function mapHeaders(headers: string[]) {
    const map = {
        id: -1, date: -1, bankAccount: -1, type: -1, status: -1, 
        client: -1, paidBy: -1, movement: -1, valuePaid: -1, valueReceived: -1
    };

    // Helper to check for multiple keywords
    const matches = (norm: string, keywords: string[]) => keywords.some(k => norm.includes(k));
    const exact = (norm: string, keywords: string[]) => keywords.some(k => norm === k);

    headers.forEach((h, i) => {
        const norm = normalizeHeader(h);
        
        // 1. ID - Expanded keywords
        if (exact(norm, ['id', 'cod', 'codigo', 'n', 'no', 'num', 'numero', 'identificador', 'documento', 'doc', 'controle'])) {
            map.id = i;
        } else if (matches(norm, ['id', 'cod', 'num']) && !matches(norm, ['cliente', 'conta', 'banco', 'nome', 'pedido'])) {
             // Only partial match if it doesn't look like "Nome do Cliente" or "Conta Banco"
             if (map.id === -1) map.id = i;
        }

        // 2. DATE - Logic to prefer "Vencimento" over "Pagamento" over "Carimbo"
        else if (matches(norm, ['data', 'dt', 'date', 'vencimento', 'competencia', 'periodo'])) {
            // If we found a "Carimbo" before, overwrite it.
            // If we found "Data", but this is "Vencimento", overwrite it.
            const isVenc = matches(norm, ['vencimento', 'venc', 'competencia']);
            const currentIsVenc = map.date !== -1 && matches(normalizeHeader(headers[map.date]), ['vencimento', 'venc', 'competencia']);
            
            // Negative check: ignore timestamp/carimbo unless it's the only option
            const isTimestamp = matches(norm, ['carimbo', 'timestamp', 'hora', 'registro']);

            if (isTimestamp) {
                // Only use timestamp if we have nothing else
                if (map.date === -1) map.date = i;
            } else {
                // It's a real date column
                if (isVenc || !currentIsVenc) {
                    map.date = i;
                }
            }
        }
        
        else if (matches(norm, ['conta', 'banco', 'instituicao', 'origem'])) map.bankAccount = i;
        else if (matches(norm, ['tipo', 'categoria', 'classificacao', 'natureza'])) map.type = i;
        else if (matches(norm, ['status', 'situacao', 'estado'])) map.status = i;
        else if (matches(norm, ['cliente', 'descricao', 'nome', 'favorecido', 'fornecedor', 'historico'])) map.client = i;
        else if (matches(norm, ['pago', 'responsavel', 'departamento', 'centro']) && !matches(norm, ['valor'])) map.paidBy = i; 
        else if (matches(norm, ['movimento', 'entradasaida', 'operacao', 'fluxo'])) map.movement = i;
        
        // Values - checking for specific 'pago'/'recebido' or generic 'valor' + 'saida'/'entrada'
        else if (matches(norm, ['valorpago', 'saida', 'debito', 'despesa']) && matches(norm, ['valor', 'total', 'r'])) map.valuePaid = i;
        else if (matches(norm, ['valorrecebido', 'entrada', 'credito', 'receita']) && matches(norm, ['valor', 'total', 'r'])) map.valueReceived = i;
    });

    // Fallbacks
    if (map.date === -1 && headers.length > 1) map.date = 1; // Assume Col 1 is date if Col 0 is timestamp
    if (map.valuePaid === -1) map.valuePaid = 8;
    if (map.valueReceived === -1) map.valueReceived = 9;

    return map;
}

function parseCSVLine(text: string): string[] {
  const result: string[] = [];
  let curVal = '';
  let inQuote = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (inQuote) {
      if (char === '"') {
        if (i + 1 < text.length && text[i + 1] === '"') { curVal += '"'; i++; }
        else { inQuote = false; }
      } else { curVal += char; }
    } else {
      if (char === '"') { inQuote = true; }
      else if (char === ',') { result.push(curVal); curVal = ''; }
      else if (char === '\r') {} 
      else { curVal += char; }
    }
  }
  result.push(curVal);
  return result;
}

function parseCurrency(val: string | undefined): number {
  if (!val) return 0;
  let clean = val.replace(/^["']|["']$/g, '').trim();
  clean = clean.replace(/[R$\s]/g, '');
  
  if (clean === '-' || clean === '') return 0;

  const lastComma = clean.lastIndexOf(',');
  const lastDot = clean.lastIndexOf('.');

  if (lastComma > lastDot) {
      clean = clean.replace(/\./g, '').replace(',', '.');
  } else if (lastDot > lastComma) {
      clean = clean.replace(/,/g, '');
  }

  const num = parseFloat(clean);
  return isNaN(num) ? 0 : num;
}

function normalizeStatus(val: string | undefined): 'Pago' | 'Pendente' | 'Agendado' {
  if (!val) return 'Pendente';
  const v = normalizeHeader(val);
  if (v.includes('pago') || v === 'sim' || v === 'ok' || v === 'liquidado' || v === 'efetivado') return 'Pago';
  if (v.includes('agenda') || v.includes('futuro')) return 'Agendado';
  return 'Pendente';
}

function normalizeMovement(val: string | undefined, vPaid: string, vRec: string): 'Entrada' | 'Saída' {
    if (val) {
        const v = normalizeHeader(val);
        if (v.includes('saida') || v.includes('debito') || v.includes('pagar') || v.includes('despesa')) return 'Saída';
        if (v.includes('entrada') || v.includes('credito') || v.includes('receber') || v.includes('receita')) return 'Entrada';
    }
    const p = parseCurrency(vPaid);
    const r = parseCurrency(vRec);
    if (p > 0 && r === 0) return 'Saída';
    if (r > 0 && p === 0) return 'Entrada';
    
    return 'Saída'; 
}

function parseDate(dateStr: string | undefined): string {
  if (!dateStr) return new Date().toISOString().split('T')[0];
  let clean = dateStr.replace(/^["']|["']$/g, '').trim();
  
  // Remove Time part if exists
  if (clean.includes(' ')) {
      clean = clean.split(' ')[0];
  }

  // FORCE MANUAL PARSING FOR DD/MM/YYYY (Common in BR/Sheets)
  const brDateRegex = /^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})/;
  const match = clean.match(brDateRegex);
  
  if (match) {
      const day = match[1].padStart(2, '0');
      const month = match[2].padStart(2, '0');
      let year = match[3];
      if (year.length === 2) year = '20' + year;
      
      return `${year}-${month}-${day}`;
  }
  
  // YYYY-MM-DD
  if (clean.match(/^\d{4}-\d{2}-\d{2}/)) {
      return clean.substring(0, 10);
  }

  // Fallback
  const d = new Date(clean);
  if (!isNaN(d.getTime())) return d.toISOString().split('T')[0];

  return new Date().toISOString().split('T')[0];
}