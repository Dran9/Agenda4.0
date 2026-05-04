import { useState, useEffect, useCallback } from 'react';
import { api } from '../api';

const ACTIONS = [
  { id: 'reschedule', label: 'Reagendar', icon: '🔄', color: 'bg-blue-500' },
  { id: 'cancel', label: 'Cancelar', icon: '❌', color: 'bg-red-500' },
  { id: 'noshow', label: 'No-show', icon: '🚫', color: 'bg-slate-500' },
  { id: 'reminder', label: 'Recordar cita', icon: '🔔', color: 'bg-emerald-500' },
  { id: 'payment-reminder', label: 'Recordar cobro', icon: '💳', color: 'bg-teal-500' },
  { id: 'recurring', label: 'Recurrencia', icon: '🔁', color: 'bg-violet-500' },
  { id: 'fee', label: 'Actualizar arancel', icon: '💰', color: 'bg-amber-500' },
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
      <div className="bg-white rounded-xl border border-gray-200 p-6 text-center">
        <div className="text-4xl mb-3">{result.success ? '✅' : '❌'}</div>
        <p className={`font-semibold ${result.success ? 'text-green-600' : 'text-red-600'}`}>
          {result.success ? 'Acción completada' : 'Error'}
        </p>
        {result.error && <p className="text-sm text-gray-500 mt-2">{result.error}</p>}
        <button
          type="button"
          onClick={reset}
          className="mt-4 px-4 py-2 bg-[#4E769B] text-white rounded-lg text-sm font-medium w-full"
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
            className="w-full px-4 py-3 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-[#4E769B]"
            autoFocus
          />
        </div>

        <div className="space-y-2">
          {clients.map((client) => (
            <button
              key={client.id}
              type="button"
              onClick={() => setSelectedClient(client)}
              className="w-full text-left bg-white rounded-xl border border-gray-200 p-3 active:bg-gray-50"
            >
              <p className="font-medium text-gray-900 text-sm">{client.first_name} {client.last_name}</p>
              <p className="text-xs text-gray-500">{client.phone}</p>
            </button>
          ))}
        </div>
      </div>
    );
  }

  if (!selectedAction) {
    return (
      <div className="space-y-3">
        <div className="bg-[#4E769B] text-white rounded-xl p-3 mb-4">
          <p className="font-semibold text-sm">{selectedClient.first_name} {selectedClient.last_name}</p>
          <p className="text-xs opacity-80">{selectedClient.phone}</p>
        </div>

        <div className="grid grid-cols-2 gap-2">
          {ACTIONS.map((action) => (
            <button
              key={action.id}
              type="button"
              onClick={() => setSelectedAction(action.id)}
              className="bg-white rounded-xl border border-gray-200 p-4 text-center active:bg-gray-50"
            >
              <div className="text-2xl mb-1">{action.icon}</div>
              <p className="text-xs font-medium text-gray-700">{action.label}</p>
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={() => setSelectedClient(null)}
          className="w-full py-2 text-sm text-gray-500"
        >
          ← Cambiar cliente
        </button>
      </div>
    );
  }

  // Action confirmation
  const action = ACTIONS.find(a => a.id === selectedAction);

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <p className="text-sm text-gray-500">Cliente</p>
        <p className="font-semibold text-gray-900">{selectedClient.first_name} {selectedClient.last_name}</p>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <p className="text-sm text-gray-500">Acción</p>
        <div className="flex items-center gap-2 mt-1">
          <span className="text-2xl">{action.icon}</span>
          <p className="font-semibold text-gray-900">{action.label}</p>
        </div>
      </div>

      {selectedAction === 'fee' && (
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <label className="text-sm text-gray-500 block mb-2">Nuevo arancel (Bs)</label>
          <input
            type="number"
            value={feeValue}
            onChange={(e) => setFeeValue(e.target.value)}
            placeholder="250"
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-[#4E769B]"
            autoFocus
          />
        </div>
      )}

      <button
        type="button"
        onClick={executeAction}
        disabled={loading || (selectedAction === 'fee' && !feeValue)}
        className="w-full py-3 bg-[#4E769B] text-white rounded-xl font-semibold text-sm disabled:opacity-50"
      >
        {loading ? 'Procesando...' : 'Confirmar'}
      </button>

      <button
        type="button"
        onClick={() => { setSelectedAction(null); setFeeValue(''); }}
        className="w-full py-2 text-sm text-gray-500"
      >
        ← Volver
      </button>
    </div>
  );
}
