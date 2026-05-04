import { useState, useEffect, useCallback } from 'react';
import { api } from '../api';

const ACTIONS = [
  { 
    id: 'reschedule', 
    label: 'Reagendar', 
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/>
        <path d="M3 3v5h5"/>
        <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/>
        <path d="M16 21h5v-5"/>
      </svg>
    ),
    color: '#4E769B',
    bg: '#CFE8E9'
  },
  { 
    id: 'cancel', 
    label: 'Cancelar', 
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
        <line x1="16" y1="2" x2="16" y2="6"/>
        <line x1="8" y1="2" x2="8" y2="6"/>
        <line x1="3" y1="10" x2="21" y2="10"/>
        <line x1="9" y1="15" x2="15" y2="15"/>
      </svg>
    ),
    color: '#B34E35',
    bg: '#FEE2E2'
  },
  { 
    id: 'noshow', 
    label: 'No-show', 
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/>
        <circle cx="9" cy="7" r="4"/>
        <line x1="17" y1="8" x2="22" y2="13"/>
        <line x1="22" y1="8" x2="17" y2="13"/>
      </svg>
    ),
    color: '#64748B',
    bg: '#F1F5F9'
  },
  { 
    id: 'reminder', 
    label: 'Recordar cita', 
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/>
        <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>
        <path d="M4 2C2.8 3.7 2 5.7 2 8"/>
        <path d="M22 8c0-2.3-.8-4.3-2-6"/>
      </svg>
    ),
    color: '#047857',
    bg: '#D1FAE5'
  },
  { 
    id: 'payment-reminder', 
    label: 'Recordar cobro', 
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="1" y="4" width="22" height="16" rx="2" ry="2"/>
        <line x1="1" y1="10" x2="23" y2="10"/>
      </svg>
    ),
    color: '#0F766E',
    bg: '#CCFBF1'
  },
  { 
    id: 'recurring', 
    label: 'Recurrencia', 
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="17 1 21 5 17 9"/>
        <path d="M3 11V9a4 4 0 0 1 4-4h14"/>
        <polyline points="7 23 3 19 7 15"/>
        <path d="M21 13v2a4 4 0 0 1-4 4H3"/>
      </svg>
    ),
    color: '#7C3AED',
    bg: '#EDE9FE'
  },
  { 
    id: 'fee', 
    label: 'Actualizar arancel', 
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10"/>
        <line x1="12" y1="8" x2="12" y2="12"/>
        <line x1="12" y1="16" x2="12.01" y2="16"/>
      </svg>
    ),
    color: '#B45309',
    bg: '#FEF3C7'
  },
];

export default function QuickActions() {
  const [clients, setClients] = useState([]);
  const [search, setSearch] = useState('');
  const [selectedClient, setSelectedClient] = useState(null);
  const [selectedAction, setSelectedAction] = useState(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [feeValue, setFeeValue] = useState('');

  const searchClients = useCallback(async (q) => {
    if (!q || q.length < 2) { setClients([]); return; }
    try {
      const res = await api.get(`/quick-actions/clients?q=${encodeURIComponent(q)}`);
      setClients(res || []);
    } catch (err) {
      console.error(err);
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => searchClients(search), 300);
    return () => clearTimeout(timer);
  }, [search, searchClients]);

  const executeAction = async () => {
    if (!selectedClient || !selectedAction) return;
    setLoading(true);
    setResult(null);

    try {
      let payload = { client_id: selectedClient.id };
      if (selectedAction === 'fee') {
        payload.fee = parseInt(feeValue, 10);
      }

      const res = await api.post(`/quick-actions/${selectedAction === 'recurring' ? 'manage-recurring' : selectedAction}`, payload);
      setResult({ success: true, data: res });
    } catch (err) {
      setResult({ success: false, error: err.message });
    } finally {
      setLoading(false);
    }
  };

  const reset = () => {
    setSelectedClient(null);
    setSelectedAction(null);
    setResult(null);
    setFeeValue('');
    setSearch('');
    setClients([]);
  };

  if (result) {
    return (
      <div 
        className="rounded-2xl p-6 text-center"
        style={{ backgroundColor: '#FFFFFF', border: '1px solid #E6E6E6' }}
      >
        <div 
          className="w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-4"
          style={{ 
            backgroundColor: result.success ? '#D1FAE5' : '#FEE2E2',
            color: result.success ? '#047857' : '#B34E35'
          }}
        >
          {result.success ? (
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12"/>
            </svg>
          ) : (
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"/>
              <line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          )}
        </div>
        <p className="font-semibold text-base" style={{ color: result.success ? '#047857' : '#B34E35' }}>
          {result.success ? 'Acción completada' : 'Error'}
        </p>
        {result.error && <p className="text-sm mt-2" style={{ color: '#A4A4A6' }}>{result.error}</p>}
        <button
          type="button"
          onClick={reset}
          className="mt-5 w-full py-3 text-white font-semibold text-sm rounded-2xl"
          style={{ backgroundColor: '#4E769B' }}
        >
          Nueva acción
        </button>
      </div>
    );
  }

  if (!selectedClient) {
    return (
      <div className="space-y-3">
        <div className="relative">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar cliente..."
            className="w-full px-4 py-3.5 text-sm rounded-2xl focus:outline-none"
            style={{ 
              backgroundColor: '#FFFFFF', 
              border: '1px solid #E6E6E6',
              color: '#3C3939'
            }}
            autoFocus
          />
          <svg 
            className="absolute right-4 top-1/2 -translate-y-1/2"
            width="18" height="18" 
            viewBox="0 0 24 24" 
            fill="none" 
            stroke="#C5C2C0" 
            strokeWidth="2" 
            strokeLinecap="round" 
            strokeLinejoin="round"
          >
            <circle cx="11" cy="11" r="8"/>
            <line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
        </div>

        <div className="space-y-2">
          {clients.map((client) => (
            <button
              key={client.id}
              type="button"
              onClick={() => setSelectedClient(client)}
              className="w-full text-left rounded-2xl p-4 transition-all active:scale-[0.98]"
              style={{ 
                backgroundColor: '#FFFFFF', 
                border: '1px solid #E6E6E6',
                boxShadow: '0 1px 3px rgba(0,0,0,0.04)'
              }}
            >
              <p className="font-semibold text-sm" style={{ color: '#3C3939' }}>
                {client.first_name} {client.last_name}
              </p>
              <p className="text-xs mt-0.5 font-medium" style={{ color: '#A4A4A6' }}>
                {client.phone}
              </p>
            </button>
          ))}
        </div>
      </div>
    );
  }

  if (!selectedAction) {
    return (
      <div className="space-y-4">
        {/* Client header */}
        <div 
          className="rounded-2xl p-4"
          style={{ 
            backgroundColor: '#4E769B',
            boxShadow: '0 4px 12px rgba(78,118,155,0.25)'
          }}
        >
          <p className="font-semibold text-sm text-white">
            {selectedClient.first_name} {selectedClient.last_name}
          </p>
          <p className="text-xs mt-0.5" style={{ color: 'rgba(255,255,255,0.7)' }}>
            {selectedClient.phone}
          </p>
        </div>

        {/* Actions grid */}
        <div className="grid grid-cols-2 gap-2">
          {ACTIONS.map((action) => (
            <button
              key={action.id}
              type="button"
              onClick={() => setSelectedAction(action.id)}
              className="rounded-2xl p-4 text-center transition-all active:scale-[0.97]"
              style={{ 
                backgroundColor: '#FFFFFF', 
                border: '1px solid #E6E6E6',
                boxShadow: '0 1px 3px rgba(0,0,0,0.04)'
              }}
            >
              <div 
                className="w-11 h-11 rounded-xl flex items-center justify-center mx-auto mb-2"
                style={{ backgroundColor: action.bg, color: action.color }}
              >
                {action.icon}
              </div>
              <p className="text-xs font-semibold" style={{ color: '#3C3939' }}>{action.label}</p>
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={() => setSelectedClient(null)}
          className="w-full py-3 text-sm font-medium"
          style={{ color: '#A4A4A6' }}
        >
          ← Cambiar cliente
        </button>
      </div>
    );
  }

  // Action confirmation
  const action = ACTIONS.find(a => a.id === selectedAction);

  return (
    <div className="space-y-3">
      <div 
        className="rounded-2xl p-4"
        style={{ backgroundColor: '#FFFFFF', border: '1px solid #E6E6E6' }}
      >
        <p className="text-xs font-medium uppercase tracking-wider" style={{ color: '#A4A4A6' }}>Cliente</p>
        <p className="font-semibold mt-1" style={{ color: '#3C3939' }}>
          {selectedClient.first_name} {selectedClient.last_name}
        </p>
      </div>

      <div 
        className="rounded-2xl p-4"
        style={{ backgroundColor: '#FFFFFF', border: '1px solid #E6E6E6' }}
      >
        <p className="text-xs font-medium uppercase tracking-wider" style={{ color: '#A4A4A6' }}>Acción</p>
        <div className="flex items-center gap-3 mt-2">
          <div 
            className="w-10 h-10 rounded-xl flex items-center justify-center"
            style={{ backgroundColor: action.bg, color: action.color }}
          >
            {action.icon}
          </div>
          <p className="font-semibold" style={{ color: '#3C3939' }}>{action.label}</p>
        </div>
      </div>

      {selectedAction === 'fee' && (
        <div 
          className="rounded-2xl p-4"
          style={{ backgroundColor: '#FFFFFF', border: '1px solid #E6E6E6' }}
        >
          <label className="text-xs font-medium uppercase tracking-wider block mb-2" style={{ color: '#A4A4A6' }}>
            Nuevo arancel (Bs)
          </label>
          <input
            type="number"
            value={feeValue}
            onChange={(e) => setFeeValue(e.target.value)}
            placeholder="250"
            className="w-full px-4 py-3 text-sm rounded-xl focus:outline-none"
            style={{ 
              backgroundColor: '#F0EEF0', 
              border: '1px solid #E6E6E6',
              color: '#3C3939'
            }}
            autoFocus
          />
        </div>
      )}

      <button
        type="button"
        onClick={executeAction}
        disabled={loading || (selectedAction === 'fee' && !feeValue)}
        className="w-full py-3.5 text-white font-semibold text-sm rounded-2xl transition-all active:scale-[0.98] disabled:opacity-50"
        style={{ backgroundColor: '#4E769B', boxShadow: '0 4px 12px rgba(78,118,155,0.25)' }}
      >
        {loading ? 'Procesando...' : 'Confirmar'}
      </button>

      <button
        type="button"
        onClick={() => { setSelectedAction(null); setFeeValue(''); }}
        className="w-full py-3 text-sm font-medium"
        style={{ color: '#A4A4A6' }}
      >
        ← Volver
      </button>
    </div>
  );
}
