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
    let gid = DEFAULT_GID; // Fallback to default if not found in URL, or keep existing? Better to reset to safe default or 0.

    // 1. Tenta extrair o GID da URL (parâmetro gid=...)
    const gidMatch = input.match(/[?&]gid=([0-9]+)/) || input.match(/#gid=([0-9]+)/);
    if (gidMatch && gidMatch[1]) {
      gid = gidMatch[1];
    } else {
       // Se o usuário digitou apenas um ID novo sem URL, assumimos 0 ou mantemos o padrão? 
       // Por segurança, se não tem URL, resetamos para 0 (primeira aba) a não ser que seja o ID padrão.
       if (cleanedId !== DEFAULT_SPREADSHEET_ID) {
           gid = '0'; 
       }
    }

    // 2. Tenta extrair o ID da URL
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
    
    // Constrói a URL usando o GID específico
    const csvUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/export?format=csv&gid=${gid}`; 

    console.log(`Conectando à planilha: ${spreadsheetId} (Tab: ${gid})...`);
    
    try {
      const response = await fetch(csvUrl);
      
      // Verifica se o fetch falhou na rede
      if (!response.ok) {
        throw new Error(`Erro HTTP: ${response.status}. Verifique o ID e o compartilhamento.`);
      }
      
      const csvText = await response.text();

      // CRITICAL CHECK: Verify if response is HTML (Login Page)
      if (csvText.trim().startsWith('<!DOCTYPE html>') || csvText.includes('<html')) {
        throw new Error('A planilha está privada ou o link está incorreto. Altere o compartilhamento para "Qualquer pessoa com o link".');
      }

      const rows = csvText.split(/\r?\n/);
      
      if (rows.length < 2) {
        return []; // Sem dados
      }

      // --- DYNAMIC HEADER MAPPING ---
      // Instead of hardcoded indices, find columns by name.
      const headerRow = parseCSVLine(rows[0]);
      const map = mapHeaders(headerRow);

      if (map.date === -1 && map.valuePaid === -1 && map.valueReceived === -1) {
          console.warn("Headers found:", headerRow);
          // Se não achou headers, pode ser que a aba esteja errada ou vazia.
          // Mas tentamos prosseguir com fallback ou lançamos erro.
          throw new Error('Colunas obrigatórias não encontradas. Verifique se a aba correta (GID) foi carregada.');
      }

      // Parse Data
      const dataRows = rows.slice(1).filter(row => row.trim() !== '');

      return dataRows.map((rowString, index) => {
        const cols = parseCSVLine(rowString);
        
        // Helper to safely get value by mapped index
        const get = (idx: number) => (idx !== -1 && cols[idx] !== undefined) ? cols[idx] : '';

        // Extract raw values using the map
        const rawDate = get(map.date);
        const rawValorPago = get(map.valuePaid);
        const rawValorRecebido = get(map.valueReceived);
        const rawStatus = get(map.status);
        const rawMovimento = get(map.movement);

        return {
          id: get(map.id) || `trx-${index}`,
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

// Remove quotes and extra spaces
function cleanString(str: string): string {
    return str ? str.replace(/^["']|["']$/g, '').trim() : '';
}

function normalizeHeader(h: string): string {
    return h.toLowerCase()
            .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // Remove accents
            .replace(/[^a-z0-9]/g, ''); // Remove symbols
}

// Maps CSV headers to internal field indices
function mapHeaders(headers: string[]) {
    const map = {
        id: -1, date: -1, bankAccount: -1, type: -1, status: -1, 
        client: -1, paidBy: -1, movement: -1, valuePaid: -1, valueReceived: -1
    };

    headers.forEach((h, i) => {
        const norm = normalizeHeader(h);
        if (norm.includes('id') && norm.length < 5) map.id = i;
        else if (norm.includes('data') || norm === 'dt') map.date = i;
        else if (norm.includes('conta') || norm.includes('banco')) map.bankAccount = i;
        else if (norm.includes('tipo') || norm.includes('categoria')) map.type = i;
        else if (norm.includes('status') || norm.includes('situacao')) map.status = i;
        else if (norm.includes('cliente') || norm.includes('descricao') || norm.includes('nome')) map.client = i;
        else if (norm.includes('pago') && !norm.includes('valor')) map.paidBy = i; // 'PagoPor'
        else if (norm.includes('movimento') || norm.includes('entradasaida')) map.movement = i;
        else if (norm.includes('valorpago') || (norm.includes('valor') && norm.includes('saida'))) map.valuePaid = i;
        else if (norm.includes('valorrecebido') || (norm.includes('valor') && norm.includes('entrada'))) map.valueReceived = i;
    });

    // Fallback for default column order if mapping failed for critical fields
    if (map.date === -1) map.date = 1;
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

  // Detect format: 
  // 1.234,56 (BR) -> last separator is comma
  // 1,234.56 (US) -> last separator is dot
  const lastComma = clean.lastIndexOf(',');
  const lastDot = clean.lastIndexOf('.');

  if (lastComma > lastDot) {
      // BR Format: remove dots, replace comma with dot
      clean = clean.replace(/\./g, '').replace(',', '.');
  } else if (lastDot > lastComma) {
      // US Format: remove commas
      clean = clean.replace(/,/g, '');
  }

  const num = parseFloat(clean);
  return isNaN(num) ? 0 : num;
}

function normalizeStatus(val: string | undefined): 'Pago' | 'Pendente' | 'Agendado' {
  if (!val) return 'Pendente';
  const v = normalizeHeader(val);
  if (v.includes('pago') || v === 'sim' || v === 'ok' || v === 'liquidado') return 'Pago';
  if (v.includes('agenda') || v.includes('futuro')) return 'Agendado';
  return 'Pendente';
}

function normalizeMovement(val: string | undefined, vPaid: string, vRec: string): 'Entrada' | 'Saída' {
    // 1. Try explicit column
    if (val) {
        const v = normalizeHeader(val);
        if (v.includes('saida') || v.includes('debito') || v.includes('pagar')) return 'Saída';
        if (v.includes('entrada') || v.includes('credito') || v.includes('receber')) return 'Entrada';
    }
    // 2. Infer from values
    const p = parseCurrency(vPaid);
    const r = parseCurrency(vRec);
    if (p > 0 && r === 0) return 'Saída';
    if (r > 0 && p === 0) return 'Entrada';
    
    return 'Saída'; // Default
}

function parseDate(dateStr: string | undefined): string {
  if (!dateStr) return new Date().toISOString().split('T')[0];
  const clean = dateStr.replace(/^["']|["']$/g, '').trim();
  
  // Handle Excel serial numbers (if any) - unlikely in CSV but possible
  if (/^\d+$/.test(clean)) {
      // Simplified check, usually not needed for web CSV export
  }

  // DD/MM/YYYY
  if (clean.match(/^\d{1,2}\/\d{1,2}\/\d{2,4}/)) {
      const parts = clean.split('/');
      let y = parts[2];
      if (y.length === 2) y = '20' + y;
      const m = parts[1].padStart(2, '0');
      const d = parts[0].padStart(2, '0');
      return `${y}-${m}-${d}`;
  }
  
  // YYYY-MM-DD
  if (clean.match(/^\d{4}-\d{2}-\d{2}/)) {
      return clean.substring(0, 10);
  }

  // Fallback try parse
  const d = new Date(clean);
  if (!isNaN(d.getTime())) return d.toISOString().split('T')[0];

  return new Date().toISOString().split('T')[0];
}