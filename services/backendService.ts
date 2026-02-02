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

      // --- SMART HEADER DETECTION ---
      // Instead of assuming row 0, we scan the first 10 rows for the best header candidate.
      const headerRowIndex = findHeaderRowIndex(rows);
      console.log(`Cabeçalho detectado na linha: ${headerRowIndex}`);

      const headerRow = parseCSVLineRegex(rows[headerRowIndex]);
      console.log('Headers Brutos:', headerRow);
      
      const map = mapHeaders(headerRow);
      console.log('Mapa de Colunas:', map);

      if (map.date === -1 && map.valuePaid === -1 && map.valueReceived === -1) {
          console.warn("Mapeamento falhou para colunas críticas.");
      }

      // Parse Data Rows (Start from HeaderIndex + 1)
      const dataRows = rows.slice(headerRowIndex + 1).filter(row => row.trim() !== '');

      return dataRows.map((rowString, index) => {
        const cols = parseCSVLineRegex(rowString);
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
            if (!rawId.includes(':') || map.idIsExplicit) {
               finalId = rawId.trim();
            }
        }

        return {
          id: finalId,
          // Use safe parsing that defaults to 1970 if invalid, avoiding pollution of "Current Month" view
          date: parseDateSafely(rawDate),
          bankAccount: cleanString(get(map.bankAccount)) || 'Outros',
          type: cleanString(get(map.type)) || 'Outros',
          status: normalizeStatus(rawStatus),
          client: cleanString(get(map.client)) || 'Consumidor',
          paidBy: cleanString(get(map.paidBy)) || 'Financeiro',
          movement: normalizeMovement(rawMovimento, rawValorPago, rawValorRecebido),
          valuePaid: parseCurrencyRobust(rawValorPago),
          valueReceived: parseCurrencyRobust(rawValorRecebido),
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

function findHeaderRowIndex(rows: string[]): number {
    let bestIndex = 0;
    let maxScore = 0;
    const limit = Math.min(rows.length, 15); // Scan first 15 rows

    for (let i = 0; i < limit; i++) {
        const row = rows[i].toLowerCase();
        let score = 0;
        
        // Keywords scoring
        if (row.includes('data') || row.includes('date') || row.includes('vencimento')) score += 3;
        if (row.includes('valor') || row.includes('amount') || row.includes('total')) score += 3;
        if (row.includes('conta') || row.includes('banco') || row.includes('bank')) score += 2;
        if (row.includes('status') || row.includes('situacao')) score += 2;
        if (row.includes('cliente') || row.includes('descricao')) score += 2;
        if (row.includes('id') || row.includes('cod')) score += 1;

        if (score > maxScore) {
            maxScore = score;
            bestIndex = i;
        }
    }
    return bestIndex;
}

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

function parseCSVLineRegex(text: string): string[] {
    const regex = /(?:^|,)(?:"([^"]*(?:""[^"]*)*)"|([^",]*))/g;
    const results: string[] = [];
    let match;
    while ((match = regex.exec(text)) !== null) {
        let val = match[1] !== undefined ? match[1].replace(/""/g, '"') : match[2];
        results.push(val || '');
    }
    return results;
}

function mapHeaders(headers: string[]) {
    const map = {
        id: -1, idIsExplicit: false, date: -1, bankAccount: -1, 
        type: -1, status: -1, client: -1, paidBy: -1, movement: -1, 
        valuePaid: -1, valueReceived: -1
    };

    const matches = (norm: string, keywords: string[]) => keywords.some(k => norm.includes(k));

    headers.forEach((h, i) => {
        const norm = normalizeHeader(h);
        
        if (matches(norm, ['idtransacao', 'codigotransacao', 'identifier'])) {
            map.id = i; map.idIsExplicit = true;
        } else if (norm === 'id' || norm === 'cod' || norm === 'codigo') {
            map.id = i; map.idIsExplicit = true;
        }

        else if (matches(norm, ['data', 'dt', 'vencimento', 'competencia'])) {
            const isTimestamp = matches(norm, ['carimbo', 'timestamp', 'hora']);
            if (!isTimestamp) {
                if (map.date === -1) {
                    map.date = i;
                } else {
                    const currentHeader = normalizeHeader(headers[map.date]);
                    if (matches(norm, ['vencimento']) && !currentHeader.includes('vencimento')) {
                         map.date = i;
                    }
                }
            } else if (map.date === -1) map.date = i;
        }

        else if (matches(norm, ['conta', 'banco', 'instituicao'])) map.bankAccount = i;
        else if (matches(norm, ['tipo', 'categoria', 'classificacao'])) map.type = i;
        else if (matches(norm, ['status', 'situacao'])) map.status = i;
        else if (matches(norm, ['cliente', 'descricao', 'nome', 'historico'])) map.client = i;
        else if (matches(norm, ['pago', 'responsavel']) && !matches(norm, ['valor'])) map.paidBy = i; 
        else if (matches(norm, ['movimento', 'entradasaida'])) map.movement = i;
        
        else if (matches(norm, ['valorpago', 'saida', 'debito', 'despesa']) && !matches(norm, ['pago por'])) map.valuePaid = i;
        else if (matches(norm, ['valorrecebido', 'entrada', 'credito', 'receita'])) map.valueReceived = i;
    });

    if (map.date === -1 && headers.length > 1) map.date = 1; 
    
    // Value Fallbacks
    if (map.valuePaid === -1 && map.valueReceived === -1) {
        const valorCols = headers.map((h, i) => ({h, i})).filter(o => normalizeHeader(o.h).includes('valor'));
        if (valorCols.length >= 2) {
             map.valuePaid = valorCols[0].i;
             map.valueReceived = valorCols[1].i;
        } else if (valorCols.length === 1) {
             map.valuePaid = valorCols[0].i;
        }
    }

    return map;
}

// ROBUST CURRENCY PARSER (Detects decimal separator automatically)
function parseCurrencyRobust(val: string | undefined): number {
  if (!val) return 0;
  
  let clean = val.replace(/^["']|["']$/g, '').trim(); 
  clean = clean.replace(/[R$\s]/g, ''); 
  
  if (!clean || clean === '-') return 0;

  const lastComma = clean.lastIndexOf(',');
  const lastDot = clean.lastIndexOf('.');

  // Logic to determine which is decimal
  if (lastComma > lastDot) {
      // Comma is likely decimal (BRL style: 1.200,00)
      clean = clean.replace(/\./g, '').replace(',', '.');
  } else if (lastDot > lastComma) {
      // Dot is likely decimal (US style: 1,200.00)
      clean = clean.replace(/,/g, '');
  } else if (lastComma > -1 && lastDot === -1) {
       // Only comma exists (e.g. 50,00). Treat as decimal for BRL context.
       clean = clean.replace(',', '.');
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
    const p = parseCurrencyRobust(vPaid);
    const r = parseCurrencyRobust(vRec);
    
    if (p > 0 && r === 0) return 'Saída';
    if (r > 0 && p === 0) return 'Entrada';
    return 'Saída'; 
}

// SAFE DATE PARSER (Returns '1970-01-01' on failure instead of Today to avoid pollution)
function parseDateSafely(dateStr: string | undefined): string {
  if (!dateStr) return '1970-01-01'; // Safe fallback
  
  let clean = dateStr.replace(/^["']|["']$/g, '').trim();
  if (clean.includes(' ')) clean = clean.split(' ')[0];

  // DD/MM/YYYY
  const ptBrRegex = /^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})/;
  const ptMatch = clean.match(ptBrRegex);

  if (ptMatch) {
      const day = ptMatch[1].padStart(2, '0');
      const month = ptMatch[2].padStart(2, '0');
      let year = ptMatch[3];
      if (year.length === 2) year = '20' + year;
      return `${year}-${month}-${day}`;
  }

  // YYYY-MM-DD
  const isoRegex = /^(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})/;
  const isoMatch = clean.match(isoRegex);
  if (isoMatch) {
      return clean.substring(0, 10);
  }

  return '1970-01-01';
}