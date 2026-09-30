
import React, { useState, useRef, useEffect } from 'react';
import { MessageSquare, Send, X, Sparkles, Loader2, Bot, User, ChevronRight, BarChart3, TrendingUp, Filter } from 'lucide-react';
import { FinancialAIService, FinancialAIStatus } from '../services/financialAIService';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from '../firebase';
import { FilterState, Transaction } from '../types';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  mode?: 'filter' | 'analysis' | 'forecast';
}

interface AIAssistantProps {
  onApplyFilters: (filters: Partial<FilterState>) => void;
  transactions: Transaction[];
}

const SUGGESTIONS = [
  "Contas a pagar deste mês",
  "Qual cliente deve mais?",
  "Previsão de caixa para 30 dias",
  "Resumo dos lançamentos selecionados",
  "Mostrar gastos com impostos"
];

const AIAssistant: React.FC<AIAssistantProps> = ({ onApplyFilters, transactions }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [status, setStatus] = useState<FinancialAIStatus | null>(null);
  const [statusError, setStatusError] = useState('');
  const [scope, setScope] = useState<'all' | 'selection'>('selection');
  const [sessionUid, setSessionUid] = useState(auth.currentUser?.uid || '');
  const welcome = 'Olá! Posso consultar os lançamentos e preparar uma projeção de vencimentos. Escolha abaixo toda a base ou os filtros atuais.';
  const [messages, setMessages] = useState<Message[]>([{ role: 'assistant', content: welcome }]);
  const pendingRequest = useRef<AbortController | null>(null);
  const requestVersion = useRef(0);
  const isAIAvailable = status?.available === true;

  useEffect(() => onAuthStateChanged(auth, user => {
    requestVersion.current++;
    pendingRequest.current?.abort();
    setMessages([{ role: 'assistant', content: welcome }]);
    setIsLoading(false);
    setStatus(null);
    setSessionUid(user?.uid || '');
  }), []);

  useEffect(() => {
    if (!isOpen || !sessionUid) return;
    const controller = new AbortController();
    setStatus(null);
    setStatusError('');
    FinancialAIService.status(controller.signal).then(result => {
      if (!controller.signal.aborted) setStatus(result);
    }).catch(error => {
      if (!controller.signal.aborted) setStatusError(error.message || 'Consulta indisponível.');
    });
    return () => controller.abort();
  }, [isOpen, sessionUid]);

  useEffect(() => () => { requestVersion.current++; pendingRequest.current?.abort(); }, []);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSend = async (textOverride?: string) => {
    const textToProcess = textOverride || query;
    if (!textToProcess.trim() || isLoading || !isAIAvailable) return;

    const version = ++requestVersion.current;
    const controller = new AbortController();
    pendingRequest.current = controller;

    const userMessage: Message = { role: 'user', content: textToProcess };
    setMessages(prev => [...prev, userMessage]);
    setQuery('');
    setIsLoading(true);

    try {
      const mode = FinancialAIService.detectMode(textToProcess);
      const result = await FinancialAIService.query(textToProcess, mode, scope === 'all'
        ? { kind: 'all' }
        : { kind: 'selection', transactionIds: transactions.map(transaction => transaction.firestoreId || transaction.id) }, controller.signal);
      if (version !== requestVersion.current) return;
      setMessages(prev => [...prev, { role: 'assistant', content: result.answer, mode }]);
      if (result.filters && Object.keys(result.filters).length) onApplyFilters(result.filters);
    } catch (error: any) {
      if (version === requestVersion.current && !controller.signal.aborted) setMessages(prev => [...prev, { role: 'assistant', content: error.message || 'Não foi possível concluir a consulta.' }]);
    } finally {
      if (version === requestVersion.current) setIsLoading(false);
    }
  };

  return (
    <div className="fixed bottom-6 right-6 z-50">
      {/* Chat Window */}
      {isOpen && (
        <div className="absolute bottom-20 right-0 w-[400px] h-[600px] bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 flex flex-col overflow-hidden transition-all animate-in slide-in-from-bottom-4">
          {/* Header */}
          <div className="p-4 bg-blue-600 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="bg-white/20 p-1.5 rounded-lg">
                <Sparkles className="h-5 w-5 text-white" />
              </div>
              <div>
                <h3 className="text-white font-bold text-sm">IA Financeira</h3>
                <div className="flex items-center gap-1">
                  <span className={`w-1.5 h-1.5 rounded-full ${isAIAvailable ? 'bg-emerald-400 animate-pulse' : 'bg-amber-300'}`}></span>
                  <span className="text-[10px] text-blue-100 font-medium">
                    {isAIAvailable ? (status?.languageModelAvailable ? 'Consultas e interpretação disponíveis' : 'Cálculos disponíveis') : 'Consulta indisponível'}
                  </span>
                </div>
              </div>
            </div>
            <button onClick={() => setIsOpen(false)} className="text-white/80 hover:text-white transition-colors">
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 space-y-2">
            <label className="text-xs text-slate-600 dark:text-slate-300 flex items-center justify-between gap-2">
              Consultar
              <select aria-label="Escopo da consulta financeira" value={scope} onChange={event => setScope(event.target.value as 'all' | 'selection')} disabled={isLoading} className="rounded-lg border border-slate-300 bg-white dark:bg-slate-800 p-1 text-xs">
                <option value="selection">Filtros atuais ({transactions.length} lançamentos)</option>
                <option value="all">Toda a base financeira da SP</option>
              </select>
            </label>
            <p className="text-xs text-slate-500">Consultas e projeções. Nenhum pagamento ou cobrança é executado.</p>
            {statusError && <p role="status" className="text-xs text-amber-700 dark:text-amber-300">{statusError} Os filtros manuais continuam disponíveis.</p>}
            {status && !status.available && <p role="status" className="text-xs text-amber-700 dark:text-amber-300">Consultor Financeiro ainda não habilitado. Os filtros manuais continuam disponíveis.</p>}
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4 scrollbar-thin scrollbar-thumb-slate-200 dark:scrollbar-thumb-slate-800">
            {messages.map((msg, idx) => (
              <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`flex gap-2 max-w-[85%] ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}>
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${msg.role === 'user' ? 'bg-slate-200 dark:bg-slate-700' : 'bg-blue-100 dark:bg-blue-900/30'}`}>
                    {msg.role === 'user' ? <User className="h-4 w-4 text-slate-600 dark:text-slate-300" /> : <Bot className="h-4 w-4 text-blue-600 dark:text-blue-400" />}
                  </div>
                  <div className="space-y-1">
                    {msg.mode && (
                      <div className="flex">
                        <span className={`text-[9px] font-black uppercase px-1.5 py-0.5 rounded tracking-widest ${
                          msg.mode === 'filter' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300' :
                          msg.mode === 'analysis' ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300' :
                          'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
                        }`}>
                          {msg.mode === 'filter' && <><Filter className="inline h-2 w-2 mr-1" /> Filtro</>}
                          {msg.mode === 'analysis' && <><BarChart3 className="inline h-2 w-2 mr-1" /> Análise</>}
                          {msg.mode === 'forecast' && <><TrendingUp className="inline h-2 w-2 mr-1" /> Previsão</>}
                        </span>
                      </div>
                    )}
                    <div className={`p-3 rounded-2xl text-sm ${
                      msg.role === 'user' 
                        ? 'bg-blue-600 text-white rounded-tr-none' 
                        : 'bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200 rounded-tl-none'
                    }`}>
                      <div className="whitespace-pre-wrap">
                        {msg.content}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ))}
            {isLoading && (
              <div className="flex justify-start">
                <div className="bg-slate-100 dark:bg-slate-800 p-3 rounded-2xl rounded-tl-none flex items-center gap-2">
                  <Loader2 className="h-4 w-4 text-blue-500 animate-spin" />
                  <span className="text-xs text-slate-500">Processando análise...</span>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Suggestions */}
          {messages.length === 1 && !isLoading && (
            <div className="p-4 border-t border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/20">
              <p className="text-[10px] font-bold text-slate-400 uppercase mb-2 tracking-wider">Sugestões</p>
              <div className="flex flex-wrap gap-2">
                {SUGGESTIONS.map((s, i) => (
                  <button 
                    key={i} 
                    onClick={() => handleSend(s)}
                    disabled={!isAIAvailable || (!status?.languageModelAvailable && FinancialAIService.detectMode(s) === 'filter')}
                    className="text-[11px] bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 px-2.5 py-1.5 rounded-lg hover:border-blue-500 dark:hover:border-blue-500 transition-colors text-slate-600 dark:text-slate-300 flex items-center gap-1"
                  >
                    {s} <ChevronRight className="h-3 w-3" />
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Input */}
          <div className="p-4 border-t border-slate-200 dark:border-slate-800">
            <div className="relative">
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSend()}
                placeholder="Pergunte algo..."
                className="w-full bg-slate-100 dark:bg-slate-800 border-none rounded-xl py-3 pl-4 pr-12 text-sm focus:ring-2 focus:ring-blue-500 outline-none dark:text-white"
              />
              <button 
                onClick={() => handleSend()}
                disabled={!query.trim() || isLoading || !isAIAvailable}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
              >
                <Send className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toggle Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`p-4 rounded-2xl shadow-2xl transition-all duration-300 flex items-center gap-2 group ${
          isOpen ? 'bg-slate-800 text-white rotate-90' : 'bg-blue-600 text-white hover:scale-110'
        }`}
      >
        {isOpen ? <X className="h-6 w-6" /> : (
          <>
            <Sparkles className="h-6 w-6" />
            <span className="max-w-0 overflow-hidden group-hover:max-w-xs transition-all duration-500 font-bold whitespace-nowrap">Assistente IA</span>
          </>
        )}
      </button>
    </div>
  );
};

export default AIAssistant;
