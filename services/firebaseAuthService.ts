import { 
  signInWithEmailAndPassword, 
  signOut, 
  onAuthStateChanged,
  User as FirebaseUser
} from 'firebase/auth';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { auth, db } from './firebaseConfig';
import { User } from '../types';

export const FirebaseAuthService = {
  /**
   * Realiza login com e-mail e senha.
   */
  signIn: async (email: string, password: string): Promise<User | null> => {
    try {
      const userCredential = await signInWithEmailAndPassword(auth, email, password);
      const firebaseUser = userCredential.user;
      return FirebaseAuthService.getUserProfile(firebaseUser.uid);
    } catch (error: any) {
      console.error("Erro no login Firebase:", error);
      throw new Error(error.message || "Falha na autenticação.");
    }
  },

  /**
   * Realiza logout.
   */
  signOut: async () => {
    return signOut(auth);
  },

  /**
   * Assina mudanças no estado de autenticação.
   */
  onAuthStateChanged: (callback: (user: User | null) => void) => {
    return onAuthStateChanged(auth, async (firebaseUser: FirebaseUser | null) => {
      if (firebaseUser) {
        const profile = await FirebaseAuthService.getUserProfile(firebaseUser.uid);
        callback(profile);
      } else {
        callback(null);
      }
    });
  },

  /**
   * Busca o perfil do usuário no Firestore.
   */
  getUserProfile: async (uid: string): Promise<User | null> => {
    try {
      const userDoc = await getDoc(doc(db, 'users', uid));
      if (userDoc.exists()) {
        return {
          id: uid,
          ...userDoc.data()
        } as User;
      }
      return null;
    } catch (error) {
      console.error("Erro ao buscar perfil do usuário:", error);
      return null;
    }
  },

  /**
   * Cria ou atualiza o perfil do usuário no Firestore.
   */
  updateUserProfile: async (uid: string, profile: Partial<User>) => {
    const userRef = doc(db, 'users', uid);
    return setDoc(userRef, profile, { merge: true });
  }
};
