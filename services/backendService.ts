import { Transaction, User } from '../types';
import { MOCK_USERS } from '../constants';

// =========================================================================================
// CONFIGURAÇÃO DO BANCO DE DADOS (GOOGLE SHEETS)
// =========================================================================================
const DEFAULT_SPREADSHEET_ID = '17mHd8eqKoj7Cl6E2MCkr0PczFj-lKv_vmFRCY5hypwg'; 
const DEFAULT_GID = '1276925607';

const STORAGE_KEY_DB_SOURCE = 'cashflow_db_source_id';
const STORAGE_KEY_DB_GID = 'cashflow_db_gid';

// =========================================================================================
// URL DO GOOGLE APPS SCRIPT
// =========================================================================================
const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycby1hCtCHpomiGpyLujr0SNdfL4AYXg0rUG_N0-s8e4B5hwOxjKa7rGsR1D2/exec';

// Interface para dados de registro
interface RegisterUserData {
  name: string;
  email: string;
  phone?: string;
  username: string;
  password: string;
}

// =========================================================================================
// FUNÇÃO PARA CHAMAR O GOOGLE APPS SCRIPT
// =========================================================================================
const callAppsScript = async (data: any): Promise<{ success: boolean; message: string; [key: string]: any }> => {

  try {
    console.log('[BackendService] Enviando para Apps Script:', data.action);
    
    const response = await fetch(APPS_SCRIPT_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(data),
      redirect: 'follow',
    });

    if (response.ok) {
      const result = await response.json();
      console.log('[BackendService] Resposta do Apps Script:', result);
      return result;
    } else {
      console.error('[BackendService] Erro na resposta:', response.status);
      return { success: false, message: 'Erro ao comunicar com o servidor.' };
    }
  } catch (error: any) {
    console.error('[BackendService] Erro ao chamar Apps Script:', error);
    
    // Tenta com mode: no-cors como fallback
    try {
      await fetch(APPS_SCRIPT_URL, {
        method: 'POST',
        mode: 'no-cors',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(data),
      });
      
      console.log('[BackendService] Requisição enviada (no-cors)');
      return { success: true, message: 'Cadastro enviado! Verifique seu e-mail.' };
    } catch (noCorsError) {
      return { success: false, message: 'Erro de conexão com o servidor.' };
    }
  }
};

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
  // REGISTRO DE NOVO USUÁRIO - ENVIA DIRETO PARA GOOGLE APPS SCRIPT
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

      // Validar formato de e-mail
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(data.email)) {
        return { success: false, message: 'E-mail inválido.' };
      }

      // Verificar se usuário já existe nos MOCK_USERS (usuários ativos)
      const existingUser = MOCK_USERS.find(u => 
        u.username.toLowerCase() === data.username.toLowerCase()
      );

      if (existingUser) {
        return { success: false, message: 'Este nome de usuário já está em uso.' };
      }

      // Chamar Google Apps Script para registrar e enviar e-mail
      const scriptResult = await callAppsScript({
        action: 'register',
        name: data.name,
        email: data.email,
        phone: data.phone || '',
        username: data.username,
        password: data.password,
      });

      return scriptResult;

    } catch (error: any) {
      console.error('[BackendService] Erro no registro:', error);
      return { 
        success: false, 
        message: error.message || 'Erro ao processar cadastro. Tente novamente.' 
      };
    }
  },

  // =========================================================================================
  // APROVAR USUÁRIO - CHAMA APPS SCRIPT
  // =========================================================================================
  approvePendingUser: async (email: string, name: string, username: string): Promise<{ success: boolean; message: string }> => {
    const result = await callAppsScript({
      action: 'approve',
      email,
      name,
      username,
    });

    return result;
  },

  // =========================================================================================
  // REJEITAR USUÁRIO - CHAMA APPS SCRIPT
  // =========================================================================================
  rejectPendingUser: async (email: string, name: string, username: string, reason?: string): Promise<{ success: boolean; message: string }> => {
    const result = await callAppsScript({
      action: 'reject',
      email,
      name,
      username,
      reason: reason || '',
    });

    return result;
  },

  // =========================================================================================
  // REENVIAR E-MAIL DE CONFIRMAÇÃO
  // =========================================================================================
  resendConfirmationEmail: async (email: string, name: string, username: string): Promise<{ success: boolean; message: string }> => {
    const result = await callAppsScript({
      action: 'resend',
      email,
      name,
      username,
    });

    return result;
  },

  // =========================================================================================
  // SOLICITAR RESET DE SENHA
  // =========================================================================================
  requestPasswordReset: async (username: string): Promise<{ success: boolean; message: string }> => {
    // Buscar usuário
    const user = MOCK_USERS.find(u => u.username.toLowerCase() === username.toLowerCase());
    
    if (!user) {
      return { success: false, message: 'Usuário não encontrado.' };
    }

    // Chamar Apps Script para enviar e-mail com nova senha
    const result = await callAppsScript({
      action: 'reset_password',
      email: user.email || '',
      name: user.name,
      username: user.username,
    });

    if (result.success) {
      return { success: true, message: 'Nova senha enviada para o e-mail cadastrado.' };
    }
    
    return { success: false, message: 'Erro ao processar solicitação.' };
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

      if (csvText.charCodeAt(0) === 0xFEFF) {
        csvText = csvText.slice(1);
      }

      if (csvText.trim().startsWith('<!DOCTYPE html>') || csvText.includes('<html')) {
        throw new Error('A planilha está privada. Altere o compartilhamento para "Qualquer pessoa com o link".');
      }

      const allRows = parseCSVComplete(csvText);
      
      if (allRows.length < 2) {
        return [];
      }

      console.log(`[BackendService] Total de registros parseados: ${allRows.length}`);

      const COL = {
        timestamp: 0,
        dataLancamento: 1,
        contasBancarias: 2,
        tipoLancamento: 3,
        pagoPor: 4,
        movimentacao: 5,
        dataAPagar: 7,
        docPago: 9,
        dataBaixa: 10,
        valorPago: 13,
        nomeEmpresa: 26,
        valorHonorarios: 27,
        valorExtras: 28,
        totalCobranca: 30,
        valorRecebido: 31,
        submissionId: 39,
      };

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

      const dataRows = allRows.slice(headerRowIndex + 1);

      const transactions = dataRows.map((cols, index) => {
        const get = (idx: number): string => {
          if (idx >= 0 && idx < cols.length) {
            return cols[idx] || '';
          }
          return '';
        };

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

        let finalId = `trx-${index}`;
        if (rawId && rawId.trim().length > 0 && rawId.length < 50 && !rawId.includes('/')) {
          finalId = rawId.trim();
        }

        const valPaid = Math.abs(parseCurrency(rawValorPago));
        const valReceived = Math.abs(parseCurrency(rawValorRecebido));

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
          movement: cleanString(rawMovement),
          valuePaid: valPaid,
          valueReceived: valReceived,
          honorarios: parseCurrency(rawHonorarios),
          valorExtra: parseCurrency(rawValorExtra),
          totalCobranca: parseCurrency(rawTotalCobranca),
        } as Transaction;
      });

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
};

// =============================================================================
// PARSER CSV COMPLETO
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
          currentField += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        inQuotes = true;
      }
    } else if (char === ',' && !inQuotes) {
      currentRow.push(currentField.trim());
      currentField = '';
    } else if ((char === '\n' || (char === '\r' && nextChar === '\n')) && !inQuotes) {
      if (char === '\r') i++;
      currentRow.push(currentField.trim());
      if (currentRow.some(f => f.length > 0)) {
        rows.push(currentRow);
      }
      currentRow = [];
      currentField = '';
    } else if (char === '\r' && !inQuotes) {
      currentRow.push(currentField.trim());
      if (currentRow.some(f => f.length > 0)) {
        rows.push(currentRow);
      }
      currentRow = [];
      currentField = '';
    } else {
      currentField += char;
    }
  }
  
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
  return str.replace(/^["']|["']$/g, '').replace(/[\r\n]+/g, ' ').trim();
}

function parseCurrency(val: string | undefined): number {
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

function parseDate(dateStr: string | undefined): string {
  if (!dateStr) return '1970-01-01';
  
  let clean = dateStr.replace(/^["']|["']$/g, '').trim();
  
  if (clean.includes(' ')) {
    clean = clean.split(' ')[0];
  }

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