import { Transaction, User } from '../types';
import { MOCK_USERS } from '../constants';

// ID da nova planilha fornecida
const SPREADSHEET_ID = '1jwBTCHiQ-YqtPkyQuPaAEzu-uQi62qA2SwVUhHUPt1Y';
const CSV_URL = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/export?format=csv`;

export const BackendService = {
  
  isProduction: (): boolean => true,

  fetchTransactions: async (): Promise<Transaction[]> => {
    console.log(`Conectando à planilha: ${SPREADSHEET_ID}...`);
    
    try {
      const response = await fetch(CSV_URL);
      
      if (!response.ok) {
        throw new Error(`Erro HTTP: ${response.status}. Verifique se a planilha está pública (Compartilhar -> Qualquer pessoa com o link).`);
      }
      
      const csvText = await response.text();
      const rows = csvText.split('\n');
      
      // Remove o cabeçalho
      const dataRows = rows.slice(1).filter(row => row.trim() !== '');

      return dataRows.map((rowString, index) => {
        // Parse CSV line handling quotes properly
        const columns = parseCSVLine(rowString);
        
        // Mapeamento baseado na ordem padrão das colunas da planilha:
        // 0: ID, 1: Data, 2: Conta, 3: Tipo, 4: Status, 5: Cliente, 6: PagoPor, 7: Movimento, 8: V.Pago, 9: V.Recebido
        
        const rawDate = columns[1];
        const rawValorPago = columns[8];
        const rawValorRecebido = columns[9];

        return {
          id: columns[0] || `trx-${index}`,
          date: parseDate(rawDate),
          bankAccount: columns[2]?.replace(/['"]/g, '').trim() || 'Outros',
          type: columns[3]?.replace(/['"]/g, '').trim() || 'Outros',
          status: normalizeStatus(columns[4]),
          client: columns[5]?.replace(/['"]/g, '').trim() || 'Consumidor',
          paidBy: columns[6]?.replace(/['"]/g, '').trim() || 'Financeiro',
          movement: columns[7]?.replace(/['"]/g, '').trim() === 'Saída' ? 'Saída' : 'Entrada',
          valuePaid: parseCurrency(rawValorPago),
          valueReceived: parseCurrency(rawValorRecebido),
        } as Transaction;
      });

    } catch (error) {
      console.error('Erro ao buscar dados da planilha:', error);
      throw new Error('Falha ao conectar com a Planilha Google. Verifique o compartilhamento.');
    }
  },

  fetchUsers: async (): Promise<User[]> => {
    return MOCK_USERS.map(({ passwordHash, ...u }) => u as User);
  },

  login: async (username: string, passwordHashInput: string): Promise<{ success: boolean; user?: User; message?: string }> => {
    const user = MOCK_USERS.find(u => u.username === username);
    
    if (!user) {
      return { success: false, message: 'Usuário não encontrado.' };
    }
    
    // Verifica o hash recebido contra o hash armazenado no usuário (definido em constants.ts)
    // Por padrão, a senha para todos os MOCK_USERS é "admin"
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

// --- Helpers ---

// Parser robusto para CSV que lida com aspas e vírgulas dentro de campos
function parseCSVLine(text: string): string[] {
  const result: string[] = [];
  let curVal = '';
  let inQuote = false;
  
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    
    if (inQuote) {
      if (char === '"') {
        if (i + 1 < text.length && text[i + 1] === '"') {
          curVal += '"'; // Double quote inside quote
          i++;
        } else {
          inQuote = false;
        }
      } else {
        curVal += char;
      }
    } else {
      if (char === '"') {
        inQuote = true;
      } else if (char === ',') {
        result.push(curVal);
        curVal = '';
      } else if (char === '\r') {
        // ignore CR
      } else {
        curVal += char;
      }
    }
  }
  result.push(curVal);
  return result;
}

// Converte string de moeda (R$ 1.200,50 ou 1200.50) para number
function parseCurrency(val: string | undefined): number {
  if (!val) return 0;
  // Remove R$, espaços e aspas
  let clean = val.replace(/["'R$\s]/g, '');
  
  // Se tiver vírgula como separador decimal (formato BR: 1.000,00)
  if (clean.includes(',') && !clean.includes('.')) {
     clean = clean.replace(',', '.');
  } else if (clean.includes(',') && clean.includes('.')) {
     // Formato misto (1.000,00), remove ponto de milhar e troca vírgula por ponto
     clean = clean.replace(/\./g, '').replace(',', '.');
  }
  
  const num = parseFloat(clean);
  return isNaN(num) ? 0 : num;
}

// Normaliza status para os tipos esperados
function normalizeStatus(val: string | undefined): 'Pago' | 'Pendente' | 'Agendado' {
  if (!val) return 'Pendente';
  const v = val.trim().toLowerCase().replace(/['"]/g, '');
  if (v === 'sim' || v === 'pago' || v === 'ok') return 'Pago';
  if (v === 'agendado' || v === 'futuro') return 'Agendado';
  return 'Pendente';
}

// Converte formatos de data (DD/MM/YYYY ou ISO) para YYYY-MM-DD
function parseDate(dateStr: string | undefined): string {
  if (!dateStr) return new Date().toISOString().split('T')[0];
  
  const clean = dateStr.replace(/['"]/g, '').trim();
  
  // Formato DD/MM/YYYY
  if (clean.includes('/')) {
    const parts = clean.split('/');
    if (parts.length === 3) {
      // Se ano for 2 digitos, assume 20xx
      let year = parts[2];
      if (year.length === 2) year = '20' + year;
      // YYYY-MM-DD
      return `${year}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
    }
  }
  
  // Tenta parse direto (ISO)
  try {
    const d = new Date(clean);
    if (!isNaN(d.getTime())) {
      return d.toISOString().split('T')[0];
    }
  } catch(e) {}

  return new Date().toISOString().split('T')[0];
}