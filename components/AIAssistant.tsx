
import React, { useState, useRef, useEffect } from 'react';
import { MessageSquare, Send, X, Sparkles, Loader2, Bot, User, ChevronRight, BarChart3, TrendingUp, Filter } from 'lucide-react';
import { GeminiService } from '../services/geminiService';
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
  "Resumo das entradas de ontem",
  "Mostrar gastos com impostos"
];

const AIAssistant: React.FC<AIAssistantProps> = ({ onApplyFilters, transactions }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [messages, setMessages] = useState<Message[]>([
    { role: 'assistant', content: 'Olá! Sou seu assistente CashFlow Pro. Como posso ajudar com suas finanças hoje?' }
  ]);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSend = async (textOverride?: string) => {
    const textToProcess = textOverride || query;
    if (!textToProcess.trim() || isLoading) return;

    const userMessage: Message = { role: 'user', content: textToProcess };
    setMessages(prev => [...prev, userMessage]);
    setQuery('');
    setIsLoading(true);

    try {
      const mode = await GeminiService.detectMode(textToProcess);
      let assistantMessage: Message = { role: 'assistant', content: '', mode };

      if (mode === 'forecast') {
        const forecast = await GeminiService.forecastCashFlow(transactions);
        assistantMessage.content = forecast;
      } else if (mode === 'analysis') {
        const analysis = await GeminiService.analyzeData(textToProcess, transactions);
        assistantMessage.content = analysis;
      } else {
        const result = await GeminiService.interpretQuery(textToProcess);
        assistantMessage.content = result.explanation;
        if (Object.keys(result.filters).length > 0) {
          onApplyFilters(result.filters);
        }
      }

      setMessages(prev => [...prev, assistantMessage]);
    } catch (error) {
      setMessages(prev => [...prev, { role: 'assistant', content: 'Desculpe, tive um problema ao processar sua solicitação.' }]);
    } finally {
      setIsLoading(false);
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
                  <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-pulse"></span>
                  <span className="text-[10px] text-blue-100 font-medium">Online e pronta</span>
                </div>
              </div>
            </div>
            <button onClick={() => setIsOpen(false)} className="text-white/80 hover:text-white transition-colors">
              <X className="h-5 w-5" />
            </button>
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
                disabled={!query.trim() || isLoading}
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
