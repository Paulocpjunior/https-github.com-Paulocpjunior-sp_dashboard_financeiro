import { User } from '../types';
import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore';
import { signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { auth, db } from '../firebase';
import { logger } from '../utils/logger';
import { sanitizeFinancialPermissions } from '../utils/financialPermissions';

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

const sanitizeUser = (user: User): User => ({ ...user });

const normalizeLogin = (value: string): string => value.toLowerCase().trim();

const findUserDoc = async (login: string) => {
  const loginClean = normalizeLogin(login);

  const byUsername = query(collection(db, 'users'), where('username', '==', loginClean));
  const usernameSnapshot = await getDocs(byUsername);
  if (!usernameSnapshot.empty) return usernameSnapshot.docs[0];

  const byEmail = query(collection(db, 'users'), where('email', '==', loginClean));
  const emailSnapshot = await getDocs(byEmail);
  if (!emailSnapshot.empty) return emailSnapshot.docs[0];

  const byIdSnapshot = await getDoc(doc(db, 'users', loginClean));
  return byIdSnapshot.exists() ? byIdSnapshot : null;
};

const buildUserFromFirestore = (id: string, data: any): User => ({
  id,
  username: data.username || id,
  name: data.name || data.displayName || data.username || id,
  role: (data.role || 'operacional').toLowerCase().trim() as any,
  active: data.active !== false,
  email: data.email || '',
  financialPermissions: sanitizeFinancialPermissions(data.financialPermissions),
});

const loginViaFirebaseAuthEmail = async (email: string, password: string): Promise<LoginResult> => {
  try {
    const userCredential = await signInWithEmailAndPassword(auth, normalizeLogin(email), password);
    const docSnap = await getDoc(doc(db, 'users', userCredential.user.uid));

    if (!docSnap.exists()) {
      await signOut(auth).catch(() => {});
      return { success: false, message: 'Perfil de usuário não encontrado.' };
    }

    const data = docSnap.data();
    if (data.active === false) {
      await signOut(auth).catch(() => {});
      return { success: false, message: 'Usuário inativo.' };
    }

    return { success: true, user: buildUserFromFirestore(docSnap.id, data) };
  } catch {
    return { success: false, message: 'Senha incorreta.' };
  }
};

const loginViaUsernameIndex = async (username: string, password: string): Promise<LoginResult | null> => {
  try {
    const indexSnap = await getDoc(doc(db, 'loginIndex', normalizeLogin(username)));
    if (!indexSnap.exists()) return null;

    const data = indexSnap.data();
    const authEmail = data.authEmail || data.email;
    if (!authEmail) {
      return { success: false, message: 'Usuário sem credencial de login configurada.' };
    }

    return loginViaFirebaseAuthEmail(authEmail, password);
  } catch (error) {
    logger.error('[AuthService] Erro loginIndex:', error);
    return null;
  }
};

const loginViaFirestore = async (username: string, password: string): Promise<LoginResult> => {
  try {
    const usernameClean = normalizeLogin(username);
    const docSnap = await findUserDoc(usernameClean);
    if (!docSnap) {
      return { success: false, message: 'Usuário não encontrado.' };
    }

    const data = docSnap.data();

    if (data.active === false) {
      return { success: false, message: 'Usuário inativo.' };
    }

    const authEmail = data.authEmail || data.email;

    if (!authEmail) {
      return { success: false, message: 'Usuário sem credencial Firebase Auth configurada. Solicite ao administrador a recriação do acesso.' };
    }

    return loginViaFirebaseAuthEmail(authEmail, password);
  } catch (error) {
    logger.error('[AuthService] Erro Firestore:', error);
    return { success: false, message: 'Erro ao conectar com o banco de dados.' };
  }
};

export const AuthService = {
  login: async (username: string, password: string): Promise<LoginResult> => {
    const usernameClean = normalizeLogin(username);

    if (usernameClean.includes('@')) {
      const authResult = await loginViaFirebaseAuthEmail(usernameClean, password);
      if (authResult.success && authResult.user) {
        const safeUser = sanitizeUser(authResult.user);
        localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify({ user: safeUser, isAuthenticated: true }));
        return { success: true, user: safeUser };
      }
      return authResult;
    }

    const indexedResult = await loginViaUsernameIndex(usernameClean, password);
    if (indexedResult) {
      if (indexedResult.success && indexedResult.user) {
        const safeUser = sanitizeUser(indexedResult.user);
        localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify({ user: safeUser, isAuthenticated: true }));
        return { success: true, user: safeUser };
      }
      return indexedResult;
    }

    const fsResult = await loginViaFirestore(usernameClean, password);
    if (fsResult.success && fsResult.user) {
      const safeUser = sanitizeUser(fsResult.user);
      localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify({ user: safeUser, isAuthenticated: true }));
      return { success: true, user: safeUser };
    }

    return { success: false, message: fsResult.message || 'Credenciais inválidas.' };
  },

  logout: (): void => {
    try {
      localStorage.removeItem(AUTH_STORAGE_KEY);
      void signOut(auth).catch(() => {});
    } catch {}
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
      localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify({ user: sanitizeUser(user), isAuthenticated: true }));
    } catch {}
  },
};
