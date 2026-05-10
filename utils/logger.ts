type LogMethod = 'debug' | 'info' | 'warn' | 'error';

const DEBUG_STORAGE_KEY = 'sp_debug_logs';

const isLoggingEnabled = (): boolean => {
  if (import.meta.env.DEV) return true;

  try {
    return window.localStorage.getItem(DEBUG_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
};

const emit = (method: LogMethod, ...args: unknown[]) => {
  if (!isLoggingEnabled()) return;
  console[method](...args);
};

export const logger = {
  debug: (...args: unknown[]) => emit('debug', ...args),
  info: (...args: unknown[]) => emit('info', ...args),
  warn: (...args: unknown[]) => emit('warn', ...args),
  error: (...args: unknown[]) => emit('error', ...args),
};
