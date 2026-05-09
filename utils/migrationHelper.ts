export const MigrationHelper = {
  migrateTransactions: async (onProgress: (progress: number, message: string) => void) => {
    onProgress(100, 'Migração já concluída. O Firebase é a fonte oficial de dados.');
  },
};
