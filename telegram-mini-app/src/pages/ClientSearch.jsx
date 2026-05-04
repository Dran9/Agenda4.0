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
          className="text-sm font-medium flex items-center gap-1"
          style={{ color: '#4E769B' }}
        >
          ← Volver
        </button>

        <div 
          className="rounded-2xl p-5"
          style={{ backgroundColor: '#FFFFFF', border: '1px solid #E6E6E6', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}
        >
          <h2 className="text-lg font-bold" style={{ color: '#3C3939' }}>{c.first_name} {c.last_name}</h2>
          <p className="text-sm mt-1 font-medium" style={{ color: '#A4A4A6' }}>{c.phone}</p>
          <div className="flex gap-2 mt-4">
            <span 
              className="text-[11px] font-bold px-3 py-1.5 rounded-full"
              style={{ backgroundColor: '#CFE8E9', color: '#4E769B' }}
            >
              {c.calculated_status || 'Nuevo'}
            </span>
            <span 
              className="text-[11px] font-bold px-3 py-1.5 rounded-full"
              style={{ backgroundColor: '#F0EEF0', color: '#A4A4A6' }}
            >
              {c.retention_status || 'Sin dato'}
            </span>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          {[
            { label: 'Arancel', value: `${c.fee_currency} ${c.fee}` },
            { label: 'Ciudad', value: c.city || '—' },
            { label: 'Modalidad', value: c.modality || '—' },
            { label: 'Frecuencia', value: c.frequency || '—' },
          ].map((item) => (
            <div 
              key={item.label}
              className="rounded-2xl p-4"
              style={{ backgroundColor: '#FFFFFF', border: '1px solid #E6E6E6' }}
            >
              <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: '#C5C2C0' }}>
                {item.label}
              </p>
              <p className="font-bold mt-1 text-sm" style={{ color: '#3C3939' }}>{item.value}</p>
            </div>
          ))}
        </div>

        {clientDetail.appointments?.length > 0 && (
          <div>
            <h3 className="text-xs font-bold uppercase tracking-[0.14em] mb-3" style={{ color: '#A4A4A6' }}>
              Historial de citas
            </h3>
            <div className="space-y-2">
              {clientDetail.appointments.slice(0, 5).map((appt) => (
                <div 
                  key={appt.id} 
                  className="rounded-2xl p-3"
                  style={{ backgroundColor: '#FFFFFF', border: '1px solid #E6E6E6' }}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium" style={{ color: '#3C3939' }}>
                      {formatDate(appt.date_time)}
                    </span>
                    <span 
                      className="text-[10px] font-bold px-2.5 py-1 rounded-full"
                      style={{
                        backgroundColor: appt.status === 'Completada' ? '#D1FAE5' : 
                                        appt.status === 'Cancelada' ? '#FEE2E2' : '#CFE8E9',
                        color: appt.status === 'Completada' ? '#047857' :
                               appt.status === 'Cancelada' ? '#B34E35' : '#085C6D'
                      }}
                    >
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

      {loading && (
        <div className="flex justify-center py-6">
          <div 
            className="w-6 h-6 rounded-full border-2 animate-spin"
            style={{ borderColor: '#E6E6E6', borderTopColor: '#4E769B' }}
          ></div>
        </div>
      )}

      <div className="space-y-2">
        {clients.map((client) => (
          <button
            key={client.id}
            type="button"
            onClick={() => { setSelectedClient(client); loadClientDetail(client.id); }}
            className="w-full text-left rounded-2xl p-4 transition-all active:scale-[0.98]"
            style={{ 
              backgroundColor: '#FFFFFF', 
              border: '1px solid #E6E6E6',
              boxShadow: '0 1px 3px rgba(0,0,0,0.04)'
            }}
          >
            <div className="flex items-center justify-between">
              <div>
                <p className="font-semibold text-sm" style={{ color: '#3C3939' }}>
                  {client.first_name} {client.last_name}
                </p>
                <p className="text-xs mt-0.5 font-medium" style={{ color: '#A4A4A6' }}>
                  {client.phone}
                </p>
              </div>
              <span className="text-xs font-medium" style={{ color: '#C5C2C0' }}>
                {client.city || ''}
              </span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
