import { Transaction, User } from '../types';
import { MOCK_USERS } from '../constants';

// =========================================================================================
// CONFIGURAÇÃO DO BANCO DE DADOS (GOOGLE SHEETS)
// =========================================================================================
const DEFAULT_SPREADSHEET_ID = '17mHd8eqKoj7Cl6E2MCkr0PczFj-lKv_vmFRCY5hypwg'; 
const DEFAULT_GID = '1276925607';

// URL do Google Apps Script para registro de usuários (CONFIGURE AQUI)
// Você precisa criar um Web App no Google Apps Script que receba os dados
const REGISTER_WEBHOOK_URL = 'https://script.google.com/macros/s/SEU_SCRIPT_ID/exec';

const STORAGE_KEY_DB_SOURCE = 'cashflow_db_source_id';
const STORAGE_KEY_DB_GID = 'cashflow_db_gid';

// Interface para dados de registro
interface RegisterUserData {
  name: string;
  email: string;
  phone?: string;
  username: string;
  password: string;
}

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

  // =========================================================================================
  // REGISTRO DE NOVO USUÁRIO
  // =========================================================================================
  registerUser: async (data: RegisterUserData): Promise<{ success: boolean; message: string }> => {
    console.log('[BackendService] Iniciando registro de usuário:', data.username);

    try {
      // Validações básicas
      if (!data.name || !data.email || !data.username || !data.password) {
        return { success: false, message: 'Todos os campos obrigatórios devem ser preenchidos.' };
      }

      if (data.password.length < 6) {
        return { success: false, message: 'A senha deve ter no mínimo 6 caracteres.' };
      }

      // Verificar se usuário já existe nos MOCK_USERS
      const existingUser = MOCK_USERS.find(u => 
        u.username.toLowerCase() === data.username.toLowerCase() ||
        u.email?.toLowerCase() === data.email.toLowerCase()
      );

      if (existingUser) {
        return { success: false, message: 'Usuário ou e-mail já cadastrado no sistema.' };
      }

      // ===================================================================================
      // OPÇÃO 1: Enviar para Google Apps Script (Webhook)
      // Descomente este bloco se você tiver um Web App configurado
      // ===================================================================================
      /*
      const response = await fetch(REGISTER_WEBHOOK_URL, {
        method: 'POST',
        mode: 'no-cors', // Necessário para Google Apps Script
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          action: 'register',
          timestamp: new Date().toISOString(),
          name: data.name,
          email: data.email,
          phone: data.phone || '',
          username: data.username,
          password: data.password, // Em produção, use hash!
          status: 'pendente',
        }),
      });

      // Com no-cors, não conseguimos ler a resposta, assumimos sucesso
      console.log('[BackendService] Dados enviados para webhook');
      */

      // ===================================================================================
      // OPÇÃO 2: Salvar no LocalStorage (Temporário - para desenvolvimento)
      // ===================================================================================
      const pendingUsers = JSON.parse(localStorage.getItem('pending_users') || '[]');
      
      // Verificar se já existe cadastro pendente
      const existingPending = pendingUsers.find((u: any) => 
        u.username.toLowerCase() === data.username.toLowerCase() ||
        u.email.toLowerCase() === data.email.toLowerCase()
      );

      if (existingPending) {
        return { success: false, message: 'Já existe uma solicitação de cadastro pendente para este usuário ou e-mail.' };
      }

      // Adicionar novo cadastro pendente
      pendingUsers.push({
        id: `pending-${Date.now()}`,
        timestamp: new Date().toISOString(),
        name: data.name,
        email: data.email,
        phone: data.phone || '',
        username: data.username,
        password: data.password, // Em produção, use hash!
        status: 'pendente',
      });

      localStorage.setItem('pending_users', JSON.stringify(pendingUsers));
      console.log('[BackendService] Cadastro salvo localmente:', pendingUsers.length, 'pendentes');

      // ===================================================================================
      // OPÇÃO 3: Enviar por Email usando EmailJS ou similar
      // Adicione sua integração aqui se preferir
      // ===================================================================================

      return { 
        success: true, 
        message: 'Cadastro realizado com sucesso! Aguarde a aprovação do administrador para acessar o sistema.' 
      };

    } catch (error: any) {
      console.error('[BackendService] Erro no registro:', error);
      return { 
        success: false, 
        message: error.message || 'Erro ao processar cadastro. Tente novamente.' 
      };
    }
  },

  // =========================================================================================
  // BUSCAR USUÁRIOS PENDENTES (Para tela de admin)
  // =========================================================================================
  getPendingUsers: (): any[] => {
    return JSON.parse(localStorage.getItem('pending_users') || '[]');
  },

  // =========================================================================================
  // APROVAR USUÁRIO PENDENTE (Para tela de admin)
  // =========================================================================================
  approvePendingUser: (pendingId: string): { success: boolean; message: string } => {
    const pendingUsers = JSON.parse(localStorage.getItem('pending_users') || '[]');
    const index = pendingUsers.findIndex((u: any) => u.id === pendingId);
    
    if (index === -1) {
      return { success: false, message: 'Usuário pendente não encontrado.' };
    }

    // Remover da lista de pendentes
    const [approvedUser] = pendingUsers.splice(index, 1);
    localStorage.setItem('pending_users', JSON.stringify(pendingUsers));

    // Em produção, aqui você adicionaria o usuário ao banco de dados real
    console.log('[BackendService] Usuário aprovado:', approvedUser);

    return { success: true, message: `Usuário ${approvedUser.username} aprovado com sucesso!` };
  },

  // =========================================================================================
  // REJEITAR USUÁRIO PENDENTE (Para tela de admin)
  // =========================================================================================
  rejectPendingUser: (pendingId: string): { success: boolean; message: string } => {
    const pendingUsers = JSON.parse(localStorage.getItem('pending_users') || '[]');
    const index = pendingUsers.findIndex((u: any) => u.id === pendingId);
    
    if (index === -1) {
      return { success: false, message: 'Usuário pendente não encontrado.' };
    }

    const [rejectedUser] = pendingUsers.splice(index, 1);
    localStorage.setItem('pending_users', JSON.stringify(pendingUsers));

    console.log('[BackendService] Usuário rejeitado:', rejectedUser);

    return { success: true, message: `Cadastro de ${rejectedUser.username} foi rejeitado.` };
  },

  fetchTransactions: async (): Promise<Transaction[]> => {
    const spreadsheetId = BackendService.getSpreadsheetId();
    const gid = BackendService.getSpreadsheetGid();
    
    const csvUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/export?format=csv&gid=${gid}`; 
    console.log(`[BackendService] Conectando à planilha: ${spreadsheetId} (Tab: ${gid})...`);
    
    try {
      const response = await fetch(csvUrl);
      
      if (!response.ok) {
        throw new Error(`Erro HTTP: ${response.status}. Verifique o ID e o compartilhamento.`);
      }
      
      let csvText = await response.text();

      // Remove BOM
      if (csvText.charCodeAt(0) === 0xFEFF) {
        csvText = csvText.slice(1);
      }

      if (csvText.trim().startsWith('<!DOCTYPE html>') || csvText.includes('<html')) {
        throw new Error('A planilha está privada. Altere o compartilhamento para "Qualquer pessoa com o link".');
      }

      // ========================================================================
      // PARSER CSV COMPLETO - Lida com:
      // 1. Vírgulas dentro de aspas
      // 2. Quebras de linha dentro de aspas
      // 3. Aspas escapadas ("")
      // ========================================================================
      const allRows = parseCSVComplete(csvText);
      
      if (allRows.length < 2) {
        return [];
      }

      console.log(`[BackendService] Total de registros parseados: ${allRows.length}`);

      // ========================================================================
      // MAPEAMENTO FIXO - ÍNDICES CONFIRMADOS DO CSV (02/02/2026)
      // ========================================================================
      const COL = {
        timestamp: 0,        // A: #N/A
        dataLancamento: 1,   // B: Data Lançamento
        contasBancarias: 2,  // C: Contas bancárias
        tipoLancamento: 3,   // D: Tipo de Lançamento
        pagoPor: 4,          // E: Pago Por
        movimentacao: 5,     // F: Movimentação
        dataAPagar: 7,       // H: Data a Pagar
        docPago: 9,          // J: Doc.Pago
        dataBaixa: 10,       // K: Data Baixa / Pagamento
        valorPago: 13,       // N: Valor Pago
        nomeEmpresa: 26,     // AA: Nome Empresa / Credor
        valorHonorarios: 27, // AB: Valor Honorários
        valorExtras: 28,     // AC: Valor Extras
        totalCobranca: 30,   // AE: Total Cobrança
        valorRecebido: 31,   // AF: Valor Recebido
        submissionId: 39,    // AN: Submission ID
      };

      // Encontrar linha de cabeçalho
      let headerRowIndex = 0;
      for (let i = 0; i < Math.min(allRows.length, 5); i++) {
        const row = allRows[i];
        if (row.length > 3) {
          const combined = row.slice(0, 5).join(' ').toLowerCase();
          if (combined.includes('tipo de lan') || combined.includes('contas banc')) {
            headerRowIndex = i;
            break;
          }
        }
      }

      console.log(`[BackendService] Linha de cabeçalho: ${headerRowIndex}`);

      // Parse data rows (skip header)
      const dataRows = allRows.slice(headerRowIndex + 1);

      // DEBUG: Mostrar primeira linha parseada
      if (dataRows.length > 0) {
        const first = dataRows[0];
        console.log('[BackendService] === DEBUG PRIMEIRA LINHA ===');
        console.log(`  Total de colunas: ${first.length}`);
        console.log(`  Col[2] (Contas bancárias): "${first[2]}"`);
        console.log(`  Col[3] (Tipo Lançamento): "${first[3]}"`);
        console.log(`  Col[4] (Pago Por): "${first[4]}"`);
        console.log(`  Col[26] (Nome Empresa): "${first[26]}"`);
      }

      const transactions = dataRows.map((cols, index) => {
        // Função helper para pegar valor de coluna com segurança
        const get = (idx: number): string => {
          if (idx >= 0 && idx < cols.length) {
            return cols[idx] || '';
          }
          return '';
        };

        // Extrair valores usando índices FIXOS
        const rawDate = get(COL.dataLancamento);
        const rawDueDate = get(COL.dataAPagar);
        const rawBankAccount = get(COL.contasBancarias);
        const rawType = get(COL.tipoLancamento);
        const rawPaidBy = get(COL.pagoPor);
        const rawMovement = get(COL.movimentacao);
        const rawStatus = get(COL.docPago);
        const rawClient = get(COL.nomeEmpresa);
        const rawValorPago = get(COL.valorPago);
        const rawValorRecebido = get(COL.valorRecebido);
        const rawId = get(COL.submissionId);
        const rawHonorarios = get(COL.valorHonorarios);
        const rawValorExtra = get(COL.valorExtras);
        const rawTotalCobranca = get(COL.totalCobranca);

        // ID
        let finalId = `trx-${index}`;
        if (rawId && rawId.trim().length > 0 && rawId.length < 50 && !rawId.includes('/')) {
          finalId = rawId.trim();
        }

        // Parse valores
        const valPaid = Math.abs(parseCurrency(rawValorPago));
        const valReceived = Math.abs(parseCurrency(rawValorRecebido));

        // Determinar movimento baseado no Tipo de Lançamento
        let movement: 'Entrada' | 'Saída' = 'Entrada';
        const tipoLower = rawType.toLowerCase();
        if (tipoLower.includes('saída') || tipoLower.includes('saida') || tipoLower.includes('pagar')) {
          movement = 'Saída';
        } else if (tipoLower.includes('entrada') || tipoLower.includes('receber')) {
          movement = 'Entrada';
        } else if (rawMovement) {
          const mov = rawMovement.toLowerCase();
          if (mov.includes('saída') || mov.includes('saida')) {
            movement = 'Saída';
          }
        } else if (valPaid > 0 && valReceived === 0) {
          movement = 'Saída';
        }

        // Parse dates
        const finalDate = parseDate(rawDate);
        let finalDueDate = parseDate(rawDueDate);
        if (finalDueDate === '1970-01-01' && finalDate !== '1970-01-01') {
          finalDueDate = finalDate;
        }

        return {
          id: finalId,
          date: finalDate,
          dueDate: finalDueDate,
          bankAccount: cleanString(rawBankAccount),
          type: cleanString(rawType),
          paidBy: cleanString(rawPaidBy),
          status: normalizeStatus(rawStatus),
          client: cleanString(rawClient),
          // CORRIGIDO: movement recebe o valor RAW da coluna F (Movimentação)
          // O valor "Entrada/Saída" é determinado pelo Tipo de Lançamento
          movement: cleanString(rawMovement),
          valuePaid: valPaid,
          valueReceived: valReceived,
          honorarios: parseCurrency(rawHonorarios),
          valorExtra: parseCurrency(rawValorExtra),
          totalCobranca: parseCurrency(rawTotalCobranca),
        } as Transaction;
      });

      // Log dos valores únicos para debug
      const uniqueTypes = [...new Set(transactions.map(t => t.type).filter(t => t))];
      const uniqueAccounts = [...new Set(transactions.map(t => t.bankAccount).filter(t => t))];
      const uniquePaidBy = [...new Set(transactions.map(t => t.paidBy).filter(t => t))];
      
      console.log('[BackendService] === VALORES ÚNICOS EXTRAÍDOS ===');
      console.log(`  Tipos de Lançamento (${uniqueTypes.length}):`, uniqueTypes.slice(0, 5));
      console.log(`  Contas Bancárias (${uniqueAccounts.length}):`, uniqueAccounts.slice(0, 3));
      console.log(`  Pago Por (${uniquePaidBy.length}):`, uniquePaidBy.slice(0, 5));

      // Sort by date descending
      return transactions.sort((a, b) => {
        if (a.date === b.date) return 0;
        return a.date > b.date ? -1 : 1;
      });

    } catch (error: any) {
      console.error('[BackendService] Erro ao buscar dados:', error);
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

// =============================================================================
// PARSER CSV COMPLETO - Lida com quebras de linha dentro de campos
// =============================================================================

function parseCSVComplete(csvText: string): string[][] {
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentField = '';
  let inQuotes = false;
  
  for (let i = 0; i < csvText.length; i++) {
    const char = csvText[i];
    const nextChar = csvText[i + 1];
    
    if (char === '"') {
      if (inQuotes) {
        if (nextChar === '"') {
          // Escaped quote "" -> add single quote
          currentField += '"';
          i++; // Skip next quote
        } else {
          // End of quoted field
          inQuotes = false;
        }
      } else {
        // Start of quoted field
        inQuotes = true;
      }
    } else if (char === ',' && !inQuotes) {
      // Field separator
      currentRow.push(currentField.trim());
      currentField = '';
    } else if ((char === '\n' || (char === '\r' && nextChar === '\n')) && !inQuotes) {
      // End of row (only if not inside quotes)
      if (char === '\r') i++; // Skip \n after \r
      
      currentRow.push(currentField.trim());
      
      // Only add non-empty rows
      if (currentRow.some(f => f.length > 0)) {
        rows.push(currentRow);
      }
      
      currentRow = [];
      currentField = '';
    } else if (char === '\r' && !inQuotes) {
      // Handle standalone \r as line ending
      currentRow.push(currentField.trim());
      
      if (currentRow.some(f => f.length > 0)) {
        rows.push(currentRow);
      }
      
      currentRow = [];
      currentField = '';
    } else {
      // Regular character (including \n inside quotes)
      currentField += char;
    }
  }
  
  // Don't forget last field and row
  if (currentField.length > 0 || currentRow.length > 0) {
    currentRow.push(currentField.trim());
    if (currentRow.some(f => f.length > 0)) {
      rows.push(currentRow);
    }
  }
  
  return rows;
}

function cleanString(str: string): string {
  if (!str) return '';
  // Remove quotes, trim, and normalize line breaks within fields
  return str.replace(/^["']|["']$/g, '').replace(/[\r\n]+/g, ' ').trim();
}

function parseCurrency(val: string | undefined): number {
  if (!val) return 0;
  
  // Remove quotes, R$, spaces
  let clean = val.replace(/^["']|["']$/g, '').trim();
  clean = clean.replace(/[R$\s]/g, '');

  // Handle parentheses for negative numbers
  if (clean.startsWith('(') && clean.endsWith(')')) {
    clean = '-' + clean.slice(1, -1);
  }
  
  if (!clean || clean === '-') return 0;

  // Detect Brazilian format (1.234,56) vs American (1,234.56)
  const lastComma = clean.lastIndexOf(',');
  const lastDot = clean.lastIndexOf('.');

  if (lastComma > lastDot) {
    // Brazilian format: 1.234,56 -> 1234.56
    clean = clean.replace(/\./g, '').replace(',', '.');
  } else if (lastDot > lastComma) {
    // American format: 1,234.56 -> 1234.56
    clean = clean.replace(/,/g, '');
  } else if (lastComma > -1 && lastDot === -1) {
    // Only comma: 123,45 -> 123.45
    clean = clean.replace(',', '.');
  }
  
  // Remove any remaining non-numeric chars except . and -
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

function parseDate(dateStr: string | undefined): string {
  if (!dateStr) return '1970-01-01';
  
  let clean = dateStr.replace(/^["']|["']$/g, '').trim();
  
  // If datetime, get only date part
  if (clean.includes(' ')) {
    clean = clean.split(' ')[0];
  }

  // Brazilian format: DD/MM/YYYY or DD-MM-YYYY
  const ptBrRegex = /^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})/;
  const ptMatch = clean.match(ptBrRegex);

  if (ptMatch) {
    const day = ptMatch[1].padStart(2, '0');
    const month = ptMatch[2].padStart(2, '0');
    let year = ptMatch[3];
    if (year.length === 2) year = '20' + year;
    return `${year}-${month}-${day}`;
  }

  // ISO format: YYYY-MM-DD
  const isoRegex = /^(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})/;
  const isoMatch = clean.match(isoRegex);
  if (isoMatch) {
    return clean.substring(0, 10);
  }

  return '1970-01-01';
}