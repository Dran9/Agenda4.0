import { useState, useEffect } from 'react';
import AdminLayout from '../../components/AdminLayout';
import { api } from '../../utils/api';

const STATUS_COLORS = {
  Nuevo: 'bg-blue-100 text-blue-700',
  Activo: 'bg-green-100 text-green-700',
  Recurrente: 'bg-green-100 text-green-700',
  'En pausa': 'bg-yellow-100 text-yellow-700',
  Inactivo: 'bg-gray-100 text-gray-600',
  Archivado: 'bg-red-100 text-red-600',
};

export default function Clients() {
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  useEffect(() => {
    api.get('/clients')
      .then(setClients)
      .catch(err => console.error(err))
      .finally(() => setLoading(false));
  }, []);

  async function handleFeeChange(id, fee) {
    try {
      await api.put(`/clients/${id}`, { fee: parseFloat(fee) });
      setClients(prev => prev.map(c => c.id === id ? { ...c, fee } : c));
    } catch (err) {
      console.error(err);
    }
  }

  const filtered = clients.filter(c => {
    if (!search) return true;
    const s = search.toLowerCase();
    return c.first_name?.toLowerCase().includes(s) || c.last_name?.toLowerCase().includes(s) || c.phone?.includes(s);
  });

  return (
    <AdminLayout title="Clientes">
      <div className="mb-4">
        <input
          type="text"
          placeholder="Buscar por nombre o teléfono..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full max-w-sm px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-300"
        />
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
        {loading ? (
          <div className="p-8 text-center text-gray-400">Cargando...</div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="text-xs text-gray-500 border-b border-gray-100">
                <th className="text-left p-3 font-medium">Nombre</th>
                <th className="text-left p-3 font-medium">Teléfono</th>
                <th className="text-left p-3 font-medium">Ciudad</th>
                <th className="text-left p-3 font-medium">Status</th>
                <th className="text-left p-3 font-medium">Sesiones</th>
                <th className="text-left p-3 font-medium">Arancel</th>
                <th className="text-left p-3 font-medium">Fuente</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(client => (
                <tr key={client.id} className="border-b border-gray-50 hover:bg-gray-50">
                  <td className="p-3 text-sm font-medium">{client.first_name} {client.last_name}</td>
                  <td className="p-3 text-sm">
                    <a href={`https://wa.me/${client.phone}`} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">
                      {client.phone}
                    </a>
                  </td>
                  <td className="p-3 text-sm text-gray-600">{client.city}</td>
                  <td className="p-3">
                    <span className={`text-xs px-2 py-1 rounded-full font-medium ${STATUS_COLORS[client.calculated_status] || 'bg-gray-100 text-gray-600'}`}>
                      {client.calculated_status}
                    </span>
                  </td>
                  <td className="p-3 text-sm text-center">{client.completed_sessions || 0}</td>
                  <td className="p-3">
                    <input
                      type="number"
                      value={client.fee || ''}
                      onChange={e => handleFeeChange(client.id, e.target.value)}
                      className="w-20 text-sm px-2 py-1 border border-gray-200 rounded text-right"
                    />
                  </td>
                  <td className="p-3 text-sm text-gray-600">{client.source}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </AdminLayout>
  );
}
