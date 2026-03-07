
import React, { useState } from 'react';
import { BookmarkCheck, X, Plus, Save, Trash2 } from 'lucide-react';
import { FilterState } from '../types';

export interface SavedFilter {
  id: string;
  name: string;
  filters: FilterState;
}

interface SavedFiltersBarProps {
  savedFilters: SavedFilter[];
  onLoad: (id: string) => void;
  onSave: (name: string) => void;
  onDelete: (id: string) => void;
  hasActiveFilters: boolean;
}

export const SavedFiltersBar: React.FC<SavedFiltersBarProps> = ({
  savedFilters,
  onLoad,
  onSave,
  onDelete,
  hasActiveFilters
}) => {
  const [isSaving, setIsSaving] = useState(false);
  const [newFilterName, setNewFilterName] = useState('');

  const handleSave = () => {
    if (newFilterName.trim()) {
      onSave(newFilterName.trim());
      setNewFilterName('');
      setIsSaving(false);
    }
  };

  return (
    <div className="flex items-center gap-2 overflow-x-auto pb-2 scrollbar-thin scrollbar-thumb-slate-200 dark:scrollbar-thumb-slate-800">
      <div className="flex items-center gap-1.5 pr-2 border-r border-slate-200 dark:border-slate-700">
        <BookmarkCheck className="h-4 w-4 text-blue-500" />
        <span className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider whitespace-nowrap">
          Filtros Salvos
        </span>
      </div>

      <div className="flex items-center gap-2">
        {savedFilters.map((filter) => (
          <div 
            key={filter.id}
            className="group relative flex items-center"
          >
            <button
              onClick={() => onLoad(filter.id)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-full text-xs font-medium text-slate-600 dark:text-slate-300 hover:border-blue-500 dark:hover:border-blue-500 hover:text-blue-600 dark:hover:text-blue-400 transition-all whitespace-nowrap shadow-sm"
            >
              {filter.name}
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onDelete(filter.id);
              }}
              className="absolute -top-1 -right-1 h-4 w-4 bg-red-500 text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shadow-sm hover:bg-red-600"
              title="Excluir filtro"
            >
              <X className="h-2.5 w-2.5" />
            </button>
          </div>
        ))}

        {isSaving ? (
          <div className="flex items-center gap-1 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-full px-2 py-1 animate-in fade-in zoom-in-95 duration-200">
            <input
              autoFocus
              type="text"
              value={newFilterName}
              onChange={(e) => setNewFilterName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSave()}
              placeholder="Nome do filtro..."
              className="bg-transparent border-none outline-none text-xs text-blue-700 dark:text-blue-300 w-24 placeholder:text-blue-300"
            />
            <button 
              onClick={handleSave}
              className="p-1 text-blue-600 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-800 rounded-full"
            >
              <Save className="h-3 w-3" />
            </button>
            <button 
              onClick={() => setIsSaving(false)}
              className="p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        ) : (
          hasActiveFilters && (
            <button
              onClick={() => setIsSaving(true)}
              className="flex items-center gap-1 px-3 py-1.5 bg-blue-600 text-white rounded-full text-xs font-bold hover:bg-blue-700 transition-all shadow-md shadow-blue-500/20 whitespace-nowrap"
            >
              <Plus className="h-3 w-3" />
              Salvar Filtro Atual
            </button>
          )
        )}
      </div>

      {savedFilters.length === 0 && !isSaving && (
        <span className="text-[10px] text-slate-400 italic ml-2">
          Nenhum filtro salvo ainda.
        </span>
      )}
    </div>
  );
};
