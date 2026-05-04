import { useState, useEffect, useCallback } from 'react';
import { api } from '../api';

function formatDate(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  return d.toLocaleDateString('es-BO', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'America/La_Paz' });
}

export default function ClientSearch() {
  const [search, setSearch] = useState('');
  const [clients, setClients] = useState([]);
  const [selectedClient, setSelectedClient] = useState(null);
  const [clientDetail, setClientDetail] = useState(null);
  const [loading, setLoading] = useState(false);

  const searchClients = useCallback(async (q) => {
    if (!q || q.length < 2) { setClients([]); return; }
    try {
      setLoading(true);
      const res = await api.get(`/clients?search=${encodeURIComponent(q)}&limit=20`);
      setClients(Array.isArray(res) ? res : []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => searchClients(search), 300);
    return () => clearTimeout(timer);
  }, [search, searchClients]);

  const loadClientDetail = async (id) => {
    try {
      setLoading(true);
      const res = await api.get(`/clients/${id}`);
      setClientDetail(res);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  if (selectedClient && clientDetail) {
    const c = clientDetail.client || clientDetail;
    return (
      <div className="space-y-4">
        <button
          type="button"
          onClick={() => { setSelectedClient(null); setClientDetail(null); }}
          className="text-sm text-gray-500 flex items-center gap-1"
        >
          ← Volver
        </button>

        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <h2 className="text-lg font-bold text-gray-900">{c.first_name} {c.last_name}</h2>
          <p className="text-sm text-gray-500 mt-1">{c.phone}</p>
          <div className="flex gap-2 mt-3">
            <span className="text-xs px-2 py-1 rounded-full bg-blue-100 text-blue-700 font-medium">
              {c.calculated_status || 'Nuevo'}
            </span>
            <span className="text-xs px-2 py-1 rounded-full bg-gray-100 text-gray-600 font-medium">
              {c.retention_status || 'Sin dato'}
            </span>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="bg-white rounded-xl border border-gray-200 p-3">
            <p className="text-xs text-gray-400">Arancel</p>
            <p className="font-bold text-gray-900">{c.fee_currency} {c.fee}</p>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-3">
            <p className="text-xs text-gray-400">Ciudad</p>
            <p className="font-bold text-gray-900">{c.city || '—'}</p>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-3">
            <p className="text-xs text-gray-400">Modalidad</p>
            <p className="font-bold text-gray-900">{c.modality || '—'}</p>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-3">
            <p className="text-xs text-gray-400">Frecuencia</p>
            <p className="font-bold text-gray-900">{c.frequency || '—'}</p>
          </div>
        </div>

        {clientDetail.appointments?.length > 0 && (
          <div>
            <h3 className="text-sm font-bold text-gray-700 mb-2">Historial de citas</h3>
            <div className="space-y-2">
              {clientDetail.appointments.slice(0, 5).map((appt) => (
                <div key={appt.id} className="bg-white rounded-xl border border-gray-200 p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">{formatDate(appt.date_time)}</span>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                      appt.status === 'Completada' ? 'bg-green-100 text-green-700' :
                      appt.status === 'Cancelada' ? 'bg-red-100 text-red-700' :
                      'bg-blue-100 text-blue-700'
                    }`}>
                      {appt.status}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="relative">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar cliente por nombre o teléfono..."
          className="w-full px-4 py-3 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-[#4E769B]"
          autoFocus
        />
      </div>

      {loading && (
        <div className="flex justify-center py-4">
          <div className="w-5 h-5 border-2 border-gray-300 border-t-[#4E769B] rounded-full animate-spin"></div>
        </div>
      )}

      <div className="space-y-2">
        {clients.map((client) => (
          <button
            key={client.id}
            type="button"
            onClick={() => { setSelectedClient(client); loadClientDetail(client.id); }}
            className="w-full text-left bg-white rounded-xl border border-gray-200 p-3 active:bg-gray-50"
          >
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium text-gray-900 text-sm">{client.first_name} {client.last_name}</p>
                <p className="text-xs text-gray-500">{client.phone}</p>
              </div>
              <span className="text-xs text-gray-400">{client.city || ''}</span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
