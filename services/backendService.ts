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

      // 1. Detect Delimiter
      const delimiter = detectDelimiter(rows.slice(0, 20));
      console.log(`Delimitador detectado: "${delimiter}"`);

      // 2. Find Header Row
      const headerRowIndex = findHeaderRowIndex(rows, delimiter);
      console.log(`Cabeçalho detectado na linha: ${headerRowIndex}`);

      const headerRow = parseCSVLineRegex(rows[headerRowIndex], delimiter);
      console.log('=== CABEÇALHOS ENCONTRADOS ===');
      headerRow.forEach((h, i) => console.log(`  [${i}] "${h}"`));
      
      // 3. MAPEAMENTO FIXO POR ÍNDICE - BASEADO NA ESTRUTURA REAL DA PLANILHA
      // =====================================================================
      // A = 0:  #N/A (timestamp)
      // B = 1:  Data Lançamento
      // C = 2:  Contas bancárias
      // D = 3:  Tipo de Lançamento
      // E = 4:  Pago Por
      // F = 5:  Movimentação
      // G = 6:  Data Lançamento 2
      // H = 7:  Data a Pagar
      // I = 8:  Evento Recorrente
      // J = 9:  Doc.Pago
      // K = 10: Data Baixa / Pagamento
      // L = 11: Valor Ref./Valor Original
      // M = 12: Valor Original Recorrente
      // N = 13: Valor Pago
      // ...
      // AA = 26: Nome Empresa / Credor
      // AB = 27: Valor Honorários
      // AC = 28: Valor Extras
      // AD = 29: Cobranças Extras
      // AE = 30: Total Cobrança
      // AF = 31: Valor Recebido
      // =====================================================================
      
      const map = {
        id: 38,           // AN: Submission ID
        date: 1,          // B: Data Lançamento
        dueDate: 7,       // H: Data a Pagar
        bankAccount: 2,   // C: Contas bancárias
        type: 3,          // D: Tipo de Lançamento
        paidBy: 4,        // E: Pago Por
        movement: 5,      // F: Movimentação (pode estar vazia)
        status: 9,        // J: Doc.Pago
        client: 26,       // AA: Nome Empresa / Credor
        valuePaid: 13,    // N: Valor Pago
        valueReceived: 31,// AF: Valor Recebido
        honorarios: 27,   // AB: Valor Honorários
        valorExtra: 28,   // AC: Valor Extras
        totalCobranca: 30 // AE: Total Cobrança
      };

      console.log('=== MAPEAMENTO FIXO APLICADO ===');
      console.log(`  bankAccount [${map.bankAccount}]: "${headerRow[map.bankAccount] || 'N/A'}"`);
      console.log(`  type [${map.type}]: "${headerRow[map.type] || 'N/A'}"`);
      console.log(`  paidBy [${map.paidBy}]: "${headerRow[map.paidBy] || 'N/A'}"`);
      console.log(`  client [${map.client}]: "${headerRow[map.client] || 'N/A'}"`);

      // 4. Parse Data Rows
      const dataRows = rows.slice(headerRowIndex + 1).filter(row => row.trim() !== '');

      const transactions = dataRows.map((rowString, index) => {
        const cols = parseCSVLineRegex(rowString, delimiter);
        const get = (idx: number) => (idx !== -1 && cols[idx] !== undefined) ? cols[idx] : '';

        // Extract Raw Values usando mapeamento fixo
        const rawId = get(map.id);
        const rawDate = get(map.date);
        const rawDueDate = get(map.dueDate);
        const rawValorPago = get(map.valuePaid);
        const rawValorRecebido = get(map.valueReceived);
        const rawStatus = get(map.status);
        const rawMovimento = get(map.movement);
        
        // CAMPOS CRÍTICOS - CÓPIA EXATA DA PLANILHA
        const rawType = get(map.type);
        const rawAccount = get(map.bankAccount);
        const rawPaidBy = get(map.paidBy);
        const rawClient = get(map.client);
        
        // Campos de detalhe
        const rawHonorarios = get(map.honorarios);
        const rawValorExtra = get(map.valorExtra);
        const rawTotalCobranca = get(map.totalCobranca);

        // ID Logic
        let finalId = `trx-${index}`;
        if (rawId && rawId.trim().length > 0 && rawId.length < 50) {
            finalId = rawId.trim();
        }

        // MOVEMENT & VALUES LOGIC
        let movement = normalizeMovement(rawMovimento);
        let valPaid = parseCurrencyRobust(rawValorPago);
        let valReceived = parseCurrencyRobust(rawValorRecebido);

        // Se não tem movimento explícito, inferir dos valores
        if (!rawMovimento || rawMovimento.trim() === '') {
            if (valReceived > 0 && valPaid === 0) {
                movement = 'Entrada';
            } else if (valPaid > 0 && valReceived === 0) {
                movement = 'Saída';
            } else if (valReceived > 0) {
                movement = 'Entrada';
            } else {
                movement = 'Saída';
            }
        }

        // Ensure values are absolute
        valPaid = Math.abs(valPaid);
        valReceived = Math.abs(valReceived);

        // Date Logic
        const finalDate = parseDateSafely(rawDate);
        let finalDueDate = parseDateSafely(rawDueDate);
        
        if (finalDueDate === '1970-01-01' && finalDate !== '1970-01-01') {
            finalDueDate = finalDate;
        }

        return {
          id: finalId,
          date: finalDate,
          dueDate: finalDueDate,
          // CÓPIA FIEL - valores exatos da planilha
          bankAccount: cleanString(rawAccount),
          type: cleanString(rawType),
          paidBy: cleanString(rawPaidBy),
          status: normalizeStatus(rawStatus),
          client: cleanString(rawClient),
          movement: movement,
          valuePaid: valPaid,
          valueReceived: valReceived,
          honorarios: parseCurrencyRobust(rawHonorarios),
          valorExtra: parseCurrencyRobust(rawValorExtra),
          totalCobranca: parseCurrencyRobust(rawTotalCobranca),
        } as Transaction;
      });
      
      // Log sample para debug
      if (transactions.length > 0) {
        console.log('=== AMOSTRA DO PRIMEIRO REGISTRO ===');
        console.log(`  bankAccount: "${transactions[0].bankAccount}"`);
        console.log(`  type: "${transactions[0].type}"`);
        console.log(`  paidBy: "${transactions[0].paidBy}"`);
        console.log(`  client: "${transactions[0].client}"`);
      }

      // Sort by Date Descending
      return transactions.sort((a, b) => {
          if (a.date === b.date) return 0;
          return a.date > b.date ? -1 : 1;
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

function detectDelimiter(rows: string[]): string {
    const validRows = rows.filter(r => r.trim().length > 0);
    if (validRows.length === 0) return ',';

    const getVariance = (delim: string) => {
        const counts = validRows.map(r => r.split(delim).length);
        const avg = counts.reduce((a, b) => a + b, 0) / counts.length;
        if (avg < 2) return 9999;
        const variance = counts.reduce((a, b) => a + Math.pow(b - avg, 2), 0) / counts.length;
        return variance;
    };

    const commaVariance = getVariance(',');
    const semiVariance = getVariance(';');

    console.log(`Delimiter Check - Comma Variance: ${commaVariance}, Semi Variance: ${semiVariance}`);

    if (semiVariance <= commaVariance) return ';';
    return ',';
}

function findHeaderRowIndex(rows: string[], delimiter: string): number {
    // Procurar a linha que contém os cabeçalhos conhecidos
    for (let i = 0; i < Math.min(rows.length, 10); i++) {
        const row = rows[i].toLowerCase();
        // Verificar se contém cabeçalhos específicos da planilha
        if (row.includes('tipo de lan') || 
            row.includes('contas banc') || 
            row.includes('pago por') ||
            row.includes('nome empresa')) {
            console.log(`Header encontrado na linha ${i}: "${rows[i].substring(0, 100)}..."`);
            return i;
        }
    }
    return 0; // Default: primeira linha
}

function cleanString(str: string): string {
    if (!str) return '';
    return str.replace(/^["']|["']$/g, '').trim();
}

function parseCSVLineRegex(text: string, delimiter: string): string[] {
    const delim = delimiter === '.' ? '\\.' : delimiter;
    const pattern = `(?:^|${delim})(?:"([^"]*(?:""[^"]*)*)"|([^"${delim}]*))`;
    const regex = new RegExp(pattern, 'g');
    
    const results: string[] = [];
    let match;
    
    if (!text || text.trim() === '') return [];

    while ((match = regex.exec(text)) !== null) {
        let val = match[1] !== undefined ? match[1].replace(/""/g, '"') : match[2];
        results.push(val ? val.trim() : '');
    }
    return results;
}

function parseCurrencyRobust(val: string | undefined): number {
  if (!val) return 0;
  
  let clean = val.replace(/^["']|["']$/g, '').trim(); 
  clean = clean.replace(/[R$\s]/g, ''); 

  if (clean.startsWith('(') && clean.endsWith(')')) {
      clean = '-' + clean.slice(1, -1);
  }
  
  if (!clean || clean === '-') return 0;

  const lastComma = clean.lastIndexOf(',');
  const lastDot = clean.lastIndexOf('.');

  if (lastComma > lastDot) {
      clean = clean.replace(/\./g, '').replace(',', '.');
  } else if (lastDot > lastComma) {
      clean = clean.replace(/,/g, '');
  } else if (lastComma > -1 && lastDot === -1) {
       clean = clean.replace(',', '.');
  }
  
  clean = clean.replace(/[^0-9.-]/g, '');

  const num = parseFloat(clean);
  return isNaN(num) ? 0 : num;
}

function normalizeStatus(val: string | undefined): 'Pago' | 'Pendente' | 'Agendado' {
  if (!val) return 'Pendente';
  const v = val.toLowerCase().trim();
  if (v === 'sim' || v === 'pago' || v === 'ok' || v === 'liquidado' || v === 'efetivado' || v === 'baixado') return 'Pago';
  if (v === 'não' || v === 'nao' || v === 'pendente' || v === 'aberto') return 'Pendente';
  if (v.includes('agenda') || v.includes('futuro')) return 'Agendado';
  return 'Pendente';
}

function normalizeMovement(val: string | undefined): 'Entrada' | 'Saída' {
    if (!val) return 'Entrada'; // Default para entrada baseado nos dados da planilha
    const v = val.toLowerCase().trim();
    if (v.includes('saida') || v.includes('saída') || v.includes('debito') || v.includes('pagar') || v.includes('despesa')) return 'Saída';
    if (v.includes('entrada') || v.includes('credito') || v.includes('receber') || v.includes('receita')) return 'Entrada';
    return 'Entrada';
}

function parseDateSafely(dateStr: string | undefined): string {
  if (!dateStr) return '1970-01-01';
  
  let clean = dateStr.replace(/^["']|["']$/g, '').trim();
  if (clean.includes(' ')) clean = clean.split(' ')[0];

  // PT-BR Format: DD/MM/YYYY
  const ptBrRegex = /^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})/;
  const ptMatch = clean.match(ptBrRegex);

  if (ptMatch) {
      const day = ptMatch[1].padStart(2, '0');
      const month = ptMatch[2].padStart(2, '0');
      let year = ptMatch[3];
      if (year.length === 2) year = '20' + year;
      return `${year}-${month}-${day}`;
  }

  // ISO Format: YYYY-MM-DD
  const isoRegex = /^(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})/;
  const isoMatch = clean.match(isoRegex);
  if (isoMatch) {
      return clean.substring(0, 10);
  }

  return '1970-01-01';
}