import React, { useState } from 'react';
import { Sparkles, Send, Loader2, X } from 'lucide-react';
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
      if (Object.keys(filters).length > 0) {
        onFiltersUpdate(filters);
      }
      setLastResponse(explanation);
      setQuery(''); // Clear input
    } catch (error) {
      setLastResponse('Erro ao processar sua solicitação.');
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
        <div className="fixed bottom-24 right-8 z-40 w-80 sm:w-96 bg-white rounded-2xl shadow-2xl border border-slate-100 overflow-hidden flex flex-col animate-in slide-in-from-bottom-10 fade-in duration-200">
          <div className="bg-gradient-to-r from-blue-600 to-indigo-600 p-4">
            <h3 className="text-white font-bold flex items-center gap-2">
              <Sparkles className="h-4 w-4" />
              IA Assistant
            </h3>
            <p className="text-blue-100 text-xs mt-1">
              Pergunte em linguagem natural para filtrar os dados.
            </p>
          </div>

          <div className="p-4 bg-slate-50 min-h-[120px] max-h-[200px] overflow-y-auto">
             {!lastResponse && !isLoading && (
               <div className="text-center text-slate-400 text-sm py-4">
                 Ex: "Mostre todas as entradas do Itau de Janeiro"
               </div>
             )}
             
             {isLoading && (
               <div className="flex justify-center py-4">
                 <Loader2 className="h-6 w-6 text-blue-500 animate-spin" />
               </div>
             )}

             {lastResponse && (
               <div className="bg-white p-3 rounded-lg border border-slate-200 text-sm text-slate-700 shadow-sm">
                 <p className="font-semibold text-xs text-blue-600 mb-1">Resposta da IA:</p>
                 {lastResponse}
               </div>
             )}
          </div>

          <form onSubmit={handleSubmit} className="p-3 bg-white border-t border-slate-100 flex gap-2">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Digite aqui..."
              className="flex-1 bg-slate-50 border-0 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
            />
            <button
              type="submit"
              disabled={isLoading || !query.trim()}
              className="bg-blue-600 text-white p-2 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
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
