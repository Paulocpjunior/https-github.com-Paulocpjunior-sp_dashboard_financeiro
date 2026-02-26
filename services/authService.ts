
import { User } from '../types';
import { APPS_SCRIPT_URL, ALT_APPS_SCRIPT_URLS } from '../constants';

const AUTH_STORAGE_KEY = 'sp_contabil_auth';

interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
}

interface LoginResult {
  success: boolean;
  user?: User;
  message?: string;
}

// Função para fazer login via Apps Script usando GET (evita CORS)
const loginViaAPI = async (username: string, password: string): Promise<LoginResult> => {
  const usernameClean = username.toLowerCase().trim();
  const urlsToTry = [APPS_SCRIPT_URL, ...ALT_APPS_SCRIPT_URLS];
  
  let lastError = null;

  for (const baseUrl of urlsToTry) {
    try {
      const params = new URLSearchParams({
        action: 'loginGet',
        username: usernameClean,
        password: password,
      });
      
      const url = `${baseUrl}?${params.toString()}`;
      console.log(`[AuthService] Tentando login em: ${baseUrl.substring(0, 45)}...`);
      
      const response = await fetch(url, {
        method: 'GET',
        redirect: 'follow',
      });

      if (!response.ok) {
        console.warn(`[AuthService] Falha na URL ${baseUrl.substring(0, 30)}: Status ${response.status}`);
        continue;
      }

      const text = await response.text();
      try {
        const result = JSON.parse(text);
        if (result && (result.success || result.user)) {
          console.log('[AuthService] Login bem sucedido na URL:', baseUrl.substring(0, 45));
          return result;
        }
        // Se retornou success: false, mas é um JSON válido, respeitamos o erro do servidor
        if (result && result.success === false) {
           console.warn('[AuthService] Servidor negou login:', result.message);
           return result;
        }
      } catch (e) {
        console.warn(`[AuthService] Resposta não é JSON na URL ${baseUrl.substring(0, 30)}`);
        continue;
      }
      
    } catch (error) {
      console.error(`[AuthService] Erro na URL ${baseUrl.substring(0, 30)}:`, error);
      lastError = error;
    }
  }
  
  return { success: false, message: 'Erro de conexão com todos os servidores de autenticação. Verifique sua internet.' };
};

export const AuthService = {
  // Login
  login: async (username: string, password: string): Promise<LoginResult> => {
    console.log('[AuthService] Tentando login:', username);
    
    // Tentar login via API (planilha)
    const apiResult = await loginViaAPI(username, password);
    
    if (apiResult.success && apiResult.user) {
      // NORMALIZAÇÃO DE DADOS DO USUÁRIO
      // Garante que o role seja sempre minúsculo e sem espaços ('Admin ' -> 'admin')
      // Isso corrige problemas de permissão se a planilha tiver formatação diferente
      const normalizedUser: User = {
        ...apiResult.user,
        role: (apiResult.user.role || 'operacional').toLowerCase().trim() as any
      };

      // Salvar no localStorage
      const authState: AuthState = {
        user: normalizedUser,
        isAuthenticated: true,
      };
      localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(authState));
      
      console.log('[AuthService] Login bem sucedido:', normalizedUser.name, 'Role:', normalizedUser.role);
      return { success: true, user: normalizedUser };
    }
    
    return { success: false, message: apiResult.message || 'Credenciais inválidas.' };
  },

  // Logout
  logout: (): void => {
    try {
      localStorage.removeItem(AUTH_STORAGE_KEY);
      console.log('[AuthService] Logout realizado');
    } catch (e) {
      console.error('[AuthService] Erro ao remover do localStorage:', e);
    }
  },

  // Verificar se está autenticado
  isAuthenticated: (): boolean => {
    try {
      const stored = localStorage.getItem(AUTH_STORAGE_KEY);
      if (!stored) return false;
      
      const authState: AuthState = JSON.parse(stored);
      return authState.isAuthenticated && authState.user !== null;
    } catch (e) {
      console.error('[AuthService] Erro ao acessar localStorage:', e);
      return false;
    }
  },

  // Obter usuário atual
  getCurrentUser: (): User | null => {
    try {
      const stored = localStorage.getItem(AUTH_STORAGE_KEY);
      if (!stored) return null;
      
      const authState: AuthState = JSON.parse(stored);
      return authState.user;
    } catch (e) {
      console.error('[AuthService] Erro ao obter usuário do localStorage:', e);
      return null;
    }
  },

  // Atualizar dados do usuário no localStorage
  updateCurrentUser: (user: User): void => {
    try {
      const authState: AuthState = {
        user: user,
        isAuthenticated: true,
      };
      localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(authState));
    } catch (e) {
      console.error('[AuthService] Erro ao salvar no localStorage:', e);
    }
  },
};
