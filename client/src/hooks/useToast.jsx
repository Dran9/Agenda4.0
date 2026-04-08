import { useState, useCallback } from 'react';
import { useUiTheme } from './useUiTheme';

export function useToast(duration = 3000) {
  const [toast, setToast] = useState(null);

  const show = useCallback((message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), duration);
  }, [duration]);

  return { toast, show };
}

// Inline toast component — render wherever needed
export function Toast({ toast }) {
  const { isDark } = useUiTheme();

  if (!toast) return null;
  const tone = toast.type === 'error'
    ? (
      isDark
        ? 'border border-red-400/30 bg-[rgba(127,29,29,0.92)] text-red-50'
        : 'border border-red-200 bg-white text-red-700'
    )
    : (
      isDark
        ? 'border border-[#d6b16b]/25 bg-[rgba(12,18,26,0.94)] text-[#f6efe2]'
        : 'border border-slate-200 bg-white text-slate-900'
    );
  return (
    <div className={`fixed top-4 right-4 z-50 ${tone} px-4 py-3 rounded-2xl shadow-[0_20px_48px_rgba(0,0,0,0.35)] text-sm font-medium animate-fade-in max-w-sm backdrop-blur-xl`}>
      {toast.message}
    </div>
  );
}
