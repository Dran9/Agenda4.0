import { useState, useEffect, useCallback } from 'react';
import { api, setToken, clearToken } from './api';
import Dashboard from './pages/Dashboard';
import QuickActions from './pages/QuickActions';
import ClientSearch from './pages/ClientSearch';

const PAGES = {
  dashboard: { label: 'Hoy', icon: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
      <line x1="16" y1="2" x2="16" y2="6"/>
      <line x1="8" y1="2" x2="8" y2="6"/>
      <line x1="3" y1="10" x2="21" y2="10"/>
    </svg>
  )},
  actions: { label: 'Comandos', icon: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/>
      <path d="M9 18h6"/>
      <path d="M10 22h4"/>
    </svg>
  )},
  clients: { label: 'Clientes', icon: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
      <circle cx="9" cy="7" r="4"/>
      <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
      <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
    </svg>
  )},
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
      <div className="flex items-center justify-center h-screen" style={{ backgroundColor: '#FAF8F1' }}>
        <div className="text-center">
          <div 
            className="w-10 h-10 rounded-full border-2 animate-spin mx-auto mb-4"
            style={{ borderColor: '#E6E6E6', borderTopColor: '#4E769B' }}
          ></div>
          <p className="text-sm" style={{ color: '#A4A4A6' }}>Conectando...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-screen p-4" style={{ backgroundColor: '#FAF8F1' }}>
        <div className="text-center">
          <p className="font-semibold mb-2" style={{ color: '#B34E35' }}>Error de conexión</p>
          <p className="text-sm mb-6" style={{ color: '#A4A4A6' }}>{error}</p>
          <button
            type="button"
            onClick={() => { clearToken(); setError(null); setLoading(true); authenticate(); }}
            className="px-5 py-2.5 text-white text-sm font-medium rounded-2xl"
            style={{ backgroundColor: '#4E769B' }}
          >
            Reintentar
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col" style={{ backgroundColor: '#FAF8F1' }}>
      {/* Header */}
      <header className="sticky top-0 z-20 px-4 pt-3 pb-2" style={{ backgroundColor: '#FAF8F1' }}>
        <div className="flex items-center justify-between">
          <div>
            <span 
              className="inline-block rounded-full px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] mb-1"
              style={{ backgroundColor: '#CFE8E9', color: '#4E769B' }}
            >
              Agenda Daniel MacLean
            </span>
            <h1 className="text-xl font-bold tracking-tight" style={{ color: '#3C3939' }}>
              {PAGES[page].label}
            </h1>
          </div>
          {auth?.photoUrl ? (
            <img src={auth.photoUrl} alt="" className="w-10 h-10 rounded-full object-cover ring-2 ring-white shadow-sm" />
          ) : (
            <div 
              className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold text-white shadow-sm"
              style={{ backgroundColor: '#4E769B' }}
            >
              {auth?.firstName?.[0] || 'D'}
            </div>
          )}
        </div>
      </header>

      {/* Content */}
      <main className="flex-1 px-4 pb-24">
        {page === 'dashboard' && <Dashboard />}
        {page === 'actions' && <QuickActions />}
        {page === 'clients' && <ClientSearch />}
      </main>

      {/* Bottom nav */}
      <nav 
        className="fixed bottom-0 left-0 right-0 border-t z-20 px-2 py-2"
        style={{ 
          backgroundColor: 'rgba(255,255,255,0.95)', 
          backdropFilter: 'blur(12px)',
          borderColor: '#E6E6E6'
        }}
      >
        <div className="flex justify-around items-center">
          {Object.entries(PAGES).map(([key, { label, icon }]) => (
            <button
              key={key}
              type="button"
              onClick={() => setPage(key)}
              className="flex flex-col items-center px-3 py-1.5 rounded-2xl transition-all duration-200"
              style={{
                color: page === key ? '#4E769B' : '#A4A4A6',
                backgroundColor: page === key ? '#CFE8E9' : 'transparent',
              }}
            >
              <span className="mb-0.5">{icon}</span>
              <span className="text-[11px] font-medium">{label}</span>
            </button>
          ))}
        </div>
      </nav>
    </div>
  );
}
