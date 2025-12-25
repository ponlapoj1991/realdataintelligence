
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
    case 'success': return <CheckCircle2 className="w-6 h-6 text-green-500" />;
    case 'error': return <AlertCircle className="w-6 h-6 text-red-500" />;
    case 'warning': return <AlertTriangle className="w-6 h-6 text-amber-500" />;
    default: return <Info className="w-6 h-6 text-blue-500" />;
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
      let id: any;
      id = sonnerToast.success(title, {
        ...opts,
        action: { label: 'Close', onClick: () => sonnerToast.dismiss(id) },
      });
      return;
    }
    if (type === 'error') {
      let id: any;
      id = sonnerToast.error(title, {
        ...opts,
        action: { label: 'Close', onClick: () => sonnerToast.dismiss(id) },
      });
      return;
    }
    if (type === 'warning') {
      let id: any;
      id = sonnerToast.warning(title, {
        ...opts,
        action: { label: 'Close', onClick: () => sonnerToast.dismiss(id) },
      });
      return;
    }
    let id: any;
    id = sonnerToast(title, {
      ...opts,
      action: { label: 'Close', onClick: () => sonnerToast.dismiss(id) },
    });
  }, []);

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <Toaster
        position="bottom-right"
        richColors={false}
        closeButton={false}
        toastOptions={{
          className:
            'rdi-toast bg-white border border-gray-200 shadow-lg rounded-xl px-4 py-3 min-w-[360px]',
          descriptionClassName: 'rdi-toast-desc text-gray-600',
          actionButtonClassName:
            'rdi-toast-action bg-transparent text-gray-700 hover:text-gray-900 font-medium px-2 py-1',
        }}
      />
    </ToastContext.Provider>
  );
};
