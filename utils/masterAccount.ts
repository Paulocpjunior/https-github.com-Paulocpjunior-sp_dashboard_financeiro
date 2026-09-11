// Conta proprietária verificada no Firebase Auth/Firestore.
export const MASTER_USER_ID = 'hpdsWehGGAYE3uKCar4pBiRVxFJ3';
export const isMasterAccount = (user: { id: string; role: string; active: boolean } | null) =>
  user?.id === MASTER_USER_ID && user.role === 'admin' && user.active === true;
