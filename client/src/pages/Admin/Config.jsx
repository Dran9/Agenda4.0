import { useState, useEffect } from 'react';
import AdminLayout from '../../components/AdminLayout';
import { api } from '../../utils/api';

export default function Config() {
  const [config, setConfig] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get('/config')
      .then(data => {
        if (typeof data.available_hours === 'string') data.available_hours = JSON.parse(data.available_hours);
        if (typeof data.available_days === 'string') data.available_days = JSON.parse(data.available_days);
        setConfig(data);
      })
      .catch(err => console.error(err))
      .finally(() => setLoading(false));
  }, []);

  async function handleSave() {
    setSaving(true);
    try {
      await api.put('/config', config);
      alert('Configuración guardada');
    } catch (err) {
      alert('Error: ' + err.message);
    } finally {
      setSaving(false);
    }
  }

  function handleChange(key, value) {
    setConfig(c => ({ ...c, [key]: value }));
  }

  async function handleQRUpload(key, file) {
    const formData = new FormData();
    formData.append('file', file);
    try {
      await api.upload(`/config/qr/${key}`, formData);
      alert('QR subido');
    } catch (err) {
      alert('Error: ' + err.message);
    }
  }

  if (loading) return <AdminLayout title="Configuración"><div className="text-gray-400">Cargando...</div></AdminLayout>;

  return (
    <AdminLayout title="Configuración">
      <div className="space-y-6 max-w-2xl">
        {/* Parameters */}
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <h3 className="font-semibold mb-4">Parámetros</h3>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Ventana de días</label>
              <input type="number" value={config?.window_days || ''} onChange={e => handleChange('window_days', parseInt(e.target.value))} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Buffer (horas)</label>
              <input type="number" value={config?.buffer_hours || ''} onChange={e => handleChange('buffer_hours', parseInt(e.target.value))} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Duración cita (min)</label>
              <input type="number" value={config?.appointment_duration || ''} onChange={e => handleChange('appointment_duration', parseInt(e.target.value))} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Hora recordatorio</label>
              <input type="time" value={config?.reminder_time || '18:40'} onChange={e => handleChange('reminder_time', e.target.value)} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Break inicio</label>
              <input type="time" value={config?.break_start || '13:00'} onChange={e => handleChange('break_start', e.target.value)} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Break fin</label>
              <input type="time" value={config?.break_end || '14:00'} onChange={e => handleChange('break_end', e.target.value)} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" />
            </div>
          </div>
        </div>

        {/* Fees */}
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <h3 className="font-semibold mb-4">Aranceles</h3>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Arancel genérico (Bs)</label>
              <input type="number" value={config?.default_fee || ''} onChange={e => handleChange('default_fee', parseFloat(e.target.value))} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Arancel capitales (Bs)</label>
              <input type="number" value={config?.capital_fee || ''} onChange={e => handleChange('capital_fee', parseFloat(e.target.value))} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" />
            </div>
            <div className="col-span-2">
              <label className="block text-xs font-medium text-gray-500 mb-1">Ciudades capitales</label>
              <input type="text" value={config?.capital_cities || ''} onChange={e => handleChange('capital_cities', e.target.value)} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" placeholder="Santa Cruz,La Paz" />
            </div>
          </div>
        </div>

        {/* QR uploads */}
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <h3 className="font-semibold mb-4">QR de pago</h3>
          <div className="grid grid-cols-2 gap-4">
            {['qr_300', 'qr_250', 'qr_150', 'qr_generico'].map(key => (
              <div key={key}>
                <label className="block text-xs font-medium text-gray-500 mb-1">{key.replace('qr_', 'Bs ').replace('generico', 'Genérico')}</label>
                <input type="file" accept="image/*" onChange={e => { if (e.target.files[0]) handleQRUpload(key, e.target.files[0]); }} className="text-xs" />
                <img src={`/api/config/qr/${key}`} alt="" className="mt-1 w-24 h-24 object-contain border rounded" onError={e => e.target.style.display = 'none'} />
              </div>
            ))}
          </div>
        </div>

        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="px-6 py-3 bg-gray-900 text-white rounded-lg font-medium disabled:opacity-40 hover:bg-gray-800 transition-colors"
        >
          {saving ? 'Guardando...' : 'Guardar configuración'}
        </button>
      </div>
    </AdminLayout>
  );
}
