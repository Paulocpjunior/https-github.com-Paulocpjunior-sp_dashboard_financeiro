import { auth, firebaseConfig } from './firebaseConfig';
import { readBillingReview } from './billingReviewReader';

export const BillingReviewService = {
  async fetch() {
    const user = auth.currentUser;
    if (!user) throw new Error('Entre novamente para consultar a conferência.');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 180000);
    const checkSession = () => { if (auth.currentUser !== user) throw new Error('A sessão mudou durante a leitura. Consulte novamente.'); };
    try {
      const token = await user.getIdToken();
      checkSession();
      return await readBillingReview({ projectId: firebaseConfig.projectId, token, checkSession, signal: controller.signal });
    } finally { clearTimeout(timeout); }
  },
};
