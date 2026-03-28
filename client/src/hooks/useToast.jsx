import { useState, useCallback } from 'react';

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
  if (!toast) return null;
  const bg = toast.type === 'error' ? 'bg-red-600' : 'bg-gray-900';
  return (
    <div className={`fixed top-4 right-4 z-50 ${bg} text-white px-4 py-2.5 rounded-lg shadow-lg text-sm font-medium animate-fade-in max-w-sm`}>
      {toast.message}
    </div>
  );
}
