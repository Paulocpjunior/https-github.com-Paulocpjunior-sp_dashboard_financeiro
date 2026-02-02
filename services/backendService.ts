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

      // Remove BOM if present
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

      // --- ROBUST CSV PARSING ---
      // 1. Extract Headers
      const headerRow = parseCSVLineRegex(rows[0]);
      console.log('Headers Brutos:', headerRow);
      
      // 2. Map Headers
      const map = mapHeaders(headerRow);
      console.log('Mapa de Colunas:', map);

      if (map.date === -1 && map.valuePaid === -1 && map.valueReceived === -1) {
          console.warn("Mapeamento falhou para colunas críticas. Tentando fallback posicional.");
      }

      // 3. Parse Data Rows
      const dataRows = rows.slice(1).filter(row => row.trim() !== '');

      return dataRows.map((rowString, index) => {
        const cols = parseCSVLineRegex(rowString);
        
        // Helper to safely get value at index
        const get = (idx: number) => (idx !== -1 && cols[idx] !== undefined) ? cols[idx] : '';

        const rawId = get(map.id);
        const rawDate = get(map.date);
        const rawValorPago = get(map.valuePaid);
        const rawValorRecebido = get(map.valueReceived);
        const rawStatus = get(map.status);
        const rawMovimento = get(map.movement);

        // ID Logic
        let finalId = `trx-${index}`;
        if (map.id !== -1 && rawId && rawId.trim().length > 0) {
            // Avoid using timestamps as IDs if header mapping was fuzzy
            if (!rawId.includes(':') || map.idIsExplicit) {
               finalId = rawId.trim();
            }
        }

        return {
          id: finalId,
          date: parseDateStrictPTBR(rawDate),
          bankAccount: cleanString(get(map.bankAccount)) || 'Outros',
          type: cleanString(get(map.type)) || 'Outros',
          status: normalizeStatus(rawStatus),
          client: cleanString(get(map.client)) || 'Consumidor',
          paidBy: cleanString(get(map.paidBy)) || 'Financeiro',
          movement: normalizeMovement(rawMovimento, rawValorPago, rawValorRecebido),
          valuePaid: parseCurrencyBRL(rawValorPago),
          valueReceived: parseCurrencyBRL(rawValorRecebido),
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
            .normalize("NFD").replace(/[\u0300-\u036f]/g, "") 
            .replace(/[^a-z0-9]/g, '');
}

// Robust CSV Line Parser using Regex to handle quotes properly
function parseCSVLineRegex(text: string): string[] {
    // Matches: "quoted value" OR value_without_quotes
    const regex = /(?:^|,)(?:"([^"]*(?:""[^"]*)*)"|([^",]*))/g;
    const results: string[] = [];
    let match;
    
    // JS Regex is stateful when using /g, we loop through matches
    while ((match = regex.exec(text)) !== null) {
        // match[1] is quoted content (unescape double quotes), match[2] is unquoted
        let val = match[1] !== undefined ? match[1].replace(/""/g, '"') : match[2];
        results.push(val || '');
    }
    
    // Remove the last empty match that regex exec might produce at end of string if it ends with comma
    // However, the above loop works well for standard CSV.
    // If the string is empty, we return empty array, but here we likely have content.
    return results;
}

function mapHeaders(headers: string[]) {
    const map = {
        id: -1, 
        idIsExplicit: false,
        date: -1, 
        bankAccount: -1, 
        type: -1, 
        status: -1, 
        client: -1, 
        paidBy: -1, 
        movement: -1, 
        valuePaid: -1, 
        valueReceived: -1
    };

    const matches = (norm: string, keywords: string[]) => keywords.some(k => norm.includes(k));

    headers.forEach((h, i) => {
        const norm = normalizeHeader(h);
        
        // 1. ID
        if (matches(norm, ['idtransacao', 'codigotransacao', 'identifier'])) {
            map.id = i;
            map.idIsExplicit = true;
        } else if (norm === 'id' || norm === 'cod' || norm === 'codigo') {
            map.id = i;
            map.idIsExplicit = true;
        }

        // 2. DATE (Priority logic)
        // Avoid "carimbo" or "timestamp" unless it's the only thing we have.
        // Prefer "Vencimento", "Data", "Competencia"
        if (matches(norm, ['data', 'dt', 'vencimento', 'competencia'])) {
            const isTimestamp = matches(norm, ['carimbo', 'timestamp', 'hora']);
            
            if (!isTimestamp) {
                // Good date
                if (map.date === -1) {
                    map.date = i;
                } else {
                    // If we already have a date, prefer "Vencimento" over generic "Data"
                    const currentHeader = normalizeHeader(headers[map.date]);
                    if (matches(norm, ['vencimento']) && !currentHeader.includes('vencimento')) {
                         map.date = i;
                    }
                }
            } else {
                 // It is timestamp. Only take if we have nothing else.
                 if (map.date === -1) map.date = i;
            }
        }

        // 3. Other fields
        else if (matches(norm, ['conta', 'banco', 'instituicao'])) map.bankAccount = i;
        else if (matches(norm, ['tipo', 'categoria', 'classificacao'])) map.type = i;
        else if (matches(norm, ['status', 'situacao'])) map.status = i;
        else if (matches(norm, ['cliente', 'descricao', 'nome', 'historico'])) map.client = i;
        else if (matches(norm, ['pago', 'responsavel']) && !matches(norm, ['valor'])) map.paidBy = i; 
        else if (matches(norm, ['movimento', 'entradasaida'])) map.movement = i;
        
        // 4. Values (Strict check for Pago vs Recebido)
        else if (matches(norm, ['valorpago', 'saida', 'debito', 'despesa'])) map.valuePaid = i;
        else if (matches(norm, ['valorrecebido', 'entrada', 'credito', 'receita'])) map.valueReceived = i;
    });

    // Fallbacks
    if (map.date === -1 && headers.length > 1) {
        // Common pattern: Col 0 = Timestamp, Col 1 = Data
        map.date = 1; 
    }
    
    // Value Fallbacks (common positions in financial sheets)
    if (map.valuePaid === -1 && map.valueReceived === -1) {
        // Try to find generic "Valor" columns
        const valorCols = headers.map((h, i) => ({h, i})).filter(o => normalizeHeader(o.h).includes('valor'));
        if (valorCols.length >= 2) {
             // Assume first is Out, second is In, or vice versa? 
             // Usually Debit Left, Credit Right.
             map.valuePaid = valorCols[0].i;
             map.valueReceived = valorCols[1].i;
        } else if (valorCols.length === 1) {
             // Single value column? We might rely on "Movement" column to determine sign
             map.valuePaid = valorCols[0].i; // Store in paid, will distribute later based on movement
        }
    }

    return map;
}

// STRICT BRL CURRENCY PARSER
// Handles: "R$ 1.200,50", "1.200,50", "1000", "1,50"
function parseCurrencyBRL(val: string | undefined): number {
  if (!val) return 0;
  
  // Remove spaces, currency symbols
  let clean = val.replace(/^["']|["']$/g, '').trim(); // Remove surrounding quotes
  clean = clean.replace(/[R$\s]/g, ''); // Remove R$ and spaces
  
  if (!clean || clean === '-') return 0;

  // Check format
  const hasComma = clean.includes(',');
  const hasDot = clean.includes('.');

  // BRL Format: 1.250,00 (Dot is thousands, Comma is decimal)
  if (hasComma) {
      if (hasDot) {
          // Remove all dots (thousands)
          clean = clean.replace(/\./g, '');
      }
      // Replace comma with dot for JS parseFloat
      clean = clean.replace(',', '.');
  } 
  // Edge Case: 1200.50 (US format in BRL context?)
  // If only dot exists, checking split length usually tells if it's thousands separator or decimal
  else if (hasDot) {
      const parts = clean.split('.');
      // If last part is exactly 2 digits, treat as decimal? No, ambiguous.
      // Usually spreadsheets export raw numbers like 1200.5 so parseFloat works fine.
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
    const p = parseCurrencyBRL(vPaid);
    const r = parseCurrencyBRL(vRec);
    
    // If we only mapped one value column (e.g. into valuePaid), use logical deduction
    if (p > 0 && r === 0) return 'Saída';
    if (r > 0 && p === 0) return 'Entrada';
    
    return 'Saída'; 
}

// STRICT DATE PARSER FOR PT-BR (DD/MM/YYYY)
function parseDateStrictPTBR(dateStr: string | undefined): string {
  if (!dateStr) return new Date().toISOString().split('T')[0];
  
  let clean = dateStr.replace(/^["']|["']$/g, '').trim();
  
  // 1. Remove Time part if exists (e.g., "17/09/2021 11:17:22")
  if (clean.includes(' ')) {
      clean = clean.split(' ')[0];
  }

  // 2. Handle DD/MM/YYYY (Standard BR)
  // Regex looks for 1 or 2 digits, separator, 1 or 2 digits, separator, 2 or 4 digits
  const ptBrRegex = /^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})/;
  const ptMatch = clean.match(ptBrRegex);

  if (ptMatch) {
      const day = ptMatch[1].padStart(2, '0');
      const month = ptMatch[2].padStart(2, '0');
      let year = ptMatch[3];
      
      if (year.length === 2) year = '20' + year; // Assume 20xx

      // Return YYYY-MM-DD for correct string sorting/filtering in JS
      return `${year}-${month}-${day}`;
  }

  // 3. Handle YYYY-MM-DD (ISO - sometimes Sheets exports this way)
  const isoRegex = /^(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})/;
  const isoMatch = clean.match(isoRegex);
  if (isoMatch) {
      return clean.substring(0, 10);
  }

  // Fallback: If regex fails, let JS Date try, but this is risky with locales.
  // We prefer returning the current date or original string to signal issue, 
  // but to avoid breaking app, we default to today.
  return new Date().toISOString().split('T')[0];
}
