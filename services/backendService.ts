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
      const delimiter = detectDelimiter(rows.slice(0, 5));
      console.log(`Delimitador detectado: "${delimiter}"`);

      // 2. Smart Header Detection
      const headerRowIndex = findHeaderRowIndex(rows, delimiter);
      console.log(`Cabeçalho detectado na linha: ${headerRowIndex}`);

      const headerRow = parseCSVLineRegex(rows[headerRowIndex], delimiter);
      
      // 3. Initial Mapping
      let map = mapHeaders(headerRow);
      console.log('Mapa Inicial:', map);

      // 4. CONTENT-BASED VALIDATION & REMAPPING
      // Extract a sample of data rows (skipping header)
      const dataRows = rows.slice(headerRowIndex + 1).filter(row => row.trim() !== '');
      const sampleSize = Math.min(dataRows.length, 10);
      const sampleData = dataRows.slice(0, sampleSize).map(r => parseCSVLineRegex(r, delimiter));

      if (sampleData.length > 0) {
          map = validateAndRemap(map, sampleData, headerRow.length);
          console.log('Mapa Validado:', map);
      }

      return dataRows.map((rowString, index) => {
        const cols = parseCSVLineRegex(rowString, delimiter);
        const get = (idx: number) => (idx !== -1 && cols[idx] !== undefined) ? cols[idx] : '';

        const rawId = get(map.id);
        const rawDate = get(map.date);
        
        const rawValorPago = get(map.valuePaid);
        const rawValorRecebido = get(map.valueReceived);
        
        const rawStatus = get(map.status);
        const rawMovimento = get(map.movement);

        let finalId = `trx-${index}`;
        if (map.id !== -1 && rawId && rawId.trim().length > 0) {
            if ((!rawId.includes(delimiter) && rawId.length < 50) || map.idIsExplicit) {
               finalId = rawId.trim();
            }
        }

        // MOVEMENT & VALUES LOGIC
        let movement = normalizeMovement(rawMovimento, rawValorPago, rawValorRecebido);
        let valPaid = 0;
        let valReceived = 0;

        const isSingleColumn = map.valueReceived === -1 || map.valuePaid === map.valueReceived;

        if (isSingleColumn) {
            const rawVal = rawValorPago || rawValorRecebido;
            const val = parseCurrencyRobust(rawVal);
            
            // Try to use Movement column to decide sign
            if (movement === 'Entrada') {
                valReceived = val;
                valPaid = 0;
            } else if (movement === 'Saída') {
                valPaid = val;
                valReceived = 0;
            } else {
                 // No movement column? Guess based on sign
                 // Typically negative = Paid, positive = Received
                 if (val < 0) {
                     valPaid = Math.abs(val);
                     valReceived = 0;
                     movement = 'Saída';
                 } else {
                     valReceived = val;
                     valPaid = 0;
                     movement = 'Entrada';
                 }
            }
        } else {
            valPaid = parseCurrencyRobust(rawValorPago);
            valReceived = parseCurrencyRobust(rawValorRecebido);
            
            if (map.movement === -1) {
                if (valPaid > 0 && valReceived === 0) movement = 'Saída';
                if (valReceived > 0 && valPaid === 0) movement = 'Entrada';
            }
        }

        // Final safe conversion for values (handle negative inputs correctly)
        valPaid = Math.abs(valPaid);
        valReceived = Math.abs(valReceived);

        return {
          id: finalId,
          date: parseDateSafely(rawDate),
          bankAccount: cleanString(get(map.bankAccount)) || 'Outros',
          type: cleanString(get(map.type)) || 'Outros',
          status: normalizeStatus(rawStatus),
          client: cleanString(get(map.client)) || 'Consumidor',
          paidBy: cleanString(get(map.paidBy)) || 'Financeiro',
          movement: movement,
          valuePaid: valPaid,
          valueReceived: valReceived,
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

function detectDelimiter(rows: string[]): string {
    let commaCount = 0;
    let semiCount = 0;
    
    rows.forEach(row => {
        commaCount += (row.match(/,/g) || []).length;
        semiCount += (row.match(/;/g) || []).length;
    });

    return semiCount > commaCount ? ';' : ',';
}

function findHeaderRowIndex(rows: string[], delimiter: string): number {
    let bestIndex = 0;
    let maxScore = 0;
    const limit = Math.min(rows.length, 15);

    for (let i = 0; i < limit; i++) {
        const row = rows[i].toLowerCase();
        let score = 0;
        const cells = row.split(delimiter).map(c => c.trim());
        const hasKeyword = (keys: string[]) => cells.some(c => keys.some(k => c.includes(k)));

        if (hasKeyword(['data', 'date', 'vencimento', 'competencia'])) score += 3;
        if (hasKeyword(['valor', 'amount', 'total', 'r$'])) score += 3;
        if (hasKeyword(['conta', 'banco', 'bank', 'origem'])) score += 2;
        if (hasKeyword(['status', 'situacao', 'estado'])) score += 2;
        if (hasKeyword(['cliente', 'descricao', 'nome', 'favorecido'])) score += 2;

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
        else if (matches(norm, ['data', 'dt', 'vencimento', 'competencia']) && !matches(norm, ['carimbo', 'timestamp'])) map.date = i;
        else if (matches(norm, ['conta', 'banco', 'instituicao', 'origem'])) map.bankAccount = i;
        else if (matches(norm, ['tipo', 'categoria', 'classificacao'])) map.type = i;
        else if (matches(norm, ['status', 'situacao'])) map.status = i;
        else if (matches(norm, ['cliente', 'descricao', 'nome', 'historico'])) map.client = i;
        else if (matches(norm, ['pago', 'responsavel']) && !matches(norm, ['valor'])) map.paidBy = i; 
        else if (matches(norm, ['movimento', 'entradasaida', 'tipooperacao'])) map.movement = i;
        
        else if (matches(norm, ['valorpago', 'saida', 'debito', 'despesa']) && !matches(norm, ['pago por'])) map.valuePaid = i;
        else if (matches(norm, ['valorrecebido', 'entrada', 'credito', 'receita'])) map.valueReceived = i;
    });

    return map;
}

// *** NEW CORE LOGIC: Inspect Data Content to fix Mapping ***
function validateAndRemap(map: any, rows: string[][], colCount: number) {
    const isDate = (val: string) => /\d{1,2}[\/-]\d{1,2}/.test(val) || /\d{4}-\d{2}-\d{2}/.test(val);
    const isNumber = (val: string) => {
        const clean = val.replace(/[R$\s]/g, '').trim();
        return /^-?[\d.,]+$/.test(clean) && /\d/.test(clean);
    };

    // 1. Fix DATE
    const datesInMapped = rows.filter(r => map.date !== -1 && isDate(r[map.date])).length;
    if (datesInMapped < Math.ceil(rows.length / 2)) {
        // Find better date column
        let bestCol = -1, maxCount = 0;
        for (let i = 0; i < colCount; i++) {
             const count = rows.filter(r => isDate(r[i])).length;
             if (count > maxCount) { maxCount = count; bestCol = i; }
        }
        if (bestCol !== -1 && maxCount > 1) map.date = bestCol;
    }

    // 2. Fix TYPE (Avoid numbers in Type column)
    if (map.type !== -1) {
        const numbersInType = rows.filter(r => isNumber(r[map.type])).length;
        if (numbersInType > Math.ceil(rows.length / 2)) {
            // Type column looks like a Number! Unmap it.
            map.type = -1;
        }
    }

    // 3. Fix VALUES
    // If no value column mapped, or mapped one has text
    let hasPaid = map.valuePaid !== -1 && rows.filter(r => isNumber(r[map.valuePaid])).length >= 1;
    let hasRec = map.valueReceived !== -1 && rows.filter(r => isNumber(r[map.valueReceived])).length >= 1;

    if (!hasPaid && !hasRec) {
        // Find best number column
        let bestCol = -1, maxCount = 0;
        for (let i = 0; i < colCount; i++) {
             // Avoid Date column
             if (i === map.date) continue;
             const count = rows.filter(r => isNumber(r[i])).length;
             if (count > maxCount) { maxCount = count; bestCol = i; }
        }
        if (bestCol !== -1) {
             map.valuePaid = bestCol; // Default to paid, single column logic handles split
             map.valueReceived = bestCol;
        }
    }

    return map;
}

function parseCurrencyRobust(val: string | undefined): number {
  if (!val) return 0;
  
  let clean = val.replace(/^["']|["']$/g, '').trim(); 
  clean = clean.replace(/[R$\s]/g, ''); 
  
  // Handle specific negative formats like (100.00)
  if (clean.startsWith('(') && clean.endsWith(')')) {
      clean = '-' + clean.slice(1, -1);
  }

  if (!clean || clean === '-') return 0;

  const lastComma = clean.lastIndexOf(',');
  const lastDot = clean.lastIndexOf('.');

  if (lastComma > lastDot) {
      // 1.200,00 -> 1200.00
      clean = clean.replace(/\./g, '').replace(',', '.');
  } else if (lastDot > lastComma) {
      // 1,200.00 -> 1200.00
      clean = clean.replace(/,/g, '');
  } else if (lastComma > -1 && lastDot === -1) {
       // 50,00 -> 50.00
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
    return 'Saída'; 
}

function parseDateSafely(dateStr: string | undefined): string {
  if (!dateStr) return '1970-01-01';
  
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
