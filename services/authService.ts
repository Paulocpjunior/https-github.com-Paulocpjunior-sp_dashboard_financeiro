import { User } from '../types';

// URL do Apps Script
const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbwYbEYkx0hGgXGx1B6_2yFJ1qbnA8KH2prmV_0cohnMn_5wcyrA3fImFnxN1jhyIImYyg/exec';

const AUTH_STORAGE_KEY = 'sp_contabil_auth';

interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
}

// Função para fazer login via Apps Script
const loginViaAPI = async (username: string, password: string): Promise<{ success: boolean; user?: User; message?: string }> => {
  try {
    // Tentar com fetch normal
    const response = await fetch(APPS_SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'login',
        username: username.toLowerCase().trim(),
        password: password,
      }),
      redirect: 'follow',
    });

    const result = await response.json();
    return result;
  } catch (error) {
    console.log('Erro no fetch, tentando alternativa...');
    
    // Se der erro de CORS, tentar via GET com parâmetros
    try {
      const params = new URLSearchParams({
        action: 'login',
        username: username.toLowerCase().trim(),
        password: password,
      });
      
      const response = await fetch(`${APPS_SCRIPT_URL}?${params.toString()}`);
      const result = await response.json();
      return result;
    } catch (fallbackError) {
      console.error('Erro no login:', fallbackError);
      return { success: false, message: 'Erro de conexão. Tente novamente.' };
    }
  }
};

export const AuthService = {
  // Login
  login: async (username: string, password: string): Promise<{ success: boolean; user?: User; message?: string }> => {
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