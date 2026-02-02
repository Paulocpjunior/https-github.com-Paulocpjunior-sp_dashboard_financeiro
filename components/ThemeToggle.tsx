import React, { useEffect, useState } from 'react';
import { Moon, Sun } from 'lucide-react';

export const ThemeToggle = () => {
  // Initialize state based on localStorage or system preference
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    if (typeof window !== 'undefined' && localStorage.getItem('theme')) {
      return localStorage.getItem('theme') as 'light' | 'dark';
    }
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  });

  useEffect(() => {
    const root = window.document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    localStorage.setItem('theme', theme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme(prev => prev === 'dark' ? 'light' : 'dark');
  };

  return (
    <button
      onClick={toggleTheme}
      className="p-2 rounded-full transition-all duration-300 ease-in-out focus:outline-none focus:ring-2 focus:ring-blue-500 
                 bg-slate-200 dark:bg-slate-700 text-slate-800 dark:text-yellow-300 hover:bg-slate-300 dark:hover:bg-slate-600"
      title={theme === 'dark' ? 'Mudar para Modo Claro' : 'Mudar para Modo Escuro'}
    >
      {theme === 'dark' ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
    </button>
  );
};