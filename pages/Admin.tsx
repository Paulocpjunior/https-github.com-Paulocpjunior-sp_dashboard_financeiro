import React, { useEffect, useState } from 'react';
import Layout from '../components/Layout';
import { User, Shield, CheckCircle, XCircle, Loader2 } from 'lucide-react';
import { BackendService } from '../services/backendService';
import { User as UserType } from '../types';

const Admin: React.FC = () => {
  const [users, setUsers] = useState<UserType[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadUsers = async () => {
      try {
        const data = await BackendService.fetchUsers();
        setUsers(data);
      } catch (error) {
        console.error("Failed to load users", error);
      } finally {
        setLoading(false);
      }
    };
    loadUsers();
  }, []);

  return (
    <Layout>
      <div className="space-y-6">
        {/* Customized Header with Royal Blue background */}
        <div className="bg-royal-800 dark:bg-slate-800 p-6 rounded-xl shadow-md border border-royal-700 dark:border-slate-700">
          <div className="flex items-center gap-3">
             <div className="p-2 bg-white/10 rounded-lg">
                <Shield className="h-6 w-6 text-white" />
             </div>
             <div>
                <h1 className="text-2xl font-bold text-white">Gerenciamento de Usuários</h1>
                <p className="text-royal-100/80 dark:text-slate-400 text-sm mt-1">Administre o acesso e permissões do sistema SP Contábil.</p>
             </div>
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-slate-200 dark:border-slate-800 overflow-hidden">
          {loading ? (
             <div className="p-10 flex justify-center">
                <Loader2 className="h-8 w-8 text-royal-600 animate-spin" />
             </div>
          ) : (
            <table className="min-w-full divide-y divide-slate-200 dark:divide-slate-800">
              <thead className="bg-slate-50 dark:bg-slate-800">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">Usuário</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">Nome</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">Perfil</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">Status</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">Ações</th>
                </tr>
              </thead>
              <tbody className="bg-white dark:bg-slate-900 divide-y divide-slate-200 dark:divide-slate-800">
                {users.map((user) => (
                  <tr key={user.id} className="hover:bg-slate-50 dark:hover:bg-slate-800">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center">
                        <div className="flex-shrink-0 h-8 w-8 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-500">
                          <User className="h-4 w-4" />
                        </div>
                        <div className="ml-4">
                          <div className="text-sm font-medium text-slate-900 dark:text-slate-100">{user.username}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-600 dark:text-slate-300">
                      {user.name}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                        user.role === 'admin' 
                            ? 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300' 
                            : 'bg-royal-100 text-royal-800 dark:bg-blue-900/30 dark:text-blue-300'
                      }`}>
                        {user.role === 'admin' && <Shield className="w-3 h-3 mr-1" />}
                        {user.role}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                        user.active 
                            ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300' 
                            : 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300'
                      }`}>
                        {user.active ? (
                          <>
                            <CheckCircle className="w-3 h-3 mr-1" /> Ativo
                          </>
                        ) : (
                          <>
                            <XCircle className="w-3 h-3 mr-1" /> Inativo
                          </>
                        )}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                      <button className="text-royal-600 dark:text-royal-400 hover:text-royal-900 dark:hover:text-royal-200 mr-4">Editar</button>
                      <button className="text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200">Resetar Senha</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        
        <div className="bg-yellow-50 dark:bg-yellow-900/10 border border-yellow-200 dark:border-yellow-900/30 rounded-lg p-4">
            <p className="text-sm text-yellow-800 dark:text-yellow-400">
                <strong>Nota:</strong> Certifique-se de que os dados estão vindo do Google Sheets. O BackendService fará a conexão automaticamente se o ambiente for "Google Apps Script".
            </p>
        </div>
      </div>
    </Layout>
  );
};

export default Admin;