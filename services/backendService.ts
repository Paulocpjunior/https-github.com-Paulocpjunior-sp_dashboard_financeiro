
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
  // GESTÃO DE USUÁRIOS (ADMIN)
  // =========================================================================================
  
  // Alterar Status (Bloquear/Desbloquear)
  toggleUserStatus: async (username: string, newStatus: boolean): Promise<{ success: boolean; message: string }> => {
     return callAppsScript({
       action: 'admin_toggle_status',
       username: username,
       active: newStatus
     });
  },

  // Alterar Senha (Admin force reset)
  adminChangePassword: async (username: string, newPassword: string): Promise<{ success: boolean; message: string }> => {
     return callAppsScript({
       action: 'admin_change_password',
       username: username,
       newPassword: newPassword
     });
  },

  // =========================================================================================
  // REGISTRO DE NOVO USUÁRIO
  // =========================================================================================
  registerUser: async (data: RegisterUserData): Promise<{ success: boolean; message: string }> => {
    console.log('[BackendService] Iniciando registro de usuário:', data.username);

    try {
      if (!data.name || !data.email || !data.username || !data.password) {
        return { success: false, message: 'Todos os campos obrigatórios devem ser preenchidos.' };
      }
      if (data.password.length < 6) {
        return { success: false, message: 'A senha deve ter no mínimo 6 caracteres.' };
      }
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(data.email)) {
        return { success: false, message: 'E-mail inválido.' };
      }

      const existingUser = MOCK_USERS.find(u => u.username.toLowerCase() === data.username.toLowerCase());
      if (existingUser) {
        return { success: false, message: 'Este nome de usuário já está em uso.' };
      }

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
      return { success: false, message: error.message || 'Erro ao processar cadastro.' };
    }
  },

  // Métodos de aprovação/rejeição omitidos para brevidade (mantém os mesmos)
  approvePendingUser: async (email: string, name: string, username: string) => callAppsScript({ action: 'approve', email, name, username }),
  rejectPendingUser: async (email: string, name: string, username: string, reason?: string) => callAppsScript({ action: 'reject', email, name, username, reason: reason || '' }),
  resendConfirmationEmail: async (email: string, name: string, username: string) => callAppsScript({ action: 'resend', email, name, username }),
  requestPasswordReset: async (username: string) => {
    const user = MOCK_USERS.find(u => u.username.toLowerCase() === username.toLowerCase());
    if (!user) return { success: false, message: 'Usuário não encontrado.' };
    const result = await callAppsScript({ action: 'reset_password', email: user.email || '', name: user.name, username: user.username });
    return result.success ? { success: true, message: 'Nova senha enviada.' } : { success: false, message: 'Erro ao processar.' };
  },

  fetchTransactions: async (): Promise<Transaction[]> => {
    const spreadsheetId = BackendService.getSpreadsheetId();
    const gid = BackendService.getSpreadsheetGid();
    
    const csvUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/export?format=csv&gid=${gid}`; 
    console.log(`[BackendService] Conectando à planilha: ${spreadsheetId} (Tab: ${gid})...`);
    
    try {
      const response = await fetch(csvUrl);
      if (!response.ok) throw new Error(`Erro HTTP: ${response.status}.`);
      
      let csvText = await response.text();
      if (csvText.charCodeAt(0) === 0xFEFF) csvText = csvText.slice(1);
      if (csvText.trim().startsWith('<!DOCTYPE html>') || csvText.includes('<html')) {
        throw new Error('A planilha está privada. Altere o compartilhamento.');
      }

      const allRows = parseCSVComplete(csvText);
      if (allRows.length < 2) return [];

      console.log(`[BackendService] Total de registros parseados: ${allRows.length}`);

      // Encontrar a linha de cabeçalho
      let headerRowIndex = 0;
      for (let i = 0; i < Math.min(allRows.length, 10); i++) {
        const row = allRows[i];
        if (row.length > 3) {
          const combined = row.slice(0, 5).join(' ').toLowerCase();
          if (combined.includes('tipo de lan') || combined.includes('contas banc') || combined.includes('data')) {
            headerRowIndex = i;
            break;
          }
        }
      }

      // Mapeamento Dinâmico de Colunas
      const headerRow = allRows[headerRowIndex].map(c => c.toLowerCase().trim());
      
      const getColIdx = (hints: string[], fallback: number) => {
          const idx = headerRow.findIndex(h => hints.some(hint => h.includes(hint)));
          return idx !== -1 ? idx : fallback;
      };

      // Nova Função: Encontrar TODOS os índices que correspondem aos hints
      // Isso é crucial quando há múltiplas colunas de "Vencimento" (Ex: Vencimento-Receber, Vencimento-Pagar)
      const getColIndices = (hints: string[]) => {
          const indices: number[] = [];
          headerRow.forEach((h, i) => {
              if (hints.some(hint => h.includes(hint))) {
                  indices.push(i);
              }
          });
          return indices;
      };

      const COL = {
        dataLancamento: getColIdx(['data lança', 'data lanca'], 1),
        contasBancarias: getColIdx(['contas banc', 'conta banc'], 2),
        tipoLancamento: getColIdx(['tipo de lan', 'tipo lan'], 3),
        pagoPor: getColIdx(['pago por'], 4),
        movimentacao: getColIdx(['movimentação', 'movimentacao'], 5), // Coluna F
        
        // CORREÇÃO: Capturar todas as possíveis colunas de vencimento
        dueDateCandidates: getColIndices(['vencimento', 'data a pagar', 'data.vencimento']),
        
        docPago: getColIdx(['doc.pago', 'documento pago'], 9), // Saídas
        dataBaixa: getColIdx(['data baixa', 'data pagamento'], 10),
        valorRefOriginal: getColIdx(['valor ref', 'valor original'], 11),
        valorOriginalRecorrente: getColIdx(['recorrente'], 12),
        valorPago: getColIdx(['valor pago'], 13),
        nomeEmpresa: getColIdx(['nome empresa', 'razao social', 'razão social', 'credor', 'sacado'], 26), 
        valorHonorarios: getColIdx(['honorários', 'honorarios'], 27),
        valorExtras: getColIdx(['extras'], 28),
        totalCobranca: getColIdx(['total cobrança', 'total cobranca'], 30),
        valorRecebido: getColIdx(['valor recebido'], 31),
        saldoMes: getColIdx(['saldo mês', 'saldo mes'], 32),
        docPagoReceber: getColIdx(['doc.pago - receber', 'doc.pago receber', 'pago - receber', 'status receber', 'recebido?'], 35), 
        cpfCnpj: getColIdx(['cpf', 'cnpj', 'documento', 'cprf'], -1), // Tenta localizar coluna de CPF/CNPJ
        submissionId: 39,
      };

      console.log('[BackendService] Mapeamento de Colunas Detectado:', {
          docPagoReceber: COL.docPagoReceber,
          dueDateCandidates: COL.dueDateCandidates,
          totalCobranca: COL.totalCobranca,
          valorRecebido: COL.valorRecebido,
          cliente: COL.nomeEmpresa,
          cpfCnpj: COL.cpfCnpj
      });

      const dataRows = allRows.slice(headerRowIndex + 1);

      const transactions = dataRows.map((cols, index) => {
        const get = (idx: number) => (idx >= 0 && idx < cols.length ? cols[idx] || '' : '');

        let rawType = get(COL.tipoLancamento);
        
        // --- NORMALIZAÇÃO DE TIPO DE LANÇAMENTO (FIX DUPLICIDADE) ---
        // Padroniza variações como "Contas a Pagar / Saida Caixa" para um único valor consistente
        const tLower = rawType.toLowerCase();
        if (tLower.includes('pagar') && (tLower.includes('saida') || tLower.includes('saída'))) {
            rawType = 'Saída de Caixa / Contas a Pagar';
        } else if (tLower.includes('receber') && (tLower.includes('entrada'))) {
            rawType = 'Entrada de Caixa / Contas a Receber';
        }
        // -----------------------------------------------------------

        const rawMovement = get(COL.movimentacao); // COLUNA F (Texto Original)
        const rawValorPago = get(COL.valorPago);
        const rawValorRecebido = get(COL.valorRecebido);
        const rawTotalCobranca = get(COL.totalCobranca);
        const rawValorRefOriginal = get(COL.valorRefOriginal);       // COLUNA L
        const rawValorOrigRecorrente = get(COL.valorOriginalRecorrente); // COLUNA M

        // 1. Determinação da Movimentação (Prioritária para Lógica do Sistema)
        let movement: 'Entrada' | 'Saída' = 'Entrada';
        const tipoLower = rawType.toLowerCase();
        
        if (tipoLower.includes('saída') || tipoLower.includes('saida') || tipoLower.includes('pagar') || tipoLower.includes('despesa') || tipoLower.includes('fornecedor')) {
          movement = 'Saída';
        } else if (tipoLower.includes('entrada') || tipoLower.includes('receber') || tipoLower.includes('recebimento') || tipoLower.includes('receita')) {
          movement = 'Entrada';
        } else if (rawMovement) {
          const mov = rawMovement.toLowerCase();
          if (mov.includes('saída') || mov.includes('saida') || mov.includes('despesa')) {
            movement = 'Saída';
          }
        }

        // 2. Parseamento de Valores
        let valPaid = Math.abs(parseCurrency(rawValorPago));
        let valReceived = Math.abs(parseCurrency(rawValorRecebido));
        const valCobranca = Math.abs(parseCurrency(rawTotalCobranca));
        const valRefOriginal = Math.abs(parseCurrency(rawValorRefOriginal));
        const valOrigRecorrente = Math.abs(parseCurrency(rawValorOrigRecorrente));

        // 3. CORREÇÃO INTELIGENTE DE VALORES ZERADOS E PREVISÃO
        if (movement === 'Saída') {
           if (valPaid === 0) {
               // Prioridade 1: Valor Ref./Valor Original (col L) - VALOR DA DESPESA PREVISTA
               if (valRefOriginal > 0) {
                   valPaid = valRefOriginal;
               // Prioridade 2: Valor Original Recorrente (col M)
               } else if (valOrigRecorrente > 0) {
                   valPaid = valOrigRecorrente;
               // Prioridade 3: Total Cobrança (col AD) - fallback original
               } else if (valCobranca > 0) {
                   valPaid = valCobranca;
               } else if (valReceived > 0) {
                   valPaid = valReceived;
                   valReceived = 0; 
               }
           }
        }
        
        // Determinar status de Entrada ANTES do fallback
        let entradaStatus = '';
        if (movement === 'Entrada') {
            const ajVal = get(COL.docPagoReceber);
            const rawAF = Math.abs(parseCurrency(rawValorRecebido));
            const normalizedAj = ajVal ? ajVal.toLowerCase().trim() : '';

            // Se Doc.Pago - Receber (AJ) for SIM, força status PAGO
            // Verifica variações como "sim", "pago", "ok"
            if (normalizedAj === 'sim' || normalizedAj === 's' || normalizeStatus(ajVal) === 'Pago') {
                entradaStatus = 'Pago';
            } 
            // Se houver valor recebido (AF) preenchido, considera PAGO
            else if (rawAF > 0) {
                entradaStatus = 'Pago';
            } 
            else {
                entradaStatus = 'Pendente';
            }
        }

        if (movement === 'Entrada' && valReceived === 0) {
            if (valPaid > 0) {
                valReceived = valPaid; 
                valPaid = 0;
            } else if (entradaStatus === 'Pago' && valCobranca > 0) {
                // Só copia totalCobranca se for PAGO (para mostrar valor recebido no Dashboard)
                valReceived = valCobranca;
            }
            // Se Pendente, valReceived fica 0
        }

        // LÓGICA DE DATAS (CORREÇÃO DE VENCIMENTO)
        const rawDate = get(COL.dataLancamento);
        const rawPaymentDate = get(COL.dataBaixa);
        
        // Tenta encontrar a data de vencimento em MÚLTIPLAS colunas candidatas
        // Isso resolve o problema de formulários condicionais onde "Vencimento-Receber" e "Vencimento-Pagar" são colunas diferentes
        let rawDueDate = '';
        for (const idx of COL.dueDateCandidates) {
            const candidateVal = get(idx);
            if (candidateVal && candidateVal.trim() !== '') {
                // Validação extra: não pegar a própria data de lançamento se a coluna for ambígua
                if (idx !== COL.dataLancamento) {
                    rawDueDate = candidateVal;
                    break;
                }
            }
        }

        const finalDate = parseDate(rawDate);
        let finalDueDate = parseDate(rawDueDate);
        
        // Fallback APENAS se não encontrou nenhuma data de vencimento válida E a data de lançamento for válida
        if (finalDueDate === '1970-01-01' && finalDate !== '1970-01-01') {
             finalDueDate = finalDate;
        }
        
        const finalPaymentDate = parseDate(rawPaymentDate);

        return {
          id: `trx-${index}`,
          date: finalDate,
          dueDate: finalDueDate,
          paymentDate: finalPaymentDate !== '1970-01-01' ? finalPaymentDate : undefined,
          bankAccount: cleanString(get(COL.contasBancarias)),
          type: cleanString(rawType),
          description: cleanString(rawMovement), // Armazena o valor exato da COLUNA F aqui
          paidBy: cleanString(get(COL.pagoPor)),
          status: movement === 'Entrada' ? entradaStatus as 'Pago' | 'Pendente' : normalizeStatus(get(COL.docPago)),
          client: cleanString(get(COL.nomeEmpresa)),
          movement: movement, 
          valuePaid: valPaid,
          valueReceived: valReceived,
          honorarios: parseCurrency(get(COL.valorHonorarios)),
          valorExtra: parseCurrency(get(COL.valorExtras)),
          totalCobranca: parseCurrency(rawTotalCobranca),
          cpfCnpj: cleanString(get(COL.cpfCnpj)), // Captura CPF/CNPJ da planilha
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
  
  fetchUsers: async (): Promise<User[]> => MOCK_USERS.map(({ passwordHash, ...u }) => u as User),
  login: async (username: string, passwordHashInput: string) => {
    const user = MOCK_USERS.find(u => u.username === username);
    if (!user) return { success: false, message: 'Usuário não encontrado.' };
    if (passwordHashInput === user.passwordHash && user.active) {
      const { passwordHash, ...safeUser } = user;
      return { success: true, user: safeUser as User };
    }
    return { success: false, message: 'Senha incorreta.' };
  },
};

// Funções Auxiliares (mantidas)
function parseCSVComplete(csvText: string): string[][] {
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentField = '';
  let inQuotes = false;
  for (let i = 0; i < csvText.length; i++) {
    const char = csvText[i];
    const nextChar = csvText[i + 1];
    if (char === '"') {
      if (inQuotes && nextChar === '"') { currentField += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      currentRow.push(currentField.trim()); currentField = '';
    } else if ((char === '\n' || (char === '\r' && nextChar === '\n')) && !inQuotes) {
      if (char === '\r') i++;
      currentRow.push(currentField.trim());
      if (currentRow.some(f => f.length > 0)) rows.push(currentRow);
      currentRow = []; currentField = '';
    } else if (char === '\r' && !inQuotes) {
      currentRow.push(currentField.trim());
      if (currentRow.some(f => f.length > 0)) rows.push(currentRow);
      currentRow = []; currentField = '';
    } else currentField += char;
  }
  if (currentField.length > 0 || currentRow.length > 0) {
    currentRow.push(currentField.trim());
    if (currentRow.some(f => f.length > 0)) rows.push(currentRow);
  }
  return rows;
}
function cleanString(str: string) { return str ? str.replace(/^["']|["']$/g, '').replace(/[\r\n]+/g, ' ').trim() : ''; }
function parseCurrency(val: string | undefined): number {
  if (!val) return 0;
  let clean = val.replace(/^["']|["']$/g, '').trim().replace(/[R$\s]/g, '');
  if (clean.startsWith('(') && clean.endsWith(')')) clean = '-' + clean.slice(1, -1);
  if (!clean || clean === '-') return 0;
  const lastComma = clean.lastIndexOf(',');
  const lastDot = clean.lastIndexOf('.');
  if (lastComma > lastDot) clean = clean.replace(/\./g, '').replace(',', '.');
  else if (lastDot > lastComma) clean = clean.replace(/,/g, '');
  else if (lastComma > -1 && lastDot === -1) clean = clean.replace(',', '.');
  clean = clean.replace(/[^0-9.-]/g, '');
  const num = parseFloat(clean);
  return isNaN(num) ? 0 : num;
}
function normalizeStatus(val: string | undefined): 'Pago' | 'Pendente' | 'Agendado' {
  if (!val) return 'Pendente';
  const v = val.toLowerCase().trim();
  if (v === 'sim' || v === 'pago' || v === 'ok' || v === 'liquidado' || v === 'recebido') return 'Pago';
  if (v === 'não' || v === 'nao' || v === 'pendente' || v === 'aberto') return 'Pendente';
  if (v.includes('agenda')) return 'Agendado';
  return 'Pendente';
}
function parseDate(dateStr: string | undefined): string {
  if (!dateStr) return '1970-01-01';
  let clean = dateStr.replace(/^["']|["']$/g, '').trim().split(' ')[0];
  const ptBrRegex = /^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})/;
  const ptMatch = clean.match(ptBrRegex);
  if (ptMatch) {
    let year = ptMatch[3];
    if (year.length === 2) year = '20' + year;
    return `${year}-${ptMatch[2].padStart(2, '0')}-${ptMatch[1].padStart(2, '0')}`;
  }
  const isoRegex = /^(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})/;
  if (clean.match(isoRegex)) return clean.substring(0, 10);
  return '1970-01-01';
}
