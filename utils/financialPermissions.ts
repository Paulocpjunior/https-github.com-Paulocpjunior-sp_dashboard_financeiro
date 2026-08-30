import { User } from '../types';

export const canOpenWixTreasury = (user: User | null): boolean => {
  if (!user || user.active === false) return false;
  if ((user.role || '').toLowerCase().trim() === 'admin') return true;
  return user.financialPermissions?.includes('wix.treasury.open') === true;
};
