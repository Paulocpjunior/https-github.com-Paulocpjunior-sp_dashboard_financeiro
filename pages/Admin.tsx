import React, { useEffect, useState } from 'react';
import Layout from '../components/Layout';
import { User, Shield, CheckCircle, XCircle, Loader2, Database, Save, RotateCcw, AlertTriangle } from 'lucide-react';
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
    if (!spreadsheetId.trim()) {
        setDbMessage({ type: 'error', text: 'O ID da planilha não pode estar vazio.' });
        return;
    }

    setIsSavingDb(true);
    setDbMessage(null);
    
    try {
        // 1. Salva no LocalStorage (Extraindo ID e GID se for URL completa)
        BackendService.updateSpreadsheetId(spreadsheetId);
        
        // 1.1 Atualiza o campo de input visualmente para o ID limpo
        setSpreadsheetId(BackendService.getSpreadsheetId());
        
        // 2. Força uma recarga dos dados para testar se o ID é válido e acessível
        await DataService.refreshCache();
        
        setDbMessage({ type: 'success', text: 'Conexão estabelecida e salva com sucesso!' });
    } catch (error: any) {
        setDbMessage({ type: 'error', text: 'ID salvo, mas a conexão falhou: ' + (error.message || 'Verifique as permissões da planilha.') });
    } finally {
        setIsSavingDb(false);
    }
  };

  const handleRestoreDefault = () => {
      if (confirm('Tem certeza? Isso irá restaurar o ID original da planilha de demonstração.')) {
          BackendService.resetSpreadsheetId();
          setSpreadsheetId(BackendService.getSpreadsheetId());
          setDbMessage({ type: 'success', text: 'Configuração restaurada para o padrão.' });
          // Recarrega dados do padrão
          DataService.refreshCache().catch(() => {});
      }
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
            <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                    <div className="p-2 bg-blue-50 dark:bg-blue-900/20 rounded-lg text-blue-600 dark:text-blue-400">
                        <Database className="h-5 w-5" />
                    </div>
                    <div>
                        <h2 className="text-lg font-bold text-slate-800 dark:text-white">Fonte de Dados</h2>
                        <p className="text-xs text-slate-500 dark:text-slate-400">Conexão com Google Sheets</p>
                    </div>
                </div>
            </div>
            
            <div className="bg-slate-50 dark:bg-slate-800/50 p-4 rounded-lg border border-slate-200 dark:border-slate-700 mb-6">
                <p className="text-sm text-slate-600 dark:text-slate-300 flex gap-2 items-start">
                    <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
                    <span>
                        Configure o <strong>Spreadsheet ID</strong> da planilha pública que alimenta o dashboard. 
                        A planilha deve ter o compartilhamento definido como <em>"Qualquer pessoa com o link pode ver"</em>.
                    </span>
                </p>
            </div>

            <div className="flex flex-col gap-4">
                <div>
                    <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1 uppercase tracking-wider">Spreadsheet ID / Link Completo</label>
                    <div className="flex flex-col sm:flex-row gap-2">
                        <input 
                            type="text" 
                            value={spreadsheetId}
                            onChange={(e) => setSpreadsheetId(e.target.value)}
                            className="flex-1 form-input rounded-lg border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-white text-sm focus:ring-blue-500 focus:border-blue-500 font-mono"
                            placeholder="Cole o link completo ou o ID da planilha..."
                        />
                        <button 
                            onClick={handleSaveDatabaseId}
                            disabled={isSavingDb}
                            className="px-4 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 text-sm font-medium flex items-center justify-center gap-2 shadow-sm min-w-[140px]"
                        >
                            {isSavingDb ? (
                                <>
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                    <span>Testando...</span>
                                </>
                            ) : (
                                <>
                                    <Save className="h-4 w-4" />
                                    <span>Salvar ID</span>
                                </>
                            )}
                        </button>
                        <button 
                            onClick={handleRestoreDefault}
                            title="Restaurar ID Padrão"
                            className="px-3 py-2.5 bg-white dark:bg-slate-800 text-slate-500 dark:text-slate-400 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors border border-slate-200 dark:border-slate-600"
                        >
                            <RotateCcw className="h-4 w-4" />
                        </button>
                    </div>
                </div>
            </div>

            {dbMessage && (
                <div className={`mt-4 p-3 rounded-lg text-sm flex items-center gap-2 animate-in fade-in slide-in-from-top-1 ${
                    dbMessage.type === 'success' ? 'bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-300 border border-green-200 dark:border-green-800' : 'bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-300 border border-red-200 dark:border-red-800'
                }`}>
                    {dbMessage.type === 'success' ? <CheckCircle className="h-4 w-4 shrink-0" /> : <XCircle className="h-4 w-4 shrink-0" />}
                    <span className="font-medium">{dbMessage.text}</span>
                </div>
            )}
        </div>

        {/* User Management Table */}
        <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-slate-200 dark:border-slate-800 overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex justify-between items-center">
             <h3 className="font-bold text-slate-800 dark:text-white">Usuários do Sistema</h3>
             <span className="text-xs px-2 py-1 bg-slate-100 dark:bg-slate-800 text-slate-500 rounded">Total: {users.length}</span>
          </div>
          
          {loading ? (
             <div className="p-10 flex justify-center">
                <Loader2 className="h-8 w-8 text-royal-600 animate-spin" />
             </div>
          ) : (
            <div className="overflow-x-auto">
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
                    <tr key={user.id} className="hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors">
                        <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center">
                            <div className="flex-shrink-0 h-8 w-8 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-500 border border-slate-200 dark:border-slate-700">
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
                        <button className="text-royal-600 dark:text-royal-400 hover:text-royal-900 dark:hover:text-royal-200 mr-4 transition-colors">Editar</button>
                        <button className="text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 transition-colors">Resetar Senha</button>
                        </td>
                    </tr>
                    ))}
                </tbody>
                </table>
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
};

export default Admin;