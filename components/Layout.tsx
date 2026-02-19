
import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { LayoutDashboard, Users, LogOut, Menu, X, Wallet, FileText, Wifi, TrendingUp, TrendingDown, DollarSign, Building2, MessageCircle, CheckCircle } from 'lucide-react';
import { AuthService } from '../services/authService';
import { DataService } from '../services/dataService';
import { KPIData } from '../types';
import { ThemeToggle } from './ThemeToggle';

interface LayoutProps {
  children: React.ReactNode;
}

const Layout: React.FC<LayoutProps> = ({ children }) => {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [globalKpi, setGlobalKpi] = useState<KPIData | null>(null);
  const [showSessionAlert, setShowSessionAlert] = useState(true);
  
  const navigate = useNavigate();
  const location = useLocation();
  const user = AuthService.getCurrentUser();

  const handleLogout = () => {
    try {
      console.log('Logging out...');
      AuthService.logout();
      navigate('/login');
    } catch (e) {
      console.error('Logout error:', e);
      window.location.href = '#/login';
    }
  };

  // Load Global Financial Data for Header
  useEffect(() => {
    const updateHeaderKpi = () => {
      // Check if data is loaded in the service
      if (DataService.isDataLoaded) {
        // Usa a nova função que calcula especificamente (Pendentes para E/S e Realizado para Saldo)
        const stats = DataService.getGlobalStats();
        setGlobalKpi(stats);
      }
    };

    updateHeaderKpi();
    
    // Poll for updates every 2 seconds to keep header in sync with Dashboard changes
    const interval = setInterval(updateHeaderKpi, 2000);
    
    // Auto-dismiss session alert
    const timer = setTimeout(() => setShowSessionAlert(false), 5000);

    return () => {
        clearInterval(interval);
        clearTimeout(timer);
    };
  }, []);

  const formatCurrency = (val: number) => {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val);
  };

  const handleGlobalWhatsAppShare = () => {
    if (!globalKpi) return;
    const formatBRL = (val: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val);
    
    const message = `🏢 *Resumo Financeiro Global*%0A` +
      `--------------------------------%0A` +
      `🗓 Data: ${new Date().toLocaleDateString('pt-BR')}%0A` +
      `📥 A Receber (Aberto): ${formatBRL(globalKpi.totalReceived)}%0A` +
      `📤 A Pagar (Aberto): ${formatBRL(globalKpi.totalPaid)}%0A` +
      `💰 *Saldo em Caixa: ${formatBRL(globalKpi.balance)}*%0A` +
      `--------------------------------%0A` +
      `SP Contábil - Painel Administrativo`;
    
    window.open(`https://wa.me/?text=${message}`, '_blank');
  };

  const navItems = [
    { path: '/', label: 'Painel Principal', icon: LayoutDashboard },
    { path: '/reports', label: 'Relatórios', icon: FileText },
    // Verificação Case-Insensitive para Admin
    ...((user?.role || '').toLowerCase() === 'admin' ? [{ path: '/admin', label: 'Usuários', icon: Users }] : []),
  ];

  return (
    <div className="flex h-screen bg-slate-50 dark:bg-slate-950 overflow-hidden transition-colors duration-300">
      
      {/* Session Active Toast */}
      {showSessionAlert && user && (
        <div className="fixed top-5 right-5 z-[60] animate-in slide-in-from-right fade-in duration-500 print:hidden pointer-events-none">
           <div className="bg-emerald-600 text-white shadow-xl rounded-lg p-4 flex items-center gap-3 max-w-sm pointer-events-auto">
              <CheckCircle className="h-5 w-5 text-white/90" />
              <div className="flex-1">
                 <h4 className="font-bold text-sm">Sessão Ativa</h4>
                 <p className="text-xs text-white/80">Bem-vindo de volta, {user.name}.</p>
              </div>
              <button 
                onClick={() => setShowSessionAlert(false)}
                className="text-white/60 hover:text-white p-1 transition-colors cursor-pointer"
                type="button"
              >
                 <X className="h-4 w-4" />
              </button>
           </div>
        </div>
      )}

      {/* Mobile Sidebar Overlay */}
      {isSidebarOpen && (
        <div 
          className="fixed inset-0 bg-black/50 z-40 lg:hidden print:hidden"
          onClick={() => setIsSidebarOpen(false)}
        />
      )}

      {/* Sidebar - Hidden on Print - Updated to Royal Blue Theme */}
      <aside 
        className={`
          fixed lg:static inset-y-0 left-0 z-50 w-64 bg-royal-950 dark:bg-slate-900 text-white transform transition-transform duration-200 ease-in-out print:hidden shadow-xl
          ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'} flex flex-col border-r border-royal-900 dark:border-slate-800
        `}
      >
        {/* LOGO AREA - PROMINENT */}
        <div className="flex items-center justify-between h-24 px-6 bg-royal-900 dark:bg-slate-800/50 shrink-0 border-b border-royal-800/50 dark:border-slate-700">
          <div className="flex items-center gap-3.5">
            <div className="bg-gradient-to-br from-royal-500 to-royal-700 p-2.5 rounded-xl shadow-lg shadow-royal-900/40 border border-royal-400/20">
                <Building2 className="h-7 w-7 text-white" />
            </div>
            <div className="flex flex-col">
                <span className="font-extrabold text-xl tracking-tight leading-none text-white font-sans">SP Contábil</span>
                <span className="text-[10px] text-royal-200 dark:text-slate-400 uppercase tracking-widest font-semibold mt-1">Gestão Financeira</span>
            </div>
          </div>
          <button onClick={() => setIsSidebarOpen(false)} className="lg:hidden text-royal-200 hover:text-white cursor-pointer" type="button">
            <X className="h-6 w-6" />
          </button>
        </div>

        <div className="flex-1 px-4 py-6 overflow-y-auto bg-royal-950 dark:bg-slate-900">
          <div className="flex items-center space-x-3 px-4 py-3 mb-6 bg-royal-900/50 dark:bg-slate-800/50 rounded-xl border border-royal-800/30 dark:border-slate-700">
            <img 
              src={`https://ui-avatars.com/api/?name=${user?.name}&background=1e40af&color=fff&bold=true`} 
              alt="Avatar" 
              className="h-10 w-10 rounded-full border-2 border-royal-700"
            />
            <div>
              <p className="text-sm font-semibold text-white">{user?.name}</p>
              <p className="text-xs text-royal-200 dark:text-slate-400 capitalize">{user?.role === 'admin' ? 'Administrador' : 'Operacional'}</p>
            </div>
          </div>

          <nav className="space-y-1.5">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = location.pathname === item.path;
              return (
                <button
                  key={item.path}
                  type="button"
                  onClick={() => {
                    console.log('Navigating to:', item.path);
                    navigate(item.path);
                    setIsSidebarOpen(false);
                  }}
                  className={`
                    w-full flex items-center space-x-3 px-4 py-3.5 rounded-xl transition-all duration-200 cursor-pointer relative z-10
                    ${isActive 
                        ? 'bg-royal-800 dark:bg-blue-900/50 text-white shadow-md border border-royal-700/50' 
                        : 'text-royal-200 dark:text-slate-400 hover:bg-royal-900/50 dark:hover:bg-slate-800 hover:text-white'}
                  `}
                >
                  <Icon className={`h-5 w-5 ${isActive ? 'text-white' : 'text-royal-300 dark:text-slate-500'}`} />
                  <span className="font-medium">{item.label}</span>
                </button>
              );
            })}
          </nav>
        </div>

        <div className="p-4 border-t border-royal-900 dark:border-slate-800 shrink-0 space-y-4 bg-royal-950 dark:bg-slate-900">
          {/* Desktop Theme Toggle */}
          <div className="flex items-center justify-between px-2">
              <span className="text-xs text-royal-300 dark:text-slate-500 uppercase font-bold tracking-wider">Modo</span>
              <ThemeToggle />
          </div>

          <div className="rounded-lg p-3 text-xs font-medium flex items-center gap-2 border bg-emerald-950/30 border-emerald-900/50 text-emerald-400">
             <Wifi className="h-4 w-4" />
             <span>Conectado</span>
          </div>

          <button 
            type="button"
            onClick={handleLogout}
            className="w-full flex items-center space-x-3 px-4 py-3 text-royal-300 dark:text-slate-400 hover:text-white hover:bg-royal-900 dark:hover:bg-slate-800 rounded-lg transition-colors cursor-pointer relative z-10"
          >
            <LogOut className="h-5 w-5" />
            <span>Sair</span>
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden relative z-0">
        {/* Mobile Header - Hidden on Print */}
        <header className="lg:hidden flex items-center justify-between px-4 h-16 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 print:hidden transition-colors relative z-20">
          <button onClick={() => setIsSidebarOpen(true)} className="text-royal-800 dark:text-slate-300 cursor-pointer p-1" type="button">
            <Menu className="h-6 w-6" />
          </button>
          <div className="flex items-center gap-3">
             <div className="bg-gradient-to-br from-royal-600 to-royal-800 p-1.5 rounded-lg shadow-sm">
                <Building2 className="h-5 w-5 text-white" />
             </div>
             <span className="font-bold text-slate-800 dark:text-white tracking-tight">SP Contábil</span>
          </div>
          <ThemeToggle />
        </header>

        <main className="flex-1 overflow-auto p-4 lg:p-8 bg-slate-50/50 dark:bg-slate-950/50 print:bg-white print:p-0 transition-colors relative z-0">
          <div className="max-w-7xl mx-auto">
            
            {/* Global Financial Header Summary */}
            {globalKpi && (
              <div className="mb-8 grid grid-cols-1 sm:grid-cols-4 gap-0 sm:gap-4 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden animate-slideUp print:border-slate-300 transition-colors relative">
                 <div className="sm:col-span-3 grid grid-cols-1 sm:grid-cols-3">
                     <div className="flex items-center gap-4 p-4 border-b sm:border-b-0 border-slate-100 dark:border-slate-800">
                        <div className="p-2.5 bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400 rounded-lg shrink-0 print:bg-transparent">
                           <TrendingUp className="h-5 w-5" />
                        </div>
                        <div>
                           {/* LABEL ATUALIZADO: "A Receber (Aberto)" em vez de apenas Entradas Globais */}
                           <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">A Receber (Aberto)</p>
                           <p className="text-lg font-bold text-slate-800 dark:text-slate-100">{formatCurrency(globalKpi.totalReceived)}</p>
                        </div>
                     </div>

                     <div className="flex items-center gap-4 p-4 border-b sm:border-b-0 sm:border-l border-slate-100 dark:border-slate-800">
                        <div className="p-2.5 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 rounded-lg shrink-0 print:bg-transparent">
                           <TrendingDown className="h-5 w-5" />
                        </div>
                        <div>
                           {/* LABEL ATUALIZADO: "A Pagar (Aberto)" em vez de apenas Saídas Globais */}
                           <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">A Pagar (Aberto)</p>
                           <p className="text-lg font-bold text-slate-800 dark:text-slate-100">{formatCurrency(globalKpi.totalPaid)}</p>
                        </div>
                     </div>

                     <div className="flex items-center gap-4 p-4 sm:border-l border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30 print:bg-transparent">
                        <div className={`p-2.5 rounded-lg shrink-0 print:bg-transparent ${globalKpi.balance >= 0 ? 'bg-royal-100 dark:bg-blue-900/20 text-royal-700 dark:text-blue-400' : 'bg-red-100 dark:bg-red-900/20 text-red-600 dark:text-red-400'}`}>
                           <DollarSign className="h-5 w-5" />
                        </div>
                        <div>
                           <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Saldo Real (Caixa)</p>
                           <p className={`text-lg font-bold ${globalKpi.balance >= 0 ? 'text-royal-700 dark:text-blue-400' : 'text-red-600 dark:text-red-400'}`}>
                              {formatCurrency(globalKpi.balance)}
                           </p>
                        </div>
                     </div>
                 </div>

                 {/* WhatsApp Quick Share for Global Stats */}
                 <div className="flex items-center justify-center p-4 border-t sm:border-t-0 sm:border-l border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 print:hidden">
                    <button 
                        onClick={handleGlobalWhatsAppShare}
                        className="flex flex-col items-center justify-center gap-1 text-green-600 dark:text-green-400 hover:text-green-700 dark:hover:text-green-300 transition-colors w-full h-full cursor-pointer"
                        title="Compartilhar Resumo Global via WhatsApp"
                        type="button"
                    >
                        <MessageCircle className="h-6 w-6" />
                        <span className="text-xs font-semibold">Compartilhar</span>
                    </button>
                 </div>
              </div>
            )}

            {children}
          </div>
        </main>
      </div>
    </div>
  );
};

export default Layout;
