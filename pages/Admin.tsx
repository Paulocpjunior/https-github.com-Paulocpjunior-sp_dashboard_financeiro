import React, { useEffect, useState } from 'react';
import Layout from '../components/Layout';
import { User, Shield, CheckCircle, XCircle, Loader2, Database, Save, RotateCcw } from 'lucide-react';
import { BackendService } from '../services/backendService';
import { DataService } from '../services/dataService';
import { User as UserType } from '../types';

const Admin: React.FC = () => {
  const [users, setUsers] = useState<UserType[]>([]);
  const [loading, setLoading] = useState(true);
  
  // Database Config State
  const [spreadsheetId, setSpreadsheetId] = useState('');
  const [isSavingDb, setIsSavingDb] = useState(false);
  const [dbMessage, setDbMessage] = useState<{type: 'success' | 'error', text: string} | null>(null);

  useEffect(() => {
    const loadData = async () => {
      try {
        const userData = await BackendService.fetchUsers();
        setUsers(userData);
        
        // Load current Spreadsheet ID
        setSpreadsheetId(BackendService.getSpreadsheetId());
      } catch (error) {
        console.error("Failed to load data", error);
      } finally {
        setLoading(false);
      }
    };
    loadData();
  }, []);

  const handleSaveDatabaseId = async () => {
    setIsSavingDb(true);
    setDbMessage(null);
    try {
        BackendService.updateSpreadsheetId(spreadsheetId);
        
        // Force refresh of data cache to test connection
        await DataService.refreshCache();
        
        setDbMessage({ type: 'success', text: 'Banco de dados atualizado e conexão verificada com sucesso!' });
    } catch (error: any) {
        setDbMessage({ type: 'error', text: 'ID salvo, mas falha ao conectar: ' + error.message });
    } finally {
        setIsSavingDb(false);
    }
  };

  const handleRestoreDefault = () => {
      BackendService.resetSpreadsheetId();
      setSpreadsheetId(BackendService.getSpreadsheetId());
      setDbMessage({ type: 'success', text: 'Configuração restaurada para o padrão.' });
  };

  return (
    <Layout>
      <div className="space-y-6">
        {/* Customized Header */}
        <div className="bg-royal-800 dark:bg-slate-800 p-6 rounded-xl shadow-md border border-royal-700 dark:border-slate-700">
          <div className="flex items-center gap-3">
             <div className="p-2 bg-white/10 rounded-lg">
                <Shield className="h-6 w-6 text-white" />
             </div>
             <div>
                <h1 className="text-2xl font-bold text-white">Administração do Sistema</h1>
                <p className="text-royal-100/80 dark:text-slate-400 text-sm mt-1">Gerencie usuários e conexões de dados.</p>
             </div>
          </div>
        </div>

        {/* Database Configuration Card */}
        <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-slate-200 dark:border-slate-800 p-6 animate-in slide-in-from-bottom-2">
            <div className="flex items-center gap-2 mb-4">
                <Database className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                <h2 className="text-lg font-bold text-slate-800 dark:text-white">Fonte de Dados (Google Sheets)</h2>
            </div>
            
            <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">
                Configure o ID da planilha pública do Google Sheets que alimenta o sistema. 
                Certifique-se de que a planilha está compartilhada como "Qualquer pessoa com o link".
            </p>

            <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center">
                <div className="flex-1 w-full">
                    <label className="block text-xs font-semibold text-slate-500 mb-1">Spreadsheet ID</label>
                    <input 
                        type="text" 
                        value={spreadsheetId}
                        onChange={(e) => setSpreadsheetId(e.target.value)}
                        className="w-full form-input rounded-lg border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white text-sm focus:ring-blue-500 focus:border-blue-500"
                        placeholder="Ex: 1jwBTCHiQ-YqtPkyQuPaAEzu..."
                    />
                </div>
                <div className="flex gap-2 w-full sm:w-auto mt-5">
                    <button 
                        onClick={handleSaveDatabaseId}
                        disabled={isSavingDb}
                        className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 text-sm font-medium"
                    >
                        {isSavingDb ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                        Salvar e Conectar
                    </button>
                    <button 
                        onClick={handleRestoreDefault}
                        title="Restaurar Padrão"
                        className="px-3 py-2 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors border border-slate-200 dark:border-slate-700"
                    >
                        <RotateCcw className="h-4 w-4" />
                    </button>
                </div>
            </div>

            {dbMessage && (
                <div className={`mt-4 p-3 rounded-lg text-sm flex items-center gap-2 ${
                    dbMessage.type === 'success' ? 'bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-300' : 'bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-300'
                }`}>
                    {dbMessage.type === 'success' ? <CheckCircle className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
                    {dbMessage.text}
                </div>
            )}
        </div>

        {/* User Management Table */}
        <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-slate-200 dark:border-slate-800 overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800">
             <h3 className="font-bold text-slate-800 dark:text-white">Usuários do Sistema</h3>
          </div>
          
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
      </div>
    </Layout>
  );
};

export default Admin;