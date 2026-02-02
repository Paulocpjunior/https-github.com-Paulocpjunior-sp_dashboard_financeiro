import React, { useState } from 'react';
import { Sparkles, Send, Loader2, X, Bot } from 'lucide-react';
import { GeminiService } from '../services/geminiService';
import { FilterState } from '../types';

interface AIAssistantProps {
  onFiltersUpdate: (filters: Partial<FilterState>) => void;
}

const AIAssistant: React.FC<AIAssistantProps> = ({ onFiltersUpdate }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [lastResponse, setLastResponse] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;

    setIsLoading(true);
    setLastResponse(null);
    
    try {
      const { filters, explanation } = await GeminiService.interpretQuery(query);
      
      // Update parent filters if we got any
      onFiltersUpdate(filters);
      
      setLastResponse(explanation);
      setQuery(''); // Clear input
    } catch (error) {
      setLastResponse('Desculpe, ocorreu um erro ao processar sua solicitação.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <>
      {/* Floating Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`
          fixed bottom-8 right-8 z-40 p-4 rounded-full shadow-lg transition-all duration-300
          ${isOpen ? 'bg-slate-200 text-slate-600 rotate-45' : 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white hover:scale-110'}
        `}
      >
        {isOpen ? <X className="h-6 w-6" /> : <Sparkles className="h-6 w-6" />}
      </button>

      {/* Chat Interface */}
      {isOpen && (
        <div className="fixed bottom-24 right-8 z-40 w-80 sm:w-96 bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-100 dark:border-slate-800 overflow-hidden flex flex-col animate-in slide-in-from-bottom-10 fade-in duration-200">
          <div className="bg-gradient-to-r from-blue-600 to-indigo-600 p-4">
            <h3 className="text-white font-bold flex items-center gap-2">
              <Sparkles className="h-4 w-4" />
              IA Assistant
            </h3>
            <p className="text-blue-100 text-xs mt-1">
              Pergunte sobre seus dados financeiros.
            </p>
          </div>

          <div className="p-4 bg-slate-50 dark:bg-slate-950 min-h-[140px] max-h-[250px] overflow-y-auto">
             {!lastResponse && !isLoading && (
               <div className="text-center text-slate-400 dark:text-slate-500 text-sm py-4">
                 <p className="mb-2">Tente perguntar:</p>
                 <ul className="text-xs space-y-1 italic">
                    <li>"Todas as contas a pagar deste mês"</li>
                    <li>"Quanto recebi do Itau?"</li>
                    <li>"Verificar pagamentos pendentes"</li>
                 </ul>
               </div>
             )}
             
             {isLoading && (
               <div className="flex flex-col items-center justify-center py-6 gap-2">
                 <Loader2 className="h-6 w-6 text-blue-500 animate-spin" />
                 <span className="text-xs text-slate-400">Analisando sua pergunta...</span>
               </div>
             )}

             {lastResponse && (
               <div className="flex gap-3 animate-in fade-in slide-in-from-bottom-2">
                 <div className="bg-blue-100 dark:bg-blue-900/30 p-2 rounded-full h-8 w-8 flex items-center justify-center shrink-0">
                    <Bot className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                 </div>
                 <div className="bg-white dark:bg-slate-800 p-3 rounded-lg rounded-tl-none border border-slate-200 dark:border-slate-700 text-sm text-slate-700 dark:text-slate-200 shadow-sm">
                   <p className="font-semibold text-xs text-blue-600 dark:text-blue-400 mb-1">Ação Realizada:</p>
                   {lastResponse}
                 </div>
               </div>
             )}
          </div>

          <form onSubmit={handleSubmit} className="p-3 bg-white dark:bg-slate-900 border-t border-slate-100 dark:border-slate-800 flex gap-2">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Digite aqui..."
              className="flex-1 bg-slate-50 dark:bg-slate-800 border-0 rounded-lg px-3 py-2 text-sm text-slate-800 dark:text-white placeholder:text-slate-400 focus:ring-2 focus:ring-blue-500 outline-none transition-colors"
            />
            <button
              type="submit"
              disabled={isLoading || !query.trim()}
              className="bg-blue-600 text-white p-2 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-md shadow-blue-600/20"
            >
              <Send className="h-4 w-4" />
            </button>
          </form>
        </div>
      )}
    </>
  );
};

export default AIAssistant;