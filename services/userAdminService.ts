import { deleteApp, initializeApp } from 'firebase/app';
import { collection, doc, getDoc, getDocs, getFirestore, query, setDoc, updateDoc, where } from 'firebase/firestore';
import { createUserWithEmailAndPassword, deleteUser, getAuth, signOut, updateProfile } from 'firebase/auth';
import { sendPasswordResetEmail } from 'firebase/auth';
import { db, firebaseConfig } from './firebaseConfig';
import { User, UserRole } from '../types';
import { AuthService } from './authService';
import { logger } from '../utils/logger';

export interface UserFormData {
  name: string;
  email: string;
  phone?: string;
  username: string;
  password: string;
  role?: string;
}

export interface PendingUserRecord {
  id: string;
  rowIndex: number;
  timestamp: string;
  name: string;
  email: string;
  phone: string;
  username: string;
  status: string;
  role: string;
}

interface MutationResult {
  success: boolean;
  message: string;
}

const normalizeUsername = (username: string) => username.toLowerCase().trim().replace(/\s/g, '');
const TECHNICAL_AUTH_EMAIL_DOMAIN = '@auth.spcontabil.local';

const normalizeRole = (role?: string): UserRole => {
  const normalized = (role || 'operacional').toLowerCase().trim();
  return normalized === 'admin' ? 'admin' : 'operacional';
};

const getCurrentUser = () => AuthService.getCurrentUser();

const isCurrentUserAdmin = (): boolean => {
  const currentUser = getCurrentUser();
  return AuthService.isAuthenticated() && (currentUser?.role || '').toLowerCase().trim() === 'admin';
};

const adminRequiredResult = (): MutationResult => ({
  success: false,
  message: 'Ação permitida apenas para administradores.',
});

const createAuthAccount = async (email: string, password: string, displayName: string) => {
  const secondaryApp = initializeApp(firebaseConfig, `user-provisioning-${Date.now()}-${Math.random()}`);
  const secondaryAuth = getAuth(secondaryApp);

  try {
    const credential = await createUserWithEmailAndPassword(secondaryAuth, email, password);
    if (displayName.trim()) {
      await updateProfile(credential.user, { displayName: displayName.trim() });
    }

    return {
      uid: credential.user.uid,
      authEmail: credential.user.email || email,
      secondaryApp,
      secondaryAuth,
      user: credential.user,
    };
  } catch (error: any) {
    await deleteApp(secondaryApp).catch(() => {});
    throw error;
  }
};

const authErrorMessage = (error: any): string => {
  if (error?.code === 'auth/email-already-in-use') return 'Este e-mail já possui uma conta no Firebase Auth.';
  if (error?.code === 'auth/weak-password') return 'A senha deve ter no mínimo 6 caracteres.';
  if (error?.code === 'auth/invalid-email') return 'E-mail inválido.';
  return error?.message || 'Erro ao criar conta no Firebase Auth.';
};

const sanitizeUser = (id: string, data: any): User => ({
  id,
  username: String(data.username || id),
  name: String(data.name || ''),
  role: normalizeRole(data.role),
  active: Boolean(data.active),
  email: data.email || '',
  lastAccess: data.lastAccess,
  authUid: data.authUid,
  authEmail: data.authEmail,
  authProvider: data.authProvider,
  financialPermissions: Array.isArray(data.financialPermissions)
    ? data.financialPermissions.filter((permission: unknown) => permission === 'wix.treasury.open')
    : [],
});

const findUserDocByUsername = async (username: string) => {
  const usernameClean = normalizeUsername(username);
  const q = query(collection(db, 'users'), where('username', '==', usernameClean));
  const snapshot = await getDocs(q);
  return snapshot.empty ? null : snapshot.docs[0];
};

const findResetTarget = async (identifier: string) => {
  const cleaned = identifier.toLowerCase().trim();
  if (!cleaned) return null;

  if (cleaned.includes('@')) {
    return { authEmail: cleaned };
  }

  const loginIndexSnap = await getDoc(doc(db, 'loginIndex', normalizeUsername(cleaned)));
  if (loginIndexSnap.exists()) {
    return loginIndexSnap.data();
  }

  const userDoc = await findUserDocByUsername(cleaned);
  return userDoc ? userDoc.data() : null;
};

const sendResetForAuthEmail = async (authEmail: string): Promise<MutationResult> => {
  const email = authEmail.toLowerCase().trim();
  if (!email) {
    return { success: false, message: 'Usuário sem e-mail de autenticação configurado.' };
  }

  if (email.endsWith(TECHNICAL_AUTH_EMAIL_DOMAIN)) {
    return {
      success: false,
      message: 'Este usuário não possui e-mail real para recuperação automática. Solicite ajuste pelo administrador.',
    };
  }

  await sendPasswordResetEmail(getAuth(), email);
  return { success: true, message: 'Enviamos um link de recuperação para o e-mail cadastrado.' };
};

export const UserAdminService = {
  fetchAllUsers: async (): Promise<User[]> => {
    if (!isCurrentUserAdmin()) return [];

    const snapshot = await getDocs(collection(db, 'users'));
    return snapshot.docs
      .filter((docSnap) => {
        const status = String(docSnap.data().status || '').toLowerCase().trim();
        return status !== 'pending' && status !== 'pendente' && status !== 'aguardando' && status !== 'rejected';
      })
      .map((docSnap) => sanitizeUser(docSnap.id, docSnap.data()))
      .sort((a, b) => a.username.localeCompare(b.username, 'pt-BR'));
  },

  fetchPendingUsers: async (): Promise<PendingUserRecord[]> => {
    if (!isCurrentUserAdmin()) return [];

    const q = query(collection(db, 'users'), where('active', '==', false));
    const snapshot = await getDocs(q);

    return snapshot.docs
      .map((docSnap) => {
        const data = docSnap.data();
        return {
          id: docSnap.id,
          rowIndex: Number(data.rowIndex || 0),
          timestamp: String(data.timestamp || data.createdAt || ''),
          name: String(data.name || ''),
          email: String(data.email || ''),
          phone: String(data.phone || ''),
          username: String(data.username || docSnap.id),
          status: String(data.status || 'pending'),
          role: String(data.role || 'operacional'),
        };
      })
      .filter((user) => {
        const status = user.status.toLowerCase().trim();
        return !status || status === 'pending' || status === 'pendente' || status === 'aguardando';
      })
      .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  },

  createPendingUser: async (data: UserFormData): Promise<MutationResult> => {
    const username = normalizeUsername(data.username);
    const email = data.email.trim().toLowerCase();
    const now = new Date().toISOString();
    const isAdminCreation = isCurrentUserAdmin();

    const existingUsername = await findUserDocByUsername(username);
    if (existingUsername) {
      return { success: false, message: 'Este nome de usuário já está em uso.' };
    }

    const emailQuery = query(collection(db, 'users'), where('email', '==', email));
    const existingEmail = await getDocs(emailQuery);
    if (!existingEmail.empty) {
      return { success: false, message: 'Este e-mail já está cadastrado.' };
    }

    let createdAuth: Awaited<ReturnType<typeof createAuthAccount>> | null = null;

    try {
      createdAuth = await createAuthAccount(email, data.password, data.name);
      const profileDb = isAdminCreation ? db : getFirestore(createdAuth.secondaryApp);
      const role = isAdminCreation ? normalizeRole(data.role) : 'operacional';

      await setDoc(doc(profileDb, 'users', createdAuth.uid), {
        username,
        name: data.name.trim(),
        email,
        phone: data.phone || '',
        role,
        active: false,
        status: 'pending',
        authUid: createdAuth.uid,
        authEmail: createdAuth.authEmail,
        authProvider: 'firebase',
        createdAt: now,
        createdVia: isAdminCreation ? 'admin' : 'self-registration',
      });

      if (isAdminCreation) {
        await setDoc(doc(db, 'loginIndex', username), {
          uid: createdAuth.uid,
          authEmail: createdAuth.authEmail,
          updatedAt: now,
        });
      }

      return { success: true, message: 'Cadastro criado no Firebase Auth e enviado para aprovação.' };
    } catch (error: any) {
      if (createdAuth?.user) {
        await deleteUser(createdAuth.user).catch(() => {});
      }
      return { success: false, message: authErrorMessage(error) };
    } finally {
      if (createdAuth) {
        await signOut(createdAuth.secondaryAuth).catch(() => {});
        await deleteApp(createdAuth.secondaryApp).catch(() => {});
      }
    }
  },

  toggleUserStatus: async (username: string, active: boolean): Promise<MutationResult> => {
    if (!isCurrentUserAdmin()) return adminRequiredResult();

    const currentUser = getCurrentUser();
    if (!active && normalizeUsername(currentUser?.username || '') === normalizeUsername(username)) {
      return { success: false, message: 'Você não pode bloquear o próprio usuário administrador.' };
    }

    const userDoc = await findUserDocByUsername(username);
    if (!userDoc) return { success: false, message: 'Usuário não encontrado.' };

    await updateDoc(userDoc.ref, {
      active,
      status: active ? 'approved' : 'blocked',
      updatedAt: new Date().toISOString(),
    });

    return { success: true, message: active ? 'Usuário desbloqueado com sucesso.' : 'Usuário bloqueado com sucesso.' };
  },

  changePassword: async (username: string, _newPassword: string): Promise<MutationResult> => {
    if (!isCurrentUserAdmin()) return adminRequiredResult();

    const userDoc = await findUserDocByUsername(username);
    if (!userDoc) return { success: false, message: 'Usuário não encontrado.' };
    const data = userDoc.data();

    if (data.authEmail || data.authUid) {
      return sendResetForAuthEmail(data.authEmail || data.email || '');
    }

    return { success: false, message: 'Usuário sem Firebase Auth vinculado. Recrie ou migre o acesso antes de alterar a senha.' };
  },

  requestPasswordReset: async (identifier: string): Promise<MutationResult> => {
    try {
      const resetTarget = await findResetTarget(identifier);
      if (!resetTarget) return { success: false, message: 'Usuário não encontrado.' };

      const authEmail = resetTarget.authEmail || resetTarget.email || '';
      return sendResetForAuthEmail(authEmail);
    } catch (error: any) {
      logger.error('[UserAdminService] Erro ao enviar recuperação de senha:', error);
      return { success: false, message: 'Não foi possível enviar a recuperação de senha.' };
    }
  },

  approvePendingUser: async (username: string): Promise<MutationResult> => {
    if (!isCurrentUserAdmin()) return adminRequiredResult();

    const userDoc = await findUserDocByUsername(username);
    if (!userDoc) return { success: false, message: 'Usuário não encontrado.' };
    const data = userDoc.data();
    const usernameClean = normalizeUsername(data.username || username);
    const authEmail = data.authEmail || data.email;

    if (!data.authUid || !authEmail) {
      return { success: false, message: 'Usuário sem conta Firebase Auth vinculada.' };
    }

    await setDoc(doc(db, 'loginIndex', usernameClean), {
      uid: data.authUid,
      authEmail,
      updatedAt: new Date().toISOString(),
    });

    await updateDoc(userDoc.ref, {
      active: true,
      status: 'approved',
      approvedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    return { success: true, message: 'Usuário aprovado com sucesso.' };
  },

  rejectPendingUser: async (username: string, reason?: string): Promise<MutationResult> => {
    if (!isCurrentUserAdmin()) return adminRequiredResult();

    const userDoc = await findUserDocByUsername(username);
    if (!userDoc) return { success: false, message: 'Usuário não encontrado.' };

    await updateDoc(userDoc.ref, {
      active: false,
      status: 'rejected',
      rejectionReason: reason || '',
      rejectedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    return { success: true, message: 'Usuário rejeitado.' };
  },
};
