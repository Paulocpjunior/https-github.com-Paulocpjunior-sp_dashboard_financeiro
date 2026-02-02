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

      // 2. Find Header Row - procurar linha com cabeçalhos conhecidos
      const headerRowIndex = findHeaderRowIndex(rows, delimiter);
      console.log(`Cabeçalho detectado na linha: ${headerRowIndex}`);

      const headerRow = parseCSVLineRegex(rows[headerRowIndex], delimiter);
      
      // DEBUG: Mostrar todos os cabeçalhos
      console.log('=== TODOS OS CABEÇALHOS ===');
      headerRow.forEach((h, i) => {
        if (h && h.trim()) {
          console.log(`  Coluna [${i}] = "${h}"`);
        }
      });
      
      // 3. MAPEAMENTO INTELIGENTE - Procurar colunas pelo conteúdo exato
      const map = findColumnsByContent(headerRow, rows, headerRowIndex, delimiter);
      
      console.log('=== MAPEAMENTO FINAL ===');
      console.log(`  type (Tipo de Lançamento) -> Coluna [${map.type}]`);
      console.log(`  bankAccount (Contas bancárias) -> Coluna [${map.bankAccount}]`);
      console.log(`  paidBy (Pago Por) -> Coluna [${map.paidBy}]`);
      console.log(`  client (Nome Empresa) -> Coluna [${map.client}]`);

      // 4. Parse Data Rows
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
        
        // CAMPOS CRÍTICOS
        const rawType = get(map.type);
        const rawAccount = get(map.bankAccount);
        const rawPaidBy = get(map.paidBy);
        const rawClient = get(map.client);
        
        // Campos de detalhe
        const rawHonorarios = get(map.honorarios);
        const rawValorExtra = get(map.valorExtra);
        const rawTotalCobranca = get(map.totalCobranca);

        // DEBUG primeiro registro
        if (index === 0) {
          console.log('=== PRIMEIRO REGISTRO ===');
          console.log(`  rawType: "${rawType}"`);
          console.log(`  rawAccount: "${rawAccount}"`);
          console.log(`  rawPaidBy: "${rawPaidBy}"`);
        }

        // ID Logic
        let finalId = `trx-${index}`;
        if (rawId && rawId.trim().length > 0 && rawId.length < 50 && !rawId.includes('/')) {
            finalId = rawId.trim();
        }

        // VALUES & MOVEMENT LOGIC
        let valPaid = parseCurrencyRobust(rawValorPago);
        let valReceived = parseCurrencyRobust(rawValorRecebido);
        
        // Determinar movimento baseado no tipo
        let movement: 'Entrada' | 'Saída' = 'Entrada';
        const typeLower = rawType.toLowerCase();
        if (typeLower.includes('saída') || typeLower.includes('saida') || typeLower.includes('pagar')) {
          movement = 'Saída';
        } else if (typeLower.includes('entrada') || typeLower.includes('receber')) {
          movement = 'Entrada';
        } else if (valPaid > 0 && valReceived === 0) {
          movement = 'Saída';
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

    if (semiVariance <= commaVariance) return ';';
    return ',';
}

function findHeaderRowIndex(rows: string[], delimiter: string): number {
    for (let i = 0; i < Math.min(rows.length, 10); i++) {
        const row = rows[i].toLowerCase();
        if (row.includes('tipo de lan') || 
            row.includes('contas banc') || 
            row.includes('pago por')) {
            return i;
        }
    }
    return 0;
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

// ============================================================================
// FUNÇÃO PRINCIPAL: Encontrar colunas pelo CONTEÚDO dos dados, não só headers
// ============================================================================
function findColumnsByContent(headers: string[], rows: string[], headerRowIndex: number, delimiter: string) {
    const map = {
        id: -1,
        date: -1,
        dueDate: -1,
        bankAccount: -1,
        type: -1,
        paidBy: -1,
        status: -1,
        client: -1,
        valuePaid: -1,
        valueReceived: -1,
        honorarios: -1,
        valorExtra: -1,
        totalCobranca: -1
    };

    // Normalizar headers para comparação
    const normHeaders = headers.map(h => normalizeForSearch(h));
    
    // 1. Primeiro, tentar encontrar pelo header
    for (let i = 0; i < normHeaders.length; i++) {
        const h = normHeaders[i];
        
        // Tipo de Lançamento
        if (h.includes('tipo de lancamento') || h === 'tipo de lancamento') {
            map.type = i;
            console.log(`HEADER MATCH: type -> [${i}] "${headers[i]}"`);
        }
        // Contas bancárias
        if (h.includes('contas bancarias') || h === 'contas bancarias') {
            map.bankAccount = i;
            console.log(`HEADER MATCH: bankAccount -> [${i}] "${headers[i]}"`);
        }
        // Pago Por
        if (h === 'pago por' || h.includes('pago por')) {
            map.paidBy = i;
            console.log(`HEADER MATCH: paidBy -> [${i}] "${headers[i]}"`);
        }
        // Nome Empresa / Credor
        if (h.includes('nome empresa') || h.includes('credor')) {
            map.client = i;
            console.log(`HEADER MATCH: client -> [${i}] "${headers[i]}"`);
        }
        // Data Lançamento
        if ((h.includes('data lancamento') || h === 'data lancamento') && !h.includes('2')) {
            map.date = i;
        }
        // Data a Pagar / Vencimento
        if (h.includes('data a pagar') || h.includes('vencimento')) {
            map.dueDate = i;
        }
        // Status / Doc.Pago
        if (h === 'doc pago' || h === 'docpago' || h.includes('doc.pago')) {
            map.status = i;
        }
        // Valor Pago
        if (h === 'valor pago' && !h.includes('doc')) {
            map.valuePaid = i;
        }
        // Valor Recebido
        if (h === 'valor recebido') {
            map.valueReceived = i;
        }
        // Valor Honorários
        if (h.includes('valor honorarios') || h === 'valor honorarios') {
            map.honorarios = i;
        }
        // Valor Extras
        if (h.includes('valor extras') || h === 'valor extras') {
            map.valorExtra = i;
        }
        // Total Cobrança
        if (h.includes('total cobranca')) {
            map.totalCobranca = i;
        }
        // Submission ID
        if (h.includes('submission id')) {
            map.id = i;
        }
    }

    // 2. Se não encontrou pelo header, procurar pelo CONTEÚDO das primeiras linhas
    if (map.type === -1 || map.bankAccount === -1) {
        console.log('Headers não encontrados, buscando pelo conteúdo...');
        
        // Pegar algumas linhas de dados para análise
        const sampleRows = rows.slice(headerRowIndex + 1, headerRowIndex + 10);
        
        for (let colIdx = 0; colIdx < headers.length; colIdx++) {
            const sampleValues: string[] = [];
            
            for (const row of sampleRows) {
                const cols = parseCSVLineRegex(row, delimiter);
                if (cols[colIdx]) {
                    sampleValues.push(cols[colIdx].trim());
                }
            }
            
            // Verificar se esta coluna contém "Entrada de Caixa" ou "Saída de Caixa"
            const hasEntradaSaida = sampleValues.some(v => 
                v.includes('Entrada de Caixa') || 
                v.includes('Saída de Caixa') ||
                v.includes('Contas a Receber') ||
                v.includes('Contas a Pagar')
            );
            
            if (hasEntradaSaida && map.type === -1) {
                map.type = colIdx;
                console.log(`CONTENT MATCH: type -> [${colIdx}] (contém Entrada/Saída de Caixa)`);
                console.log(`  Valores encontrados: ${sampleValues.slice(0, 3).join(', ')}`);
            }
            
            // Verificar se contém nomes de bancos
            const hasBankNames = sampleValues.some(v => 
                v.includes('Itaú') || 
                v.includes('Itau') ||
                v.includes('Bradesco') ||
                v.includes('Santander') ||
                v.includes('Caixa') ||
                v.includes('Nubank') ||
                v.includes('jurídica') ||
                v.includes('juridica')
            );
            
            if (hasBankNames && map.bankAccount === -1) {
                map.bankAccount = colIdx;
                console.log(`CONTENT MATCH: bankAccount -> [${colIdx}] (contém nomes de bancos)`);
                console.log(`  Valores encontrados: ${sampleValues.slice(0, 3).join(', ')}`);
            }
            
            // Verificar se contém "SP - Retirada" ou similar para Pago Por
            const hasPagoPor = sampleValues.some(v => 
                v.includes('SP -') || 
                v.includes('Retirada') ||
                v.includes('1-') ||
                v.includes('2-')
            );
            
            if (hasPagoPor && map.paidBy === -1 && colIdx !== map.type && colIdx !== map.bankAccount) {
                map.paidBy = colIdx;
                console.log(`CONTENT MATCH: paidBy -> [${colIdx}]`);
            }
        }
    }

    return map;
}

function normalizeForSearch(h: string): string {
    if (!h) return '';
    return h.toLowerCase()
            .trim()
            .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
            .replace(/[^a-z0-9 ]/g, '')
            .replace(/\s+/g, ' ')
            .trim();
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
  if (v === 'sim' || v === 'pago' || v === 'ok' || v === 'liquidado') return 'Pago';
  if (v === 'não' || v === 'nao' || v === 'pendente' || v === 'aberto') return 'Pendente';
  if (v.includes('agenda')) return 'Agendado';
  return 'Pendente';
}

function parseDateSafely(dateStr: string | undefined): string {
  if (!dateStr) return '1970-01-01';
  
  let clean = dateStr.replace(/^["']|["']$/g, '').trim();
  if (clean.includes(' ')) clean = clean.split(' ')[0];

  const ptBrRegex = /^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})/;
  const ptMatch = clean.match(ptBrRegex);

  if (ptMatch) {
      const day = ptMatch[1].padStart(2, '0');
      const month = ptMatch[2].padStart(2, '0');
      let year = ptMatch[3];
      if (year.length === 2) year = '20' + year;
      return `${year}-${month}-${day}`;
  }

  const isoRegex = /^(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})/;
  const isoMatch = clean.match(isoRegex);
  if (isoMatch) {
      return clean.substring(0, 10);
  }

  return '1970-01-01';
}