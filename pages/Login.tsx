import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AuthService } from '../services/authService';
import { BackendService } from '../services/backendService';
import { Building2, User, Lock, Eye, EyeOff, ShieldCheck, Loader2, AlertCircle, ArrowLeft, Mail, CheckCircle2 } from 'lucide-react';
import { ThemeToggle } from '../components/ThemeToggle';

const Login: React.FC = () => {
  const [view, setView] = useState<'login' | 'forgot'>('login');
  
  // Login State
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  
  // Forgot Password State
  const [forgotUsername, setForgotUsername] = useState('');
  const [forgotStatus, setForgotStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [forgotMessage, setForgotMessage] = useState('');

  const navigate = useNavigate();

  // --- LOGIN LOGIC ---
  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);
    
    try {
      const result = await AuthService.login(username, password);
      
      if (result.success) {
        navigate('/');
      } else {
        setError(result.message);
      }
    } catch (err) {
      setError('Ocorreu um erro ao tentar fazer login.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleInput = (setter: React.Dispatch<React.SetStateAction<string>>, value: string) => {
    setter(value);
    if (error) setError('');
  };

  // --- FORGOT PASSWORD LOGIC ---
  const handleForgotSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setForgotStatus('loading');
    setForgotMessage('');

    try {
      const result = await BackendService.requestPasswordReset(forgotUsername);
      if (result.success) {
        setForgotStatus('success');
        setForgotMessage(result.message);
      } else {
        setForgotStatus('error');
        setForgotMessage(result.message);
      }
    } catch (e) {
      setForgotStatus('error');
      setForgotMessage('Erro ao processar solicitação.');
    }
  };

  return (
    <div className="min-h-screen w-full flex flex-col items-center justify-center p-5 font-sans transition-colors duration-500
      bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-royal-900 via-royal-950 to-slate-950 dark:from-slate-900 dark:to-slate-950">
      
      {/* Theme Toggle Positioned Absolute */}
      <div className="absolute top-5 right-5">
        <ThemeToggle />
      </div>

      <div className="w-full max-w-[420px] 
        bg-white/95 dark:bg-slate-900/90 
        backdrop-blur-sm rounded-[20px] shadow-[0_25px_50px_rgba(0,0,0,0.25)] dark:shadow-[0_25px_50px_rgba(0,0,0,0.5)] 
        border border-white/20 dark:border-slate-700
        p-10 animate-slideUp overflow-hidden relative transition-colors duration-300">
        
        {/* VIEW: LOGIN */}
        {view === 'login' && (
          <div className="animate-in fade-in slide-in-from-left-4 duration-300">
            {/* Header with SP CONTABIL Branding */}
            <div className="text-center mb-8">
              <div className="w-[80px] h-[80px] bg-royal-700 rounded-2xl flex items-center justify-center mx-auto mb-5 shadow-lg shadow-royal-700/40 transform rotate-3 hover:rotate-0 transition-transform duration-300">
                <Building2 className="h-10 w-10 text-white" />
              </div>
              <h1 className="text-2xl font-bold text-slate-800 dark:text-white mb-1 tracking-tight">SP CONTÁBIL</h1>
              <p className="text-royal-600 dark:text-royal-400 text-xs font-semibold uppercase tracking-widest mb-2">SP FINANCIAL DASHBOARD</p>
              <p className="text-slate-500 dark:text-slate-400 text-sm">Faça login para acessar o painel</p>
            </div>

            {/* Error Alert */}
            {error && (
              <div className="mb-5 p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 flex items-center gap-3 text-red-600 dark:text-red-400 text-sm animate-in fade-in slide-in-from-top-2">
                <AlertCircle className="h-5 w-5 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {/* Form */}
            <form onSubmit={handleLoginSubmit}>
              <div className="mb-5">
                <label className="block text-[13px] font-semibold text-slate-700 dark:text-slate-300 mb-2">Usuário</label>
                <div className="relative group">
                  <div className="absolute left-[15px] top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-royal-600 transition-colors">
                    <User className="h-4 w-4" />
                  </div>
                  <input
                    type="text"
                    value={username}
                    onChange={(e) => handleInput(setUsername, e.target.value)}
                    className="w-full py-3.5 pl-[45px] pr-3.5 border-2 border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 rounded-[10px] text-[15px] text-slate-800 dark:text-white transition-all focus:outline-none focus:border-royal-600 focus:ring-4 focus:ring-royal-600/10 placeholder:text-slate-400"
                    placeholder="Digite seu usuário"
                    required
                  />
                </div>
              </div>

              <div className="mb-2">
                <label className="block text-[13px] font-semibold text-slate-700 dark:text-slate-300 mb-2">Senha</label>
                <div className="relative group">
                  <div className="absolute left-[15px] top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-royal-600 transition-colors">
                    <Lock className="h-4 w-4" />
                  </div>
                  <input
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => handleInput(setPassword, e.target.value)}
                    className="w-full py-3.5 pl-[45px] pr-10 border-2 border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 rounded-[10px] text-[15px] text-slate-800 dark:text-white transition-all focus:outline-none focus:border-royal-600 focus:ring-4 focus:ring-royal-600/10 placeholder:text-slate-400"
                    placeholder="Digite sua senha"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-[15px] top-1/2 -translate-y-1/2 text-slate-400 hover:text-royal-600 transition-colors p-1"
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              <div className="flex justify-end mb-6">
                <button 
                  type="button" 
                  onClick={() => setView('forgot')}
                  className="text-xs font-medium text-royal-600 hover:text-royal-800 dark:text-royal-400 dark:hover:text-royal-300 transition-colors"
                >
                  Esqueci minha senha
                </button>
              </div>

              <button
                type="submit"
                disabled={isLoading}
                className="w-full py-3.5 bg-royal-700 hover:bg-royal-800 text-white rounded-[10px] text-base font-semibold shadow-lg shadow-royal-700/30 hover:-translate-y-0.5 disabled:opacity-70 disabled:transform-none disabled:shadow-none transition-all flex items-center justify-center gap-2"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="h-5 w-5 animate-spin" />
                    <span>Entrando...</span>
                  </>
                ) : (
                  <span>Acessar Sistema</span>
                )}
              </button>
            </form>

            <div className="mt-8 text-center">
              <p className="text-xs text-slate-400 flex items-center justify-center gap-1.5 mb-1">
                <ShieldCheck className="h-3.5 w-3.5" />
                Ambiente criptografado e seguro
              </p>
              <p className="text-[10px] text-slate-300 dark:text-slate-600 font-mono opacity-80">
                Versão 2.0 Release 001
              </p>
            </div>
          </div>
        )}

        {/* VIEW: FORGOT PASSWORD */}
        {view === 'forgot' && (
          <div className="animate-in fade-in slide-in-from-right-4 duration-300">
             <button 
                onClick={() => {
                  setView('login');
                  setForgotStatus('idle');
                }}
                className="flex items-center text-slate-500 hover:text-slate-800 dark:hover:text-slate-300 text-sm font-medium mb-6 transition-colors"
             >
                <ArrowLeft className="h-4 w-4 mr-1" />
                Voltar ao Login
             </button>

             <div className="text-center mb-8">
                <div className="w-14 h-14 bg-royal-50 dark:bg-royal-900/30 rounded-full flex items-center justify-center mx-auto mb-4">
                  <Mail className="h-6 w-6 text-royal-600 dark:text-royal-400" />
                </div>
                <h2 className="text-xl font-bold text-slate-800 dark:text-white">Recuperar Senha</h2>
                <p className="text-slate-500 dark:text-slate-400 text-sm mt-2">
                  Informe seu usuário para resetar sua senha.
                </p>
             </div>

             {forgotStatus === 'success' ? (
               <div className="text-center bg-green-50 dark:bg-green-900/20 p-6 rounded-xl border border-green-100 dark:border-green-900 animate-in zoom-in-95 duration-200">
                  <div className="mx-auto w-12 h-12 bg-green-100 dark:bg-green-800 rounded-full flex items-center justify-center mb-3">
                    <CheckCircle2 className="h-6 w-6 text-green-600 dark:text-green-200" />
                  </div>
                  <h3 className="text-green-800 dark:text-green-300 font-semibold mb-2">Sucesso!</h3>
                  <p className="text-green-700 dark:text-green-400 text-sm">{forgotMessage}</p>
                  <button 
                    onClick={() => setView('login')}
                    className="mt-4 inline-flex items-center justify-center px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 transition-colors"
                  >
                    Fazer Login Agora
                  </button>
               </div>
             ) : (
               <form onSubmit={handleForgotSubmit}>
                 <div className="mb-6">
                    <label className="block text-[13px] font-semibold text-slate-700 dark:text-slate-300 mb-2">Usuário Cadastrado</label>
                    <div className="relative group">
                      <div className="absolute left-[15px] top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-royal-600 transition-colors">
                        <User className="h-4 w-4" />
                      </div>
                      <input
                        type="text"
                        value={forgotUsername}
                        onChange={(e) => setForgotUsername(e.target.value)}
                        className="w-full py-3.5 pl-[45px] pr-3.5 border-2 border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 rounded-[10px] text-[15px] text-slate-800 dark:text-white transition-all focus:outline-none focus:border-royal-600 focus:ring-4 focus:ring-royal-600/10 placeholder:text-slate-400"
                        placeholder="Ex: admin"
                        required
                        disabled={forgotStatus === 'loading'}
                      />
                    </div>
                  </div>

                  {forgotStatus === 'error' && (
                    <div className="mb-4 p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 flex items-center gap-2 text-red-600 dark:text-red-400 text-sm">
                      <AlertCircle className="h-4 w-4 shrink-0" />
                      <span>{forgotMessage}</span>
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={forgotStatus === 'loading'}
                    className="w-full py-3.5 bg-slate-800 dark:bg-slate-700 text-white rounded-[10px] text-base font-semibold shadow-md hover:bg-slate-900 dark:hover:bg-slate-600 disabled:opacity-70 transition-all flex items-center justify-center gap-2"
                  >
                    {forgotStatus === 'loading' ? (
                      <>
                        <Loader2 className="h-5 w-5 animate-spin" />
                        <span>Processando...</span>
                      </>
                    ) : (
                      <span>Resetar Senha</span>
                    )}
                  </button>
               </form>
             )}
          </div>
        )}

      </div>
      
      {/* Footer / Credit */}
      <div className="mt-8 text-center text-royal-200/60 dark:text-slate-500 text-xs font-medium tracking-wide animate-in fade-in duration-500 delay-150 flex flex-col gap-1">
          <span>&copy; {new Date().getFullYear()} SP Contábil. Todos os direitos reservados.</span>
          <span className="font-bold opacity-80 tracking-widest">DESENVOLVIDO BY SP-CONTÁBIL</span>
      </div>
    </div>
  );
};

export default Login;