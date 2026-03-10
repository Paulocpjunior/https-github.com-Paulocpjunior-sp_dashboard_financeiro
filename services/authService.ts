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

// Hash SHA-256
const hashPassword = async (password: string): Promise<string> => {
  const msgBuffer = new TextEncoder().encode(password);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
};

// Login via Apps Script
const loginViaAPI = async (username: string, password: string): Promise<LoginResult> => {
  const usernameClean = username.toLowerCase().trim();
  const urlsToTry = [APPS_SCRIPT_URL, ...ALT_APPS_SCRIPT_URLS];

  for (const baseUrl of urlsToTry) {
    try {
      const params = new URLSearchParams({ action: 'loginGet', username: usernameClean, password });
      const response = await fetch(`${baseUrl}?${params.toString()}`, { method: 'GET', redirect: 'follow' });
      if (!response.ok) continue;
      const text = await response.text();
      try {
        const result = JSON.parse(text);
        if (result?.success && result?.user) return result;
        if (result?.success === false) return result;
      } catch { continue; }
    } catch { continue; }
  }
  return { success: false, message: 'API indisponível' };
};

// ✅ Login via Firestore (fallback)
const loginViaFirestore = async (username: string, password: string): Promise<LoginResult> => {
  try {
    const { collection, getDocs, query, where } = await import('firebase/firestore');
    const { db } = await import('../firebase');

    const usernameClean = username.toLowerCase().trim();
    const passwordHash = await hashPassword(password);

    const q = query(collection(db, 'users'), where('username', '==', usernameClean));
    const snapshot = await getDocs(q);

    if (snapshot.empty) {
      return { success: false, message: 'Usuário não encontrado.' };
    }

    const docSnap = snapshot.docs[0];
    const data = docSnap.data();

    if (!data.active) {
      return { success: false, message: 'Usuário inativo.' };
    }

    // Verificar senha por hash ou senha direta (para compatibilidade)
    const storedHash = data.passwordHash || '';
    const validHash = storedHash === passwordHash;
    // Fallback: senha em texto puro (caso não tenha hash)
    const validPlain = data.password === password;

    if (!validHash && !validPlain) {
      return { success: false, message: 'Senha incorreta.' };
    }

    const user: User = {
      id: docSnap.id,
      username: data.username,
      name: data.name,
      role: (data.role || 'operacional').toLowerCase().trim() as any,
      active: data.active,
      email: data.email || '',
      passwordHash: storedHash,
    };

    return { success: true, user };
  } catch (error) {
    console.error('[AuthService] Erro no login Firestore:', error);
    return { success: false, message: 'Erro ao conectar com o banco de dados.' };
  }
};

export const AuthService = {
  login: async (username: string, password: string): Promise<LoginResult> => {
    console.log('[AuthService] Tentando login:', username);

    // 1. Tentar Apps Script
    const apiResult = await loginViaAPI(username, password);
    if (apiResult.success && apiResult.user) {
      const normalizedUser: User = {
        ...apiResult.user,
        role: (apiResult.user.role || 'operacional').toLowerCase().trim() as any,
      };
      localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify({ user: normalizedUser, isAuthenticated: true }));
      return { success: true, user: normalizedUser };
    }

    // 2. Fallback: Firestore
    console.log('[AuthService] Apps Script falhou, tentando Firestore...');
    const fsResult = await loginViaFirestore(username, password);
    if (fsResult.success && fsResult.user) {
      localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify({ user: fsResult.user, isAuthenticated: true }));
      console.log('[AuthService] Login via Firestore OK:', fsResult.user.name);
      return { success: true, user: fsResult.user };
    }

    return { success: false, message: fsResult.message || apiResult.message || 'Credenciais inválidas.' };
  },

  logout: (): void => {
    try { localStorage.removeItem(AUTH_STORAGE_KEY); } catch {}
  },

  isAuthenticated: (): boolean => {
    try {
      const stored = localStorage.getItem(AUTH_STORAGE_KEY);
      if (!stored) return false;
      const authState: AuthState = JSON.parse(stored);
      return authState.isAuthenticated && authState.user !== null;
    } catch { return false; }
  },

  getCurrentUser: (): User | null => {
    try {
      const stored = localStorage.getItem(AUTH_STORAGE_KEY);
      if (!stored) return null;
      const authState: AuthState = JSON.parse(stored);
      return authState.user;
    } catch { return null; }
  },

  updateCurrentUser: (user: User): void => {
    try {
      localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify({ user, isAuthenticated: true }));
    } catch {}
  },
};
