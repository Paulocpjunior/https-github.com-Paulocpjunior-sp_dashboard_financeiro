import { Transaction, User } from '../types';
import { MOCK_USERS } from '../constants';
import { FirebaseService } from './firebaseService';
import { PendingUserRecord, UserAdminService, UserFormData } from './userAdminService';
import { logger } from '../utils/logger';

interface MutationResult {
  success: boolean;
  message: string;
}

const validateRegistration = (data: UserFormData): MutationResult | null => {
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

  const existingMockUser = MOCK_USERS.find(u => u.username.toLowerCase() === data.username.toLowerCase());
  if (existingMockUser) {
    return { success: false, message: 'Este nome de usuário já está em uso.' };
  }

  return null;
};

export const BackendService = {
  isProduction: (): boolean => true,

  getDataSource: (): 'firebase' => 'firebase',

  toggleUserStatus: async (username: string, newStatus: boolean): Promise<MutationResult> => {
    return UserAdminService.toggleUserStatus(username, newStatus);
  },

  adminChangePassword: async (username: string, newPassword: string): Promise<MutationResult> => {
    return UserAdminService.changePassword(username, newPassword);
  },

  registerUser: async (data: UserFormData): Promise<MutationResult> => {
    try {
      const validationError = validateRegistration(data);
      if (validationError) return validationError;

      return UserAdminService.createPendingUser(data);
    } catch (error: any) {
      logger.error('[BackendService] Erro no registro Firebase:', error);
      return { success: false, message: error.message || 'Erro ao processar cadastro.' };
    }
  },

  fetchPendingUsers: async (): Promise<PendingUserRecord[]> => UserAdminService.fetchPendingUsers(),

  approvePendingUser: async (_email: string, _name: string, username: string): Promise<MutationResult> => {
    return UserAdminService.approvePendingUser(username);
  },

  rejectPendingUser: async (_email: string, _name: string, username: string, reason?: string): Promise<MutationResult> => {
    return UserAdminService.rejectPendingUser(username, reason);
  },

  resendConfirmationEmail: async (): Promise<MutationResult> => {
    return {
      success: false,
      message: 'Envio automático de confirmação não está ativo. Aprove ou rejeite o usuário pelo painel Admin.',
    };
  },

  requestPasswordReset: async (username: string): Promise<MutationResult> => {
    if (!username.trim()) {
      return { success: false, message: 'Informe o nome de usuário.' };
    }

    return UserAdminService.requestPasswordReset(username);
  },

  fetchTransactions: async (): Promise<Transaction[]> => FirebaseService.fetchTransactions(),

  fetchUsers: async (): Promise<User[]> => {
    try {
      return await UserAdminService.fetchAllUsers();
    } catch (error) {
      logger.error('[BackendService] Erro ao buscar usuários no Firestore:', error);
      return [];
    }
  },

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
