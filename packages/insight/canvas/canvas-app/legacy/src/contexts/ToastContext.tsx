import React, { createContext, useContext } from 'react';
import { toast as sonnerToast, type ExternalToast } from 'sonner';

interface GlobalContextType {
  toast: {
    success: (content: string, options?: ExternalToast) => void;
    error: (content: string, options?: ExternalToast) => void;
    warning: (content: string, options?: ExternalToast) => void;
    info: (content: string, options?: ExternalToast) => void;
  };
}

const createSafeToast = (type: 'success' | 'error' | 'warning' | 'info') => {
  return (content: string, options?: ExternalToast) => {
    requestAnimationFrame(() => {
      sonnerToast[type](content, options);
    });
  };
};

export const globalToast = {
  success: createSafeToast('success'),
  error: createSafeToast('error'),
  warning: createSafeToast('warning'),
  info: createSafeToast('info'),
};

const GlobalContext = createContext<GlobalContextType | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  return <GlobalContext.Provider value={{ toast: globalToast }}>{children}</GlobalContext.Provider>;
}

export function useGlobalToast() {
  const context = useContext(GlobalContext);
  if (!context) throw new Error('useGlobalToast must be used within ToastProvider');
  return context;
}
