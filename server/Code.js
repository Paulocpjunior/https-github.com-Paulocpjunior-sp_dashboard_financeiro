/**
 * ==========================================
 * CASHFLOW PRO - GOOGLE APPS SCRIPT BACKEND
 * ==========================================
 * 
 * Copie este código para o arquivo 'Code.gs' no seu projeto do Google Apps Script.
 * Execute a função 'setupDatabase' uma vez para criar as abas necessárias.
 */

const SHEET_TRANSACTIONS = "Transacoes";
const SHEET_USERS = "Usuarios";

/**
 * Função necessária para servir o React App
 */
function doGet(e) {
  return HtmlService.createTemplateFromFile('index')
    .evaluate()
    .setTitle('CashFlow Pro')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/**
 * CONFIGURAÇÃO INICIAL DO BANCO DE DADOS
 * Execute esta função manualmente no editor para criar a estrutura.
 */
function setupDatabase() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  
  // 1. Setup Transações
  let sheetTrx = ss.getSheetByName(SHEET_TRANSACTIONS);
  if (!sheetTrx) {
    sheetTrx = ss.insertSheet(SHEET_TRANSACTIONS);
    sheetTrx.appendRow([
      "ID", "Data", "Conta", "Tipo", "Status", "Cliente/Descricao", "PagoPor", "Movimento", "ValorPago", "ValorRecebido"
    ]);
    sheetTrx.setFrozenRows(1);
    // Dados de exemplo
    sheetTrx.appendRow([
      "trx-1", new Date(), "Itau", "Serviço", "Pago", "Cliente Exemplo", "Financeiro", "Entrada", 0, 1500.00
    ]);
  }

  // 2. Setup Usuários
  let sheetUsers = ss.getSheetByName(SHEET_USERS);
  if (!sheetUsers) {
    sheetUsers = ss.insertSheet(SHEET_USERS);
    sheetUsers.appendRow([
      "ID", "Usuario", "Nome", "Role", "Ativo", "SenhaHash"
    ]);
    sheetUsers.setFrozenRows(1);
    // Usuário Admin Padrão (Senha: admin)
    // Hash SHA-256 para 'admin': 8c6976e5b5410415bde908bd4dee15dfb167a9c873fc4bb8a81f6f2ab448a918
    sheetUsers.appendRow([
      "1", "admin", "Administrador", "admin", true, "8c6976e5b5410415bde908bd4dee15dfb167a9c873fc4bb8a81f6f2ab448a918"
    ]);
  }
}

/**
 * API: Buscar Transações
 */
function getTransactions() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_TRANSACTIONS);
  if (!sheet) return [];
  
  const data = sheet.getDataRange().getValues();
  const headers = data.shift(); // Remove cabeçalho
  
  // Mapeia Array para Objeto JSON compatível com o Frontend
  return data.map(row => ({
    id: String(row[0]),
    date: formatDateISO(row[1]),
    bankAccount: String(row[2]),
    type: String(row[3]),
    status: String(row[4]),
    client: String(row[5]),
    paidBy: String(row[6]),
    movement: String(row[7]),
    valuePaid: Number(row[8] || 0),
    valueReceived: Number(row[9] || 0)
  })).sort((a, b) => new Date(b.date) - new Date(a.date));
}

/**
 * API: Buscar Usuários (Para Admin)
 */
function getUsers() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_USERS);
  if (!sheet) return [];
  
  const data = sheet.getDataRange().getValues();
  data.shift(); // Remove header
  
  return data.map(row => ({
    id: String(row[0]),
    username: String(row[1]),
    name: String(row[2]),
    role: String(row[3]),
    active: Boolean(row[4]),
    // Não retornamos o hash da senha na listagem geral por segurança, a menos que necessário
    passwordHash: String(row[5]) 
  }));
}

/**
 * API: Autenticar Usuário
 */
function authenticateUser(username, passwordHash) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_USERS);
  if (!sheet) return { success: false, message: "Banco de dados de usuários não encontrado." };
  
  const data = sheet.getDataRange().getValues();
  data.shift(); // Remove header
  
  // Procura usuário
  // Col 1 = Username, Col 5 = Hash, Col 4 = Ativo
  const userRow = data.find(row => String(row[1]).toLowerCase() === String(username).toLowerCase());
  
  if (!userRow) {
    return { success: false, message: "Usuário não encontrado." };
  }
  
  const storedHash = String(userRow[5]);
  const isActive = Boolean(userRow[4]);
  
  if (storedHash !== passwordHash) {
    return { success: false, message: "Senha incorreta." };
  }
  
  if (!isActive) {
    return { success: false, message: "Usuário inativo. Contate o administrador." };
  }
  
  // Login bem sucedido
  return {
    success: true,
    user: {
      id: String(userRow[0]),
      username: String(userRow[1]),
      name: String(userRow[2]),
      role: String(userRow[3]),
      active: isActive
    }
  };
}

/**
 * API: Solicitar Reset de Senha
 */
function requestPasswordReset(username) {
  // Em um caso real, aqui enviaríamos um email usando MailApp.sendEmail
  // Para este MVP, apenas simulamos a verificação
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_USERS);
  const data = sheet.getDataRange().getValues();
  const userExists = data.some(row => String(row[1]).toLowerCase() === String(username).toLowerCase());
  
  if (userExists) {
    return { success: true, message: "Solicitação enviada. Verifique seu e-mail (Simulado)." };
  }
  
  return { success: false, message: "Usuário não encontrado." };
}

// Helper: Formata data do Sheets para YYYY-MM-DD
function formatDateISO(dateObj) {
  if (!dateObj) return "";
  if (typeof dateObj === 'string') return dateObj; // Já é string
  try {
    return Utilities.formatDate(new Date(dateObj), Session.getScriptTimeZone(), "yyyy-MM-dd");
  } catch (e) {
    return "";
  }
}