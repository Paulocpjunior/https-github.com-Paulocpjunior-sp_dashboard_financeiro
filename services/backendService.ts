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

      // 1. Detect Delimiter (Enhanced for Brazilian Format)
      const delimiter = detectDelimiter(rows.slice(0, 20));
      console.log(`Delimitador detectado: "${delimiter}"`);

      // 2. Smart Header Detection
      const headerRowIndex = findHeaderRowIndex(rows, delimiter);
      console.log(`Cabeçalho detectado na linha: ${headerRowIndex}`);

      const headerRow = parseCSVLineRegex(rows[headerRowIndex], delimiter);
      console.log('Cabeçalhos encontrados:', headerRow);
      
      // 3. Strict Mapping Logic - BASEADO NOS CABEÇALHOS EXATOS DA PLANILHA
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
        
        // Critical Fields - RAW EXACT COPY AS REQUESTED
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
          // CÓPIA FIEL: Sem valores padrão (ex: 'Geral', 'Outros'). 
          // Se estiver vazio no banco, fica vazio aqui.
          // cleanString apenas remove aspas extras e espaços nas pontas.
          bankAccount: cleanString(rawAccount),
          type: cleanString(rawType),
          paidBy: cleanString(rawPaidBy),
          status: normalizeStatus(rawStatus),
          client: cleanString(get(map.client)),
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
    const validRows = rows.filter(r => r.trim().length > 0);
    if (validRows.length === 0) return ';';

    // Heuristic: Check variance of column counts.
    // The correct delimiter usually yields a constant number of columns for all rows.
    const getVariance = (delim: string) => {
        const counts = validRows.map(r => r.split(delim).length);
        const avg = counts.reduce((a, b) => a + b, 0) / counts.length;
        if (avg < 2) return 9999; // Penalty for single column (delimiter not found)
        
        const variance = counts.reduce((a, b) => a + Math.pow(b - avg, 2), 0) / counts.length;
        return variance;
    };

    const commaVariance = getVariance(',');
    const semiVariance = getVariance(';');

    console.log(`Delimiter Check - Comma Variance: ${commaVariance}, Semi Variance: ${semiVariance}`);

    // If semicolon has lower or equal variance, prefer it (standard for BR/PT sheets)
    // Also, if comma variance is high (likely due to decimal commas), avoid it.
    if (semiVariance <= commaVariance) return ';';
    
    return ',';
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

        // Scoring rules - BASEADO NOS CABEÇALHOS EXATOS DA PLANILHA
        // Boost score para cabeçalhos específicos da planilha do cliente
        if (hasKeyword(['tipo de lançamento', 'tipo de lancamento'])) score += 15;
        if (hasKeyword(['contas bancárias', 'contas bancarias'])) score += 15;
        if (hasKeyword(['pago por'])) score += 10;
        if (hasKeyword(['movimentação', 'movimentacao'])) score += 10;
        if (hasKeyword(['nome empresa', 'credor'])) score += 10;
        
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
            .replace(/[^a-z0-9 ]/g, '') // Keep spaces for multi-word matching
            .replace(/\s+/g, ' '); // Collapse multiple spaces
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
// CORE MAPPING LOGIC - CABEÇALHOS EXATOS DA PLANILHA DO CLIENTE
// ------------------------------------------------------------------
// Cabeçalhos da planilha (verificados):
// Coluna C: "Contas bancárias"
// Coluna D: "Tipo de Lançamento"
// Coluna E: "Pago Por"
// Coluna F: "Movimentação"
// Coluna AA: "Nome Empresa / Credor"
// Coluna AB: "Valor Honorários"
// Coluna AC: "Valor Extras"
// Coluna AE: "Total Cobrança"
// Coluna AF: "Valor Recebido"
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
    console.log('Headers normalizados:', normHeaders);

    // Helper to find index with exclusion
    const find = (keywords: string[], exclude: string[] = []) => {
        return normHeaders.findIndex((h, i) => {
             // Exact match has priority, then inclusion
             const isMatch = keywords.some(k => h === k || h.includes(k));
             const isExcluded = exclude.some(e => h.includes(e));
             return isMatch && !isExcluded;
        });
    };

    // --- MAPEAMENTO BASEADO NOS CABEÇALHOS EXATOS DA PLANILHA ---
    
    // 1. TIPO DE LANÇAMENTO (Coluna D)
    // Cabeçalho exato: "Tipo de Lançamento"
    let typeIdx = find(['tipo de lancamento']);
    if (typeIdx === -1) typeIdx = find(['tipo lancamento', 'tipo do lancamento']);
    // Fallback: "plano de contas", "classificacao"
    if (typeIdx === -1) typeIdx = find(['plano de contas', 'classificacao financeira', 'classificacao', 'categoria']);
    // Fallback: Apenas "tipo", mas excluindo "movimento"
    if (typeIdx === -1) typeIdx = find(['tipo'], ['movimento', 'pessoa', 'documento']); 
    map.type = typeIdx;
    console.log(`Mapeamento type -> índice ${typeIdx}, header: "${headers[typeIdx] || 'N/A'}"`);

    // 2. CONTAS BANCÁRIAS (Coluna C)
    // Cabeçalho exato: "Contas bancárias"
    let accIdx = find(['contas bancarias']);
    if (accIdx === -1) accIdx = find(['conta corrente', 'conta bancaria', 'nome da conta', 'banco', 'caixa']);
    if (accIdx === -1) {
        accIdx = find(['conta'], ['contabil', 'plano', 'categoria', 'pagar', 'receber', 'resultado', 'centro', 'custo', 'movimento', 'tipo', 'fluxo']);
    }
    if (accIdx === -1) accIdx = find(['instituicao']);
    map.bankAccount = accIdx;
    console.log(`Mapeamento bankAccount -> índice ${accIdx}, header: "${headers[accIdx] || 'N/A'}"`);

    // 3. PAGO POR (Coluna E)
    // Cabeçalho exato: "Pago Por"
    map.paidBy = find(['pago por']);
    if (map.paidBy === -1) map.paidBy = find(['pagopor', 'pago_por', 'centro de custo', 'responsavel', 'pagador', 'departamento']);
    console.log(`Mapeamento paidBy -> índice ${map.paidBy}, header: "${headers[map.paidBy] || 'N/A'}"`);

    // --- DEMAIS CAMPOS ---

    // 4. DATES
    // Coluna B: "Data Lançamento"
    // Coluna H: "Data a Pagar" (vencimento)
    map.date = find(['data lancamento'], ['vencimento', 'receber', 'pagar', '2']);
    if (map.date === -1) map.date = find(['data emissao', 'emissao', 'data'], ['vencimento', 'agendamento', 'pagar', 'receber']);
    
    map.dueDate = find(['data a pagar', 'data vencimento', 'vencimento']);
    if (map.dueDate === -1) map.dueDate = find(['data do vencimento']);

    if (map.date === -1 && map.dueDate !== -1) map.date = map.dueDate;
    if (map.dueDate === -1 && map.date !== -1) map.dueDate = map.date;

    // 5. MOVIMENTAÇÃO (Coluna F)
    // Cabeçalho exato: "Movimentação"
    map.movement = find(['movimentacao']);
    if (map.movement === -1) map.movement = find(['movimento', 'tipo movimento', 'operacao', 'entrada/saida', 'd/c']);
    console.log(`Mapeamento movement -> índice ${map.movement}, header: "${headers[map.movement] || 'N/A'}"`);

    // 6. VALUES
    // Coluna N: "Valor Pago"
    // Coluna AF: "Valor Recebido"
    const valueExclusions = ['doc', 'num', 'nr', 'nosso', 'parcela', 'id', 'cod', 'nota', 'cheque', 'extra', 'honorarios', 'original', 'ref'];
    
    map.valuePaid = find(['valor pago'], valueExclusions);
    if (map.valuePaid === -1) map.valuePaid = find(['valor debito', 'debito', 'saida', 'valor saida', 'despesa'], valueExclusions);
    
    map.valueReceived = find(['valor recebido'], valueExclusions);
    if (map.valueReceived === -1) map.valueReceived = find(['valor credito', 'credito', 'entrada', 'valor entrada', 'receita'], valueExclusions);

    if (map.valuePaid === -1 && map.valueReceived === -1) {
        const valIdx = find(['valor liquido', 'valor total', 'valor', 'saldo', 'total', 'amount'], valueExclusions);
        if (valIdx !== -1) {
            map.valuePaid = valIdx;
            map.valueReceived = valIdx;
        }
    }
    console.log(`Mapeamento valuePaid -> índice ${map.valuePaid}, valueReceived -> índice ${map.valueReceived}`);

    // 7. New Columns for 'Entrada de Caixa / Contas a Receber'
    // Coluna AB: "Valor Honorários"
    // Coluna AC: "Valor Extras"
    // Coluna AE: "Total Cobrança"
    map.honorarios = find(['valor honorarios', 'honorarios']);
    if (map.honorarios === -1) map.honorarios = find(['taxa adm', 'comissao']);
    
    map.valorExtra = find(['valor extras', 'valor extra']);
    if (map.valorExtra === -1) map.valorExtra = find(['acrescimo', 'extras', 'juros']);
    
    map.totalCobranca = find(['total cobranca', 'valor total cobranca']);
    if (map.totalCobranca === -1) map.totalCobranca = find(['valor bruto', 'total geral']);

    // 8. CLIENT / DESCRIPTION
    // Coluna AA: "Nome Empresa / Credor"
    map.client = find(['nome empresa', 'credor']);
    if (map.client === -1) map.client = find(['favorecido', 'cliente', 'razao social', 'fornecedor', 'pagador']);
    if (map.client === -1) map.client = find(['descricao', 'historico', 'nome', 'detalhe']);
    console.log(`Mapeamento client -> índice ${map.client}, header: "${headers[map.client] || 'N/A'}"`);

    // 9. STATUS
    // Coluna J: "Doc.Pago" pode indicar status
    map.status = find(['status', 'situacao', 'estado']);
    if (map.status === -1) map.status = find(['doc pago', 'docpago']);

    // 10. ID
    // Coluna AN: "Submission ID"
    map.id = find(['submission id', 'id transacao', 'id_transacao', 'codigo transacao']);
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
