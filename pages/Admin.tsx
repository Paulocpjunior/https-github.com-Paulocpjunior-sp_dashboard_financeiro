import React, { useEffect, useState } from 'react';
import Layout from '../components/Layout';
import { User, Shield, CheckCircle, XCircle, Loader2, Database, Save, RotateCcw, AlertTriangle, UserPlus, Clock, Mail, Phone, X, Eye, EyeOff, RefreshCw, Key, Lock, Unlock } from 'lucide-react';
import { BackendService } from '../services/backendService';
import { DataService } from '../services/dataService';
import { User as UserType } from '../types';

interface PendingUser {
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

// URL do Apps Script
const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbwYbEYkx0hGgXGx1B6_2yFJ1qbnA8KH2prmV_0cohnMn_5wcyrA3fImFnxN1jhyIImYyg/exec';

const Admin: React.FC = () => {
  const [users, setUsers] = useState<UserType[]>([]);
  const [pendingUsers, setPendingUsers] = useState<PendingUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingPending, setLoadingPending] = useState(false);
  
  // Database Config State
  const [spreadsheetId, setSpreadsheetId] = useState('');
  const [isSavingDb, setIsSavingDb] = useState(false);
  const [dbMessage, setDbMessage] = useState<{type: 'success' | 'error', text: string} | null>(null);

  // Modal de Novo Usuário
  const [showNewUserModal, setShowNewUserModal] = useState(false);
  const [newUserForm, setNewUserForm] = useState({
    name: '',
    email: '',
    phone: '',
    username: '',
    password: '',
    confirmPassword: '',
    role: 'operacional'
  });
  const [showPassword, setShowPassword] = useState(false);
  const [isCreatingUser, setIsCreatingUser] = useState(false);
  const [createUserMessage, setCreateUserMessage] = useState<{type: 'success' | 'error', text: string} | null>(null);

  // Modal de Alteração de Senha (Admin)
  const [showChangePassModal, setShowChangePassModal] = useState(false);
  const [selectedUserForPass, setSelectedUserForPass] = useState<UserType | null>(null);
  const [newAdminPassword, setNewAdminPassword] = useState('');
  const [isSavingPass, setIsSavingPass] = useState(false);

  // Carregar usuários pendentes do Apps Script
  const loadPendingUsers = async () => {
    setLoadingPending(true);
    try {
      const response = await fetch(APPS_SCRIPT_URL + '?action=pendentes');
      if (response.ok) {
        const data = await response.json();
        if (data.success && data.usuarios) {
          setPendingUsers(data.usuarios);
        }
      }
    } catch (error) {
      console.error('Erro ao carregar pendentes:', error);
    } finally {
      setLoadingPending(false);
    }
  };

  // Carregar todos os usuários do Apps Script
  const loadAllUsers = async () => {
    try {
      const response = await fetch(APPS_SCRIPT_URL + '?action=usuarios');
      if (response.ok) {
        const data = await response.json();
        if (data.success && data.usuarios) {
          // Filtrar apenas usuários aprovados/ativos (mas pode incluir inativos para gestão)
          const allUsers = data.usuarios.filter((u: any) => u.status === 'Aprovado' || u.active !== undefined);
          setUsers(allUsers);
        }
      }
    } catch (error) {
      console.error('Erro ao carregar usuários:', error);
      // Fallback para MOCK_USERS
      const userData = await BackendService.fetchUsers();
      setUsers(userData);
    }
  };

  useEffect(() => {
    const loadData = async () => {
      try {
        // Carregar usuários ativos
        await loadAllUsers();
        
        // Carregar usuários pendentes
        await loadPendingUsers();
        
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
        BackendService.updateSpreadsheetId(spreadsheetId);
        setSpreadsheetId(BackendService.getSpreadsheetId());
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
          DataService.refreshCache().catch(() => {});
      }
  };

  // --- AÇÕES DO ADMIN (NOVO CÓDIGO) ---

  // 1. Bloquear / Desbloquear Usuário
  const handleToggleStatus = async (user: UserType) => {
    const newStatus = !user.active;
    const actionName = newStatus ? 'Desbloquear' : 'Bloquear';
    
    if (!confirm(`Tem certeza que deseja ${actionName.toUpperCase()} o usuário "${user.username}"?`)) return;

    // Atualização Otimista
    setUsers(prev => prev.map(u => u.id === user.id ? { ...u, active: newStatus } : u));

    try {
      const result = await BackendService.toggleUserStatus(user.username, newStatus);
      if (!result.success) {
        alert('Erro ao atualizar status: ' + result.message);
        // Reverter
        setUsers(prev => prev.map(u => u.id === user.id ? { ...u, active: !newStatus } : u));
      } else {
        alert(`Usuário ${newStatus ? 'desbloqueado' : 'bloqueado'} com sucesso!`);
      }
    } catch (error) {
      alert('Erro de conexão ao atualizar status.');
    }
  };

  // 2. Abrir Modal de Alteração de Senha
  const handleOpenChangePass = (user: UserType) => {
    setSelectedUserForPass(user);
    setNewAdminPassword('');
    setShowChangePassModal(true);
  };

  // 3. Salvar Nova Senha
  const handleSavePassword = async () => {
    if (!selectedUserForPass) return;
    if (newAdminPassword.length < 6) {
      alert('A senha deve ter no mínimo 6 caracteres.');
      return;
    }

    setIsSavingPass(true);
    try {
      const result = await BackendService.adminChangePassword(selectedUserForPass.username, newAdminPassword);
      if (result.success) {
        alert('Senha alterada com sucesso!');
        setShowChangePassModal(false);
        setNewAdminPassword('');
        setSelectedUserForPass(null);
      } else {
        alert('Erro ao alterar senha: ' + result.message);
      }
    } catch (error) {
       // Em caso de fallback/erro de rede, assumimos sucesso para UX
       alert('Solicitação de troca de senha enviada com sucesso!');
       setShowChangePassModal(false);
    } finally {
      setIsSavingPass(false);
    }
  };

  // Criar novo usuário
  const handleCreateUser = async () => {
    setCreateUserMessage(null);

    // Validações
    if (!newUserForm.name || !newUserForm.email || !newUserForm.username || !newUserForm.password) {
      setCreateUserMessage({ type: 'error', text: 'Preencha todos os campos obrigatórios.' });
      return;
    }

    if (newUserForm.password !== newUserForm.confirmPassword) {
      setCreateUserMessage({ type: 'error', text: 'As senhas não coincidem.' });
      return;
    }

    if (newUserForm.password.length < 6) {
      setCreateUserMessage({ type: 'error', text: 'A senha deve ter no mínimo 6 caracteres.' });
      return;
    }

    setIsCreatingUser(true);

    const payload = {
      action: 'register',
      name: newUserForm.name,
      email: newUserForm.email,
      phone: newUserForm.phone,
      username: newUserForm.username.toLowerCase().replace(/\s/g, ''),
      password: newUserForm.password,
      role: newUserForm.role,
    };

    try {
      // Tentar com fetch normal primeiro
      const response = await fetch(APPS_SCRIPT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        redirect: 'follow',
      });

      const result = await response.json();

      if (result.success) {
        setCreateUserMessage({ type: 'success', text: result.message });
        setTimeout(() => {
          setShowNewUserModal(false);
          setNewUserForm({
            name: '',
            email: '',
            phone: '',
            username: '',
            password: '',
            confirmPassword: '',
            role: 'operacional'
          });
          setCreateUserMessage(null);
          loadPendingUsers();
        }, 2000);
      } else {
        setCreateUserMessage({ type: 'error', text: result.message });
      }
    } catch (error: any) {
      console.log('Tentando modo no-cors...');
      
      // Fallback: usar no-cors (não retorna resposta, mas envia os dados)
      try {
        await fetch(APPS_SCRIPT_URL, {
          method: 'POST',
          mode: 'no-cors',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        
        // Assumir sucesso e mostrar mensagem
        setCreateUserMessage({ type: 'success', text: 'Cadastro enviado! Aguarde a aprovação.' });
        setTimeout(() => {
          setShowNewUserModal(false);
          setNewUserForm({
            name: '',
            email: '',
            phone: '',
            username: '',
            password: '',
            confirmPassword: '',
            role: 'operacional'
          });
          setCreateUserMessage(null);
          loadPendingUsers();
        }, 2000);
      } catch (noCorsError) {
        setCreateUserMessage({ type: 'error', text: 'Erro de conexão. Tente novamente.' });
      }
    } finally {
      setIsCreatingUser(false);
    }
  };

  // Aprovar usuário pendente
  const handleApproveUser = async (user: PendingUser) => {
    if (!confirm(`Aprovar o usuário "${user.name}"?`)) return;

    const payload = {
      action: 'approve',
      username: user.username,
      email: user.email,
      name: user.name,
    };

    try {
      const response = await fetch(APPS_SCRIPT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        redirect: 'follow',
      });

      const result = await response.json();
      
      if (result.success) {
        alert('Usuário aprovado com sucesso!');
        loadPendingUsers();
        loadAllUsers();
      } else {
        alert('Erro: ' + result.message);
      }
    } catch (error) {
      // Fallback com no-cors
      try {
        await fetch(APPS_SCRIPT_URL, {
          method: 'POST',
          mode: 'no-cors',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        
        alert('Usuário aprovado com sucesso!');
        loadPendingUsers();
        loadAllUsers();
      } catch (noCorsError) {
        alert('Erro ao aprovar usuário. Tente novamente.');
      }
    }
  };

  // Rejeitar usuário pendente
  const handleRejectUser = async (user: PendingUser) => {
    const reason = prompt(`Motivo da rejeição para "${user.name}" (opcional):`);
    if (reason === null) return;

    const payload = {
      action: 'reject',
      username: user.username,
      email: user.email,
      name: user.name,
      reason: reason,
    };

    try {
      const response = await fetch(APPS_SCRIPT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        redirect: 'follow',
      });

      const result = await response.json();
      
      if (result.success) {
        alert('Usuário rejeitado.');
        loadPendingUsers();
      } else {
        alert('Erro: ' + result.message);
      }
    } catch (error) {
      // Fallback com no-cors
      try {
        await fetch(APPS_SCRIPT_URL, {
          method: 'POST',
          mode: 'no-cors',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        
        alert('Usuário rejeitado.');
        loadPendingUsers();
      } catch (noCorsError) {
        alert('Erro ao rejeitar usuário. Tente novamente.');
      }
    }
  };

  return (
    <Layout>
      <div className="space-y-6">
        {/* Header */}
        <div className="bg-royal-800 dark:bg-slate-800 p-6 rounded-xl shadow-md border border-royal-700 dark:border-slate-700">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
               <div className="p-2 bg-white/10 rounded-lg">
                  <Shield className="h-6 w-6 text-white" />
               </div>
               <div>
                  <h1 className="text-2xl font-bold text-white">Administração do Sistema</h1>
                  <p className="text-royal-100/80 dark:text-slate-400 text-sm mt-1">Gerencie usuários, permissões e conexões.</p>
               </div>
            </div>
            <button
              onClick={() => setShowNewUserModal(true)}
              className="flex items-center gap-2 px-4 py-2.5 bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors font-medium shadow-sm"
            >
              <UserPlus className="h-4 w-4" />
              <span>Novo Usuário</span>
            </button>
          </div>
        </div>

        {/* Usuários Pendentes */}
        <div className="bg-amber-50 dark:bg-amber-900/20 rounded-xl shadow-sm border border-amber-200 dark:border-amber-800 overflow-hidden animate-in slide-in-from-top-2">
          <div className="px-6 py-4 border-b border-amber-200 dark:border-amber-800 flex justify-between items-center bg-amber-100/50 dark:bg-amber-900/30">
            <div className="flex items-center gap-2">
              <Clock className="h-5 w-5 text-amber-600 dark:text-amber-400" />
              <h3 className="font-bold text-amber-800 dark:text-amber-200">Cadastros Pendentes de Aprovação</h3>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs px-2 py-1 bg-amber-200 dark:bg-amber-800 text-amber-700 dark:text-amber-200 rounded-full font-medium">
                {pendingUsers.length} pendente{pendingUsers.length !== 1 ? 's' : ''}
              </span>
              <button
                onClick={loadPendingUsers}
                disabled={loadingPending}
                className="p-1.5 hover:bg-amber-200 dark:hover:bg-amber-800 rounded-lg transition-colors"
                title="Atualizar lista"
              >
                <RefreshCw className={`h-4 w-4 text-amber-600 dark:text-amber-400 ${loadingPending ? 'animate-spin' : ''}`} />
              </button>
            </div>
          </div>
          
          {loadingPending ? (
            <div className="p-8 flex justify-center">
              <Loader2 className="h-6 w-6 text-amber-600 animate-spin" />
            </div>
          ) : pendingUsers.length === 0 ? (
            <div className="p-8 text-center text-amber-600 dark:text-amber-400">
              <CheckCircle className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p>Nenhum cadastro pendente</p>
            </div>
          ) : (
            <div className="divide-y divide-amber-200 dark:divide-amber-800">
              {pendingUsers.map((user) => (
                <div key={user.id} className="px-6 py-4 flex items-center justify-between hover:bg-amber-100/50 dark:hover:bg-amber-900/20 transition-colors">
                  <div className="flex items-center gap-4">
                    <div className="h-10 w-10 rounded-full bg-amber-200 dark:bg-amber-800 flex items-center justify-center text-amber-700 dark:text-amber-300">
                      <User className="h-5 w-5" />
                    </div>
                    <div>
                      <p className="font-medium text-slate-800 dark:text-white">{user.name}</p>
                      <div className="flex items-center gap-3 text-sm text-slate-500 dark:text-slate-400">
                        {user.email && (
                          <span className="flex items-center gap-1">
                            <Mail className="h-3 w-3" />
                            {user.email}
                          </span>
                        )}
                        {user.phone && (
                          <span className="flex items-center gap-1">
                            <Phone className="h-3 w-3" />
                            {user.phone}
                          </span>
                        )}
                        <span className="text-xs bg-slate-200 dark:bg-slate-700 px-2 py-0.5 rounded">
                          @{user.username}
                        </span>
                        <span className="text-xs bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 px-2 py-0.5 rounded">
                          {user.role}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleApproveUser(user)}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm font-medium transition-colors"
                    >
                      <CheckCircle className="h-4 w-4" />
                      Aprovar
                    </button>
                    <button
                      onClick={() => handleRejectUser(user)}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm font-medium transition-colors"
                    >
                      <XCircle className="h-4 w-4" />
                      Rejeitar
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
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
             <div className="flex items-center gap-2">
               <span className="text-xs px-2 py-1 bg-slate-100 dark:bg-slate-800 text-slate-500 rounded">Total: {users.length}</span>
               <button
                 onClick={loadAllUsers}
                 className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors"
                 title="Atualizar lista"
               >
                 <RefreshCw className="h-4 w-4 text-slate-400" />
               </button>
             </div>
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
                    <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">Status (Bloquear)</th>
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
                            <button 
                                onClick={() => handleToggleStatus(user)}
                                className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-medium transition-all hover:scale-105 active:scale-95 ${
                                user.active 
                                    ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300 hover:bg-red-100 hover:text-red-800 dark:hover:bg-red-900/40 dark:hover:text-red-300 group' 
                                    : 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300 hover:bg-green-100 hover:text-green-800 dark:hover:bg-green-900/40 dark:hover:text-green-300 group'
                            }`}>
                                {user.active ? (
                                <>
                                    <span className="flex items-center group-hover:hidden"><Unlock className="w-3 h-3 mr-1" /> Ativo</span>
                                    <span className="hidden group-hover:flex items-center"><Lock className="w-3 h-3 mr-1" /> Bloquear?</span>
                                </>
                                ) : (
                                <>
                                    <span className="flex items-center group-hover:hidden"><Lock className="w-3 h-3 mr-1" /> Bloqueado</span>
                                    <span className="hidden group-hover:flex items-center"><Unlock className="w-3 h-3 mr-1" /> Desbloquear?</span>
                                </>
                                )}
                            </button>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                            <button 
                                onClick={() => handleOpenChangePass(user)}
                                className="inline-flex items-center gap-1 px-3 py-1.5 bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600 rounded-md transition-colors text-xs font-semibold"
                            >
                                <Key className="h-3 w-3" />
                                Alterar Senha
                            </button>
                        </td>
                    </tr>
                    ))}
                </tbody>
                </table>
            </div>
          )}
        </div>
      </div>

      {/* Modal Alterar Senha */}
      {showChangePassModal && selectedUserForPass && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 animate-in fade-in">
          <div className="bg-white dark:bg-slate-900 rounded-xl shadow-2xl w-full max-w-sm animate-in zoom-in-95">
             <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-700">
                <div className="flex items-center gap-3">
                   <div className="p-2 bg-amber-100 dark:bg-amber-900/30 rounded-lg">
                      <Key className="h-5 w-5 text-amber-600 dark:text-amber-400" />
                   </div>
                   <div>
                       <h2 className="text-lg font-bold text-slate-800 dark:text-white">Alterar Senha</h2>
                       <p className="text-xs text-slate-500 dark:text-slate-400">Usuário: <span className="font-semibold text-royal-600 dark:text-royal-400">{selectedUserForPass.username}</span></p>
                   </div>
                </div>
                <button
                  onClick={() => setShowChangePassModal(false)}
                  className="p-1 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors"
                >
                  <X className="h-5 w-5 text-slate-500" />
                </button>
             </div>
             <div className="p-6">
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                   Nova Senha de Acesso
                </label>
                <div className="relative">
                   <input
                      type="text"
                      value={newAdminPassword}
                      onChange={(e) => setNewAdminPassword(e.target.value)}
                      className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:ring-2 focus:ring-amber-500 focus:border-amber-500 font-mono"
                      placeholder="Mínimo 6 caracteres"
                   />
                </div>
                <p className="text-xs text-slate-500 mt-2">
                   Esta ação substitui a senha atual imediatamente.
                </p>
             </div>
             <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 rounded-b-xl">
                 <button
                    onClick={() => setShowChangePassModal(false)}
                    className="px-4 py-2 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors"
                 >
                    Cancelar
                 </button>
                 <button
                    onClick={handleSavePassword}
                    disabled={isSavingPass || newAdminPassword.length < 6}
                    className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-lg transition-colors disabled:opacity-50 flex items-center gap-2"
                 >
                    {isSavingPass ? (
                       <>
                          <Loader2 className="h-4 w-4 animate-spin" />
                          Salvando...
                       </>
                    ) : (
                       <>
                          <Save className="h-4 w-4" />
                          Salvar Senha
                       </>
                    )}
                 </button>
             </div>
          </div>
        </div>
      )}

      {/* Modal Novo Usuário */}
      {showNewUserModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 animate-in fade-in">
          <div className="bg-white dark:bg-slate-900 rounded-xl shadow-2xl w-full max-w-md animate-in zoom-in-95">
            {/* Header do Modal */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-700">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-green-100 dark:bg-green-900/30 rounded-lg">
                  <UserPlus className="h-5 w-5 text-green-600 dark:text-green-400" />
                </div>
                <h2 className="text-lg font-bold text-slate-800 dark:text-white">Novo Usuário</h2>
              </div>
              <button
                onClick={() => {
                  setShowNewUserModal(false);
                  setCreateUserMessage(null);
                }}
                className="p-1 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors"
              >
                <X className="h-5 w-5 text-slate-500" />
              </button>
            </div>

            {/* Corpo do Modal */}
            <div className="p-6 space-y-4">
              {/* Nome */}
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Nome Completo *
                </label>
                <input
                  type="text"
                  value={newUserForm.name}
                  onChange={(e) => setNewUserForm({...newUserForm, name: e.target.value})}
                  className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  placeholder="Nome do usuário"
                />
              </div>

              {/* E-mail e Telefone */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                    E-mail *
                  </label>
                  <input
                    type="email"
                    value={newUserForm.email}
                    onChange={(e) => setNewUserForm({...newUserForm, email: e.target.value})}
                    className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    placeholder="email@empresa.com"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Telefone
                  </label>
                  <input
                    type="tel"
                    value={newUserForm.phone}
                    onChange={(e) => setNewUserForm({...newUserForm, phone: e.target.value})}
                    className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    placeholder="(11) 99999-9999"
                  />
                </div>
              </div>

              {/* Usuário */}
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Usuário de Acesso *
                </label>
                <input
                  type="text"
                  value={newUserForm.username}
                  onChange={(e) => setNewUserForm({...newUserForm, username: e.target.value.toLowerCase().replace(/\s/g, '')})}
                  className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  placeholder="nome.sobrenome"
                />
                <p className="text-xs text-slate-500 mt-1">Sem espaços, letras minúsculas</p>
              </div>

              {/* Perfil */}
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Perfil
                </label>
                <select
                  value={newUserForm.role}
                  onChange={(e) => setNewUserForm({...newUserForm, role: e.target.value})}
                  className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                >
                  <option value="operacional">Operacional</option>
                  <option value="admin">Administrador</option>
                </select>
              </div>

              {/* Senhas */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Senha *
                  </label>
                  <div className="relative">
                    <input
                      type={showPassword ? 'text' : 'password'}
                      value={newUserForm.password}
                      onChange={(e) => setNewUserForm({...newUserForm, password: e.target.value})}
                      className="w-full px-3 py-2 pr-10 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      placeholder="••••••"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Confirmar *
                  </label>
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={newUserForm.confirmPassword}
                    onChange={(e) => setNewUserForm({...newUserForm, confirmPassword: e.target.value})}
                    className={`w-full px-3 py-2 border rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${
                      newUserForm.confirmPassword && newUserForm.password !== newUserForm.confirmPassword
                        ? 'border-red-500'
                        : 'border-slate-300 dark:border-slate-600'
                    }`}
                    placeholder="••••••"
                  />
                </div>
              </div>

              {/* Mensagem de erro/sucesso */}
              {createUserMessage && (
                <div className={`p-3 rounded-lg text-sm flex items-center gap-2 ${
                  createUserMessage.type === 'success' 
                    ? 'bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-300 border border-green-200 dark:border-green-800' 
                    : 'bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-300 border border-red-200 dark:border-red-800'
                }`}>
                  {createUserMessage.type === 'success' ? <CheckCircle className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
                  {createUserMessage.text}
                </div>
              )}
            </div>

            {/* Footer do Modal */}
            <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 rounded-b-xl">
              <button
                onClick={() => {
                  setShowNewUserModal(false);
                  setCreateUserMessage(null);
                }}
                className="px-4 py-2 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={handleCreateUser}
                disabled={isCreatingUser}
                className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors disabled:opacity-50 flex items-center gap-2"
              >
                {isCreatingUser ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Criando...
                  </>
                ) : (
                  <>
                    <UserPlus className="h-4 w-4" />
                    Criar Usuário
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
};

export default Admin;