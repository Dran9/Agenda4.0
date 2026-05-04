import { useState, useEffect, useCallback } from 'react';
import { api, setToken, clearToken } from './api';
import Dashboard from './pages/Dashboard';
import QuickActions from './pages/QuickActions';
import ClientSearch from './pages/ClientSearch';

const PAGES = {
  dashboard: 'Dashboard',
  actions: 'Acciones',
  clients: 'Clientes',
};

export default function App() {
  const [page, setPage] = useState('dashboard');
  const [auth, setAuth] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const authenticate = useCallback(async () => {
    try {
      const tg = window.Telegram?.WebApp;
      if (!tg) {
        throw new Error('Telegram WebApp no disponible');
      }

      tg.ready();
      tg.expand();

      const initData = tg.initData;
      if (!initData) {
        throw new Error('No initData de Telegram');
      }

      const res = await api.post('/auth/telegram', { initData });
      setToken(res.token);
      setAuth(res.user);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    authenticate();
  }, [authenticate]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-50">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-gray-300 border-t-[#4E769B] rounded-full animate-spin mx-auto mb-3"></div>
          <p className="text-sm text-gray-500">Conectando...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-50 p-4">
        <div className="text-center">
          <p className="text-red-600 font-medium mb-2">Error de conexión</p>
          <p className="text-sm text-gray-500 mb-4">{error}</p>
          <button
            type="button"
            onClick={() => { clearToken(); setError(null); setLoading(true); authenticate(); }}
            className="px-4 py-2 bg-[#4E769B] text-white rounded-lg text-sm font-medium"
          >
            Reintentar
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 pb-20">
      {/* Header */}
      <div className="bg-[#4E769B] text-white px-4 py-3 sticky top-0 z-10">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs opacity-80">Agenda Daniel MacLean</p>
            <h1 className="text-lg font-bold">{PAGES[page]}</h1>
          </div>
          {auth?.photoUrl ? (
            <img src={auth.photoUrl} alt="" className="w-8 h-8 rounded-full" />
          ) : (
            <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center text-sm font-bold">
              {auth?.firstName?.[0] || 'D'}
            </div>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="p-4">
        {page === 'dashboard' && <Dashboard />}
        {page === 'actions' && <QuickActions />}
        {page === 'clients' && <ClientSearch />}
      </div>

      {/* Bottom nav */}
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 flex justify-around py-2 z-10">
        {Object.entries(PAGES).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setPage(key)}
            className={`flex flex-col items-center px-4 py-1 text-xs font-medium ${
              page === key ? 'text-[#4E769B]' : 'text-gray-400'
            }`}
          >
            <span className="text-lg mb-0.5">
              {key === 'dashboard' && '📅'}
              {key === 'actions' && '⚡'}
              {key === 'clients' && '👥'}
            </span>
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}
