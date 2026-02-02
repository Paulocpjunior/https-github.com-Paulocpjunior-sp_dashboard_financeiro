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
      const delimiter = detectDelimiter(rows.slice(0, 15));
      console.log(`Delimitador detectado: "${delimiter}"`);

      // 2. Smart Header Detection
      const headerRowIndex = findHeaderRowIndex(rows, delimiter);
      console.log(`Cabeçalho detectado na linha: ${headerRowIndex}`);

      const headerRow = parseCSVLineRegex(rows[headerRowIndex], delimiter);
      
      // 3. Strict Mapping Logic (Rewritten)
      let map = mapHeaders(headerRow);
      console.log('Mapa de Colunas:', map);

      // 4. Parse Data
      const dataRows = rows.slice(headerRowIndex + 1).filter(row => row.trim() !== '');

      const transactions = dataRows.map((rowString, index) => {
        const cols = parseCSVLineRegex(rowString, delimiter);
        const get = (idx: number) => (idx !== -1 && cols[idx] !== undefined) ? cols[idx] : '';

        // Extract Raw Values
        const rawId = get(map.id);
        const rawDate = get(map.date);
        const rawDueDate = get(map.dueDate);
        const rawValorPago = get(map.valuePaid);
        const rawValorRecebido = get(map.valueReceived);
        const rawStatus = get(map.status);
        const rawMovimento = get(map.movement);
        const rawType = get(map.type);
        const rawAccount = get(map.bankAccount);
        const rawPaidBy = get(map.paidBy);
        
        // Extract Detail Values
        const rawHonorarios = get(map.honorarios);
        const rawValorExtra = get(map.valorExtra);
        const rawTotalCobranca = get(map.totalCobranca);

        // ID Logic
        let finalId = `trx-${index}`;
        if (map.id !== -1 && rawId && rawId.trim().length > 0) {
            if (rawId.length < 50 && !rawId.includes('/') && !rawId.toLowerCase().includes('total')) {
                finalId = rawId.trim();
            }
        }

        // MOVEMENT & VALUES LOGIC
        let movement = normalizeMovement(rawMovimento);
        let valPaid = 0;
        let valReceived = 0;

        // Determine if we are in single column mode for values
        const isSingleColumn = map.valueReceived === -1 || map.valuePaid === map.valueReceived;

        if (isSingleColumn) {
            const rawVal = rawValorPago || rawValorRecebido; // Use whichever was found
            const val = parseCurrencyRobust(rawVal);
            
            // Priority: Explicit Movement Column -> Inference from Sign
            if (movement === 'Entrada') {
                valReceived = val;
                valPaid = 0;
            } else if (movement === 'Saída') {
                valPaid = val;
                valReceived = 0;
            } else {
                 // Fallback inference
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
            // Two columns mode
            valPaid = parseCurrencyRobust(rawValorPago);
            valReceived = parseCurrencyRobust(rawValorRecebido);
            
            // If explicit movement column exists, trust it. Otherwise infer.
            if (map.movement === -1) {
                if (valPaid > 0 && valReceived === 0) movement = 'Saída';
                if (valReceived > 0 && valPaid === 0) movement = 'Entrada';
                // If both are 0 or both have values, default to Saída or check generic logic
                if (valPaid === 0 && valReceived === 0) movement = 'Saída'; 
            }
        }

        // Ensure values are absolute
        valPaid = Math.abs(valPaid);
        valReceived = Math.abs(valReceived);

        // Date Logic - Fallbacks
        const finalDate = parseDateSafely(rawDate);
        let finalDueDate = parseDateSafely(rawDueDate);
        
        // If due date is missing/invalid but we have a transaction date, use transaction date as due date
        if (finalDueDate === '1970-01-01' && finalDate !== '1970-01-01') {
            finalDueDate = finalDate;
        }

        return {
          id: finalId,
          date: finalDate,
          dueDate: finalDueDate,
          // COPIA FIEL: Removemos 'Outros', 'Geral', 'Financeiro'. Se vier vazio, fica vazio.
          bankAccount: cleanString(rawAccount),
          type: cleanString(rawType),
          status: normalizeStatus(rawStatus),
          client: cleanString(get(map.client)),
          paidBy: cleanString(rawPaidBy),
          movement: movement,
          valuePaid: valPaid,
          valueReceived: valReceived,
          // New Fields
          honorarios: parseCurrencyRobust(rawHonorarios),
          valorExtra: parseCurrencyRobust(rawValorExtra),
          totalCobranca: parseCurrencyRobust(rawTotalCobranca),
        } as Transaction;
      });
      
      // Sort by Date Descending (Newest First)
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
    let commaCount = 0;
    let semiCount = 0;
    
    rows.forEach(row => {
        commaCount += (row.match(/,/g) || []).length;
        semiCount += (row.match(/;/g) || []).length;
    });
    return semiCount >= commaCount ? ';' : ',';
}

function findHeaderRowIndex(rows: string[], delimiter: string): number {
    let bestIndex = 0;
    let maxScore = 0;
    const limit = Math.min(rows.length, 12);

    for (let i = 0; i < limit; i++) {
        const row = rows[i].toLowerCase();
        let score = 0;
        const cells = row.split(delimiter).map(c => c.trim());
        const hasKeyword = (keys: string[]) => cells.some(c => keys.some(k => c.includes(k)));

        // Scoring rules
        if (hasKeyword(['data', 'date', 'vencimento', 'dt'])) score += 3;
        if (hasKeyword(['valor', 'total', 'saldo', 'liquido'])) score += 4;
        if (hasKeyword(['conta', 'banco', 'origem'])) score += 2;
        if (hasKeyword(['descricao', 'historico', 'cliente'])) score += 2;
        if (hasKeyword(['plano', 'classificacao', 'tipo'])) score += 2;

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
            .replace(/[^a-z0-9 ]/g, ''); // Keep spaces for multi-word matching
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

// ------------------------------------------------------------------
// CORE MAPPING LOGIC (STRICT & IMPROVED)
// ------------------------------------------------------------------
function mapHeaders(headers: string[]) {
    const map = {
        id: -1, 
        date: -1, 
        dueDate: -1,
        bankAccount: -1, 
        type: -1, 
        status: -1, 
        client: -1, 
        paidBy: -1, 
        movement: -1, 
        valuePaid: -1, 
        valueReceived: -1,
        honorarios: -1,
        valorExtra: -1,
        totalCobranca: -1
    };

    const normHeaders = headers.map(h => normalizeHeader(h));

    // Helper to find index with exclusion
    const find = (keywords: string[], exclude: string[] = []) => {
        return normHeaders.findIndex((h, i) => {
             // Exact match has priority, then inclusion
             const isMatch = keywords.some(k => h === k || h.includes(k));
             const isExcluded = exclude.some(e => h.includes(e));
             return isMatch && !isExcluded;
        });
    };

    // 1. DATES
    map.dueDate = find(['data vencimento', 'data do vencimento', 'vencimento']);
    map.date = find(['data emissao', 'emissao', 'data', 'dt '], ['vencimento', 'agendamento']);

    if (map.date === -1 && map.dueDate !== -1) map.date = map.dueDate;
    if (map.dueDate === -1 && map.date !== -1) map.dueDate = map.date;

    // 2. VALUES
    const valueExclusions = ['doc', 'num', 'nr', 'nosso', 'parcela', 'id', 'cod', 'nota', 'cheque', 'extra', 'honorarios'];
    map.valuePaid = find(['valor pago', 'valor debito', 'debito', 'saida', 'valor saida', 'despesa'], valueExclusions);
    map.valueReceived = find(['valor recebido', 'valor credito', 'credito', 'entrada', 'valor entrada', 'receita'], valueExclusions);

    if (map.valuePaid === -1 && map.valueReceived === -1) {
        const valIdx = find(['valor liquido', 'valor total', 'valor', 'saldo', 'total', 'amount'], valueExclusions);
        if (valIdx !== -1) {
            map.valuePaid = valIdx;
            map.valueReceived = valIdx;
        }
    }

    // New Columns for 'Entrada de Caixa / Contas a Receber'
    map.honorarios = find(['valor honorarios', 'honorarios', 'taxa adm', 'comissao']);
    map.valorExtra = find(['valor extra', 'acrescimo', 'extra', 'juros']);
    map.totalCobranca = find(['total cobranca', 'valor total cobranca', 'valor bruto', 'total geral']);

    // 3. BANK ACCOUNT (Conta)
    // Busca Exata: Tenta "Conta", "Conta Corrente", "Conta Bancaria". 
    // Removemos exclusões agressivas para garantir que se a coluna se chamar só "Conta", ela seja pega.
    map.bankAccount = find(['conta corrente', 'nome da conta', 'conta bancaria', 'nome do banco', 'instituicao financeira']);
    
    // Se não achar, procura apenas "Conta" ou "Banco" ou "Caixa"
    if (map.bankAccount === -1) {
        map.bankAccount = find(['conta', 'banco', 'caixa'], ['contabil', 'plano', 'categoria', 'pagar', 'receber', 'resultado', 'centro', 'custo', 'movimento', 'tipo', 'fluxo']); 
    }

    // 4. TYPE / CATEGORY (Tipo de Lançamento / Plano de Contas)
    // Adicionado "tipo de lancamento" explicitamente na busca prioritária.
    map.type = find(['tipo de lancamento', 'plano de contas', 'classificacao financeira', 'classificacao', 'categoria', 'natureza']);
    
    if (map.type === -1) {
        map.type = find(['subcategoria', 'grupo']);
    }
    
    // Fallback: Apenas usa "Tipo" se não achou os acima
    if (map.type === -1) {
        map.type = find(['tipo'], ['movimento', 'conta', 'bancaria', 'pessoa', 'documento']); 
    }

    // 5. PAID BY (Centro de Custo / Pagador / Pago Por)
    map.paidBy = find(['pago por', 'centro de custo', 'responsavel', 'pagador', 'departamento', 'area']);

    // 6. CLIENT / DESCRIPTION
    map.client = find(['favorecido', 'cliente', 'razao social', 'fornecedor', 'pagador']);
    if (map.client === -1) map.client = find(['descricao', 'historico', 'nome', 'detalhe']);

    // 7. STATUS
    map.status = find(['status', 'situacao', 'estado']);

    // 8. MOVEMENT
    map.movement = find(['movimento', 'tipo movimento', 'operacao', 'entrada/saida', 'd/c']);

    // 9. ID
    map.id = find(['id transacao', 'id_transacao', 'codigo transacao']);
    if (map.id === -1) map.id = find(['id', 'cod', 'codigo'], ['barra', 'produto', 'cliente']);

    return map;
}

function parseCurrencyRobust(val: string | undefined): number {
  if (!val) return 0;
  
  let clean = val.replace(/^["']|["']$/g, '').trim(); 
  clean = clean.replace(/[R$\s]/g, ''); 

  // Format (100.00) or -100.00
  if (clean.startsWith('(') && clean.endsWith(')')) {
      clean = '-' + clean.slice(1, -1);
  }
  
  if (!clean || clean === '-') return 0;

  // Logic to determine format:
  // 1.000,00 (BRL) -> Dots are thousands, Comma is decimal
  // 1,000.00 (US)  -> Commas are thousands, Dot is decimal
  
  const lastComma = clean.lastIndexOf(',');
  const lastDot = clean.lastIndexOf('.');

  if (lastComma > lastDot) {
      // BRL Style (comma is last separator)
      clean = clean.replace(/\./g, '').replace(',', '.');
  } else if (lastDot > lastComma) {
      // US Style (dot is last separator)
      clean = clean.replace(/,/g, '');
  } else if (lastComma > -1 && lastDot === -1) {
       // Only comma (e.g. 50,00) -> Treat as decimal separator
       clean = clean.replace(',', '.');
  }
  
  // Final cleanup of non-numeric chars (except dot and minus)
  clean = clean.replace(/[^0-9.-]/g, '');

  const num = parseFloat(clean);
  return isNaN(num) ? 0 : num;
}

function normalizeStatus(val: string | undefined): 'Pago' | 'Pendente' | 'Agendado' {
  if (!val) return 'Pendente';
  const v = normalizeHeader(val);
  if (v.includes('pago') || v === 'sim' || v === 'ok' || v === 'liquidado' || v === 'efetivado' || v === 'baixado') return 'Pago';
  if (v.includes('agenda') || v.includes('futuro')) return 'Agendado';
  return 'Pendente';
}

function normalizeMovement(val: string | undefined): 'Entrada' | 'Saída' {
    if (val) {
        const v = normalizeHeader(val);
        if (v.includes('saida') || v.includes('debito') || v.includes('pagar') || v.includes('despesa')) return 'Saída';
        if (v.includes('entrada') || v.includes('credito') || v.includes('receber') || v.includes('receita')) return 'Entrada';
    }
    // Default fallback
    return 'Saída'; 
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