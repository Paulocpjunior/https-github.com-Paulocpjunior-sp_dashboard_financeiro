import { User } from '../types';
import { BackendService } from './backendService';

const STORAGE_KEY = 'cashflow_session';

/**
 * Helper function to generate SHA-256 hash
 * Performs hashing on the client side to avoid sending plain text passwords
 */
async function sha256(message: string): Promise<string> {
  const msgBuffer = new TextEncoder().encode(message);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

export const AuthService = {
  login: async (username: string, password: string): Promise<{ success: boolean; message: string; user?: User }> => {
    try {
      // Trim password to avoid accidental whitespace issues
      const cleanPassword = password.trim();
      
      // Hash password before sending to backend service
      const passwordHash = await sha256(cleanPassword);
      console.log(`AuthService: Password hashed. Prefix: ${passwordHash.substring(0, 6)}...`);
      
      const result = await BackendService.login(username, passwordHash);
      
      if (result.success && result.user) {
        const sessionUser = { ...result.user, lastAccess: new Date().toISOString() };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(sessionUser));
        return { success: true, message: 'Login realizado com sucesso', user: sessionUser };
      }

      return { success: false, message: result.message || 'Credenciais inválidas.' };
    } catch (error) {
      console.error("AuthService Login Error:", error);
      return { success: false, message: 'Erro de conexão ou criptografia.' };
    }
  },

  logout: () => {
    localStorage.removeItem(STORAGE_KEY);
  },

  isAuthenticated: (): boolean => {
    return !!localStorage.getItem(STORAGE_KEY);
  },

  getCurrentUser: (): User | null => {
    const data = localStorage.getItem(STORAGE_KEY);
    return data ? JSON.parse(data) : null;
  }
};