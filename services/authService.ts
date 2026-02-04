import { User } from '../types';

// URL do Apps Script
const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycby7FBRbU_z7Hs1nHo71_5Lqs4qnN4_863Sc9Zwa78Q91ERKNXgkzMftCs9ivdSpFN1img/exec';

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
  
  try {
    // Usar GET com parâmetros na URL (funciona sem CORS)
    const params = new URLSearchParams({
      action: 'loginGet',
      username: usernameClean,
      password: password,
    });
    
    const url = `${APPS_SCRIPT_URL}?${params.toString()}`;
    console.log('[AuthService] Fazendo login via GET...');
    
    const response = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
    });

    if (!response.ok) {
      throw new Error('Erro na resposta do servidor');
    }

    const result = await response.json();
    console.log('[AuthService] Resposta:', result);
    return result;
    
  } catch (error) {
    console.error('[AuthService] Erro no login:', error);
    return { success: false, message: 'Erro de conexão. Tente novamente.' };
  }
};

export const AuthService = {
  // Login
  login: async (username: string, password: string): Promise<LoginResult> => {
    console.log('[AuthService] Tentando login:', username);
    
    // Tentar login via API (planilha)
    const apiResult = await loginViaAPI(username, password);
    
    if (apiResult.success && apiResult.user) {
      // Salvar no localStorage
      const authState: AuthState = {
        user: apiResult.user,
        isAuthenticated: true,
      };
      localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(authState));
      
      console.log('[AuthService] Login bem sucedido:', apiResult.user.name);
      return { success: true, user: apiResult.user };
    }
    
    return { success: false, message: apiResult.message || 'Credenciais inválidas.' };
  },

  // Logout
  logout: (): void => {
    localStorage.removeItem(AUTH_STORAGE_KEY);
    console.log('[AuthService] Logout realizado');
  },

  // Verificar se está autenticado
  isAuthenticated: (): boolean => {
    const stored = localStorage.getItem(AUTH_STORAGE_KEY);
    if (!stored) return false;
    
    try {
      const authState: AuthState = JSON.parse(stored);
      return authState.isAuthenticated && authState.user !== null;
    } catch {
      return false;
    }
  },

  // Obter usuário atual
  getCurrentUser: (): User | null => {
    const stored = localStorage.getItem(AUTH_STORAGE_KEY);
    if (!stored) return null;
    
    try {
      const authState: AuthState = JSON.parse(stored);
      return authState.user;
    } catch {
      return null;
    }
  },

  // Atualizar dados do usuário no localStorage
  updateCurrentUser: (user: User): void => {
    const authState: AuthState = {
      user: user,
      isAuthenticated: true,
    };
    localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(authState));
  },
};