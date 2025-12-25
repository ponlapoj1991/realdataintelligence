
import React, { createContext, useContext, useCallback, ReactNode } from 'react';
import { ToastContextType, ToastType } from '../types';
import { toast as sonnerToast, Toaster } from 'sonner';
import { CheckCircle2, AlertCircle, Info, AlertTriangle } from 'lucide-react';

const ToastContext = createContext<ToastContextType | undefined>(undefined);

export const useToast = () => {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
};

interface ToastProviderProps {
  children: ReactNode;
}

const TOAST_DURATION = 4000;

const getToastIcon = (type: ToastType) => {
  switch (type) {
    case 'success': return <CheckCircle2 className="w-5 h-5 text-green-500" />;
    case 'error': return <AlertCircle className="w-5 h-5 text-red-500" />;
    case 'warning': return <AlertTriangle className="w-5 h-5 text-amber-500" />;
    default: return <Info className="w-5 h-5 text-blue-500" />;
  }
};

export const ToastProvider: React.FC<ToastProviderProps> = ({ children }) => {
  const showToast = useCallback((title: string, message?: string, type: ToastType = 'info') => {
    const opts = {
      description: message,
      duration: TOAST_DURATION,
      icon: getToastIcon(type),
    };

    if (type === 'success') {
      sonnerToast.success(title, opts);
      return;
    }
    if (type === 'error') {
      sonnerToast.error(title, opts);
      return;
    }
    if (type === 'warning') {
      sonnerToast.warning(title, opts);
      return;
    }
    sonnerToast(title, opts);
  }, []);

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <Toaster position="bottom-right" richColors closeButton />
    </ToastContext.Provider>
  );
};
