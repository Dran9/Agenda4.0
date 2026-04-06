import { useState, useEffect } from 'react';
import { Plus, Trash2, X, Search, Repeat } from 'lucide-react';
import AdminLayout from '../../components/AdminLayout';
import { api } from '../../utils/api';
import { useToast, Toast } from '../../hooks/useToast';
import { formatTimeBolivia, formatWeekdayShort, getBoliviaDateKey } from '../../utils/dates';

const DEFAULT_STATUSES = [
  { name: 'Nuevo', color: '#3B82F6' },
  { name: 'Activo', color: '#10B981' },
  { name: 'Recurrente', color: '#059669' },
  { name: 'En pausa', color: '#F59E0B' },
  { name: 'Inactivo', color: '#9CA3AF' },
  { name: 'Archivado', color: '#EF4444' },
];

const DEFAULT_SOURCES = [
  'Referencia de amigos', 'Redes sociales', 'Otro',
];

const TIMEZONES = [
  'America/La_Paz', 'America/Lima', 'America/Bogota', 'America/Santiago',
  'America/Buenos_Aires', 'America/Mexico_City', 'America/New_York',
  'Europe/Madrid', 'UTC',
];

function normalizePhoneInput(value) {
  return String(value || '').replace(/\D/g, '');
}

function statusStyle(color) {
  return {
    backgroundColor: color + '20',
    color: color,
    borderColor: color + '40',
  };
}

function retentionStyle(status) {
  if (status === 'Con cita') return { backgroundColor: '#DBEAFE', color: '#1D4ED8' };
  if (status === 'Recurrente') return { backgroundColor: '#DBEAFE', color: '#1D4ED8' };
  if (status === 'En pausa') return { backgroundColor: '#FEF3C7', color: '#B45309' };
  if (status === 'Al día') return { backgroundColor: '#D1FAE5', color: '#047857' };
  if (status === 'En riesgo') return { backgroundColor: '#FEF3C7', color: '#B45309' };
  if (status === 'Perdido') return { backgroundColor: '#FEE2E2', color: '#B91C1C' };
  return { backgroundColor: '#E5E7EB', color: '#4B5563' };
}

function buildRecurringForm(schedule, client) {
  return {
    day_of_week: schedule?.day_of_week ?? '',
    time: schedule?.time ?? (client?.last_session ? formatTimeBolivia(client.last_session) : ''),
    started_at: schedule?.started_at || getBoliviaDateKey(),
    notes: schedule?.notes || '',
  };
}

const WEEKDAY_OPTIONS = [
  { value: 1, label: 'Lunes' },
  { value: 2, label: 'Martes' },
  { value: 3, label: 'Miércoles' },
  { value: 4, label: 'Jueves' },
  { value: 5, label: 'Viernes' },
  { value: 6, label: 'Sábado' },
  { value: 0, label: 'Domingo' },
];

export default function Clients() {
  const [clients, setClients] = useState([]);
  const [recurringSchedules, setRecurringSchedules] = useState([]);
  const [loading, setLoading] = useState(true);
  const { toast, show: showToast } = useToast();
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState(new Set());
  const [showCreate, setShowCreate] = useState(false);
  const [editClient, setEditClient] = useState(null);
  const [statuses, setStatuses] = useState(DEFAULT_STATUSES);
  const [sources, setSources] = useState(DEFAULT_SOURCES);
  const [newStatus, setNewStatus] = useState('');
  const [newSource, setNewSource] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadClients();
    loadRecurringSchedules();
    loadConfig();
  }, []);

  async function loadClients() {
    try {
      const data = await api.get('/clients');
      setClients(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  async function loadRecurringSchedules() {
    try {
      const data = await api.get('/recurring');
      setRecurringSchedules(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error(err);
    }
  }

  async function loadConfig() {
    try {
      const cfg = await api.get('/config');
      if (cfg.custom_statuses) {
        const s = typeof cfg.custom_statuses === 'string' ? JSON.parse(cfg.custom_statuses) : cfg.custom_statuses;
        if (s.length > 0) setStatuses(s);
      }
      if (cfg.custom_sources) {
        const s = typeof cfg.custom_sources === 'string' ? JSON.parse(cfg.custom_sources) : cfg.custom_sources;
        if (s.length > 0) setSources(s);
      }
    } catch (err) {
      console.error(err);
    }
  }

  async function handleUpdate(id, field, value) {
    try {
      await api.put(`/clients/${id}`, { [field]: value });
      setClients(prev => prev.map(c => c.id === id ? { ...c, [field]: value, calculated_status: field === 'status_override' ? value : c.calculated_status } : c));
    } catch (err) {
      console.error(err);
    }
  }

  async function handleDelete(id) {
    if (!confirm('Eliminar este cliente? (soft delete)')) return;
    try {
      await api.delete(`/clients/${id}`);
      setClients(prev => prev.filter(c => c.id !== id));
      setSelected(prev => { const n = new Set(prev); n.delete(id); return n; });
    } catch (err) {
      showToast('Error: ' + err.message, 'error');
    }
  }

  async function handleBulkDelete() {
    if (selected.size === 0) return;
    if (!confirm(`Eliminar ${selected.size} cliente(s)?`)) return;
    try {
      for (const id of selected) {
        await api.delete(`/clients/${id}`);
      }
      setClients(prev => prev.filter(c => !selected.has(c.id)));
      setSelected(new Set());
    } catch (err) {
      showToast('Error: ' + err.message, 'error');
    }
  }

  async function handleCreate(data) {
    setSaving(true);
    try {
      const result = await api.post('/clients', data);
      if (result.existing) {
        showToast('Ya existe un cliente con ese teléfono', 'error');
      } else {
        setShowCreate(false);
        loadClients();
        loadRecurringSchedules();
      }
    } catch (err) {
      showToast('Error: ' + err.message, 'error');
    } finally {
      setSaving(false);
    }
  }

  async function addStatus() {
    if (!newStatus.trim()) return;
    const colors = ['#8B5CF6', '#EC4899', '#14B8A6', '#F97316', '#6366F1', '#84CC16'];
    const color = colors[statuses.length % colors.length];
    const updated = [...statuses, { name: newStatus.trim(), color }];
    setStatuses(updated);
    setNewStatus('');
    await api.put('/config', { custom_statuses: updated });
  }

  async function addSource() {
    if (!newSource.trim()) return;
    const updated = [...sources, newSource.trim()];
    setSources(updated);
    setNewSource('');
    await api.put('/config', { custom_sources: updated });
  }

  function toggleSelectAll() {
    if (selected.size === filtered.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(filtered.map(c => c.id)));
    }
  }

  function toggleSelect(id) {
    setSelected(prev => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  }

  const filtered = clients.filter(c => {
    if (!search) return true;
    const s = search.toLowerCase();
    const phoneSearch = normalizePhoneInput(search);
    return c.first_name?.toLowerCase().includes(s)
      || c.last_name?.toLowerCase().includes(s)
      || c.phone?.includes(s)
      || (phoneSearch && normalizePhoneInput(c.phone).includes(phoneSearch))
      || c.city?.toLowerCase().includes(s);
  });

  const recurringByClient = new Map();
  for (const schedule of recurringSchedules) {
    if (!recurringByClient.has(schedule.client_id)) {
      recurringByClient.set(schedule.client_id, schedule);
    }
  }

  return (
    <AdminLayout title="Clientes">
      <Toast toast={toast} />
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="Buscar nombre, teléfono, ciudad..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-300"
          />
        </div>

        <button
          type="button"
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-1.5 px-3 py-2 bg-gray-900 text-white rounded-lg text-sm font-medium hover:bg-gray-800"
        >
          <Plus size={16} />
          Crear cliente
        </button>

        {selected.size > 0 && (
          <button
            type="button"
            onClick={handleBulkDelete}
            className="flex items-center gap-1.5 px-3 py-2 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700"
          >
            <Trash2 size={16} />
            Eliminar ({selected.size})
          </button>
        )}

        <span className="text-xs text-gray-400 ml-auto">{filtered.length} cliente{filtered.length !== 1 ? 's' : ''}</span>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
        {loading ? (
          <div className="p-8 text-center text-gray-400">Cargando...</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-gray-500 border-b border-gray-100 bg-gray-50">
                <th className="p-3 w-10">
                  <input
                    type="checkbox"
                    checked={filtered.length > 0 && selected.size === filtered.length}
                    onChange={toggleSelectAll}
                    className="w-4 h-4 accent-black rounded"
                  />
                </th>
                <th className="text-left p-3 font-medium">Nombre</th>
                <th className="text-left p-3 font-medium">Apellido</th>
                <th className="text-left p-3 font-medium">Teléfono</th>
                <th className="text-left p-3 font-medium">Ciudad</th>
                <th className="text-left p-3 font-medium">País</th>
                <th className="text-left p-3 font-medium">Zona horaria</th>
                <th className="text-left p-3 font-medium">Status</th>
                <th className="text-left p-3 font-medium">Retención</th>
                <th className="text-left p-3 font-medium">Sesiones</th>
                <th className="text-left p-3 font-medium">Arancel</th>
                <th className="text-left p-3 font-medium">Fuente</th>
                <th className="text-left p-3 font-medium w-10"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(client => (
                <tr key={client.id} className="border-b border-gray-50 hover:bg-gray-50">
                  <td className="p-3">
                    <input
                      type="checkbox"
                      checked={selected.has(client.id)}
                      onChange={() => toggleSelect(client.id)}
                      className="w-4 h-4 accent-black rounded"
                    />
                  </td>
                  <td className="p-3 font-medium cursor-pointer hover:text-blue-600" onClick={() => setEditClient(client)}>
                    <div className="space-y-1">
                      <div>{client.first_name}</div>
                      {recurringByClient.get(client.id)?.is_active ? (
                        <div className="space-y-1">
                          <span className="inline-flex w-fit items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 text-xs font-semibold text-blue-700">
                            <Repeat size={12} />
                            Semanal
                          </span>
                          <div className="text-[11px] font-medium text-blue-700">
                            {formatWeekdayShort(recurringByClient.get(client.id).day_of_week)} {recurringByClient.get(client.id).time}
                          </div>
                        </div>
                      ) : null}
                    </div>
                  </td>
                  <td className="p-3 cursor-pointer hover:text-blue-600" onClick={() => setEditClient(client)}>
                    {client.last_name}
                  </td>
                  <td className="p-3">
                    <a href={`https://wa.me/${client.phone}`} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">
                      {client.phone}
                    </a>
                  </td>
                  <td className="p-3 text-gray-600">{client.city || '-'}</td>
                  <td className="p-3 text-gray-600">{client.country || '-'}</td>
                  <td className="p-3 text-gray-500 text-xs">{(client.timezone || 'America/La_Paz').replace('America/', '')}</td>
                  <td className="p-3">
                    <select
                      value={client.status_override || client.calculated_status || ''}
                      onChange={e => handleUpdate(client.id, 'status_override', e.target.value || null)}
                      className="text-xs px-2 py-1 rounded-full font-medium border-0 cursor-pointer"
                      style={statusStyle((statuses.find(s => s.name === (client.status_override || client.calculated_status))?.color) || '#9CA3AF')}
                    >
                      <option value="">Auto ({client.calculated_status})</option>
                      {statuses.map(s => (
                        <option key={s.name} value={s.name}>{s.name}</option>
                      ))}
                    </select>
                  </td>
                  <td className="p-3">
                    <div className="flex flex-col gap-1">
                      <span
                        className="inline-flex w-fit rounded-full px-2.5 py-1 text-xs font-semibold"
                        style={retentionStyle(client.retention_status)}
                      >
                        {client.retention_status || 'Sin dato'}
                      </span>
                      <span className="text-[11px] text-gray-400">
                        {client.days_since_last_session != null
                          ? `${client.days_since_last_session} día${client.days_since_last_session === 1 ? '' : 's'} desde última sesión`
                          : 'Sin sesiones completadas'}
                      </span>
                    </div>
                  </td>
                  <td className="p-3 text-center">{client.completed_sessions || 0}</td>
                  <td className="p-3">
                    <input
                      type="number"
                      value={client.fee || ''}
                      onChange={e => handleUpdate(client.id, 'fee', parseFloat(e.target.value))}
                      className="w-20 text-sm px-2 py-1 border border-gray-200 rounded text-right"
                    />
                  </td>
                  <td className="p-3">
                    <select
                      value={client.source || 'Otro'}
                      onChange={e => handleUpdate(client.id, 'source', e.target.value)}
                      className="text-xs px-2 py-1 border border-gray-200 rounded bg-white"
                    >
                      {sources.map(s => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </select>
                  </td>
                  <td className="p-3">
                    <button
                      type="button"
                      onClick={() => handleDelete(client.id)}
                      className="text-gray-300 hover:text-red-500 transition-colors"
                      title="Eliminar"
                    >
                      <Trash2 size={15} />
                    </button>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={13} className="p-8 text-center text-gray-400">Sin resultados</td></tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      {/* Add status/source inline */}
      <div className="mt-4 flex flex-wrap gap-4">
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={newStatus}
            onChange={e => setNewStatus(e.target.value)}
            placeholder="Nuevo status..."
            className="px-2 py-1.5 border border-gray-200 rounded-lg text-xs w-32"
            onKeyDown={e => e.key === 'Enter' && addStatus()}
          />
          <button type="button" onClick={addStatus} className="text-xs px-2 py-1.5 bg-gray-100 rounded-lg hover:bg-gray-200">+ Status</button>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={newSource}
            onChange={e => setNewSource(e.target.value)}
            placeholder="Nueva fuente..."
            className="px-2 py-1.5 border border-gray-200 rounded-lg text-xs w-32"
            onKeyDown={e => e.key === 'Enter' && addSource()}
          />
          <button type="button" onClick={addSource} className="text-xs px-2 py-1.5 bg-gray-100 rounded-lg hover:bg-gray-200">+ Fuente</button>
        </div>
      </div>

      {/* Create Client Modal */}
      {showCreate && (
        <CreateClientModal
          onClose={() => setShowCreate(false)}
          onCreate={handleCreate}
          saving={saving}
          sources={sources}
          statuses={statuses}
        />
      )}

      {/* Edit Client Modal */}
      {editClient && (
        <EditClientModal
          client={editClient}
          recurringSchedule={recurringByClient.get(editClient.id) || null}
          onClose={() => { setEditClient(null); loadClients(); loadRecurringSchedules(); }}
          onSave={handleUpdate}
          onRecurringChange={async () => {
            await Promise.all([loadClients(), loadRecurringSchedules()]);
          }}
          sources={sources}
          statuses={statuses}
          showToast={showToast}
        />
      )}
    </AdminLayout>
  );
}

function CreateClientModal({ onClose, onCreate, saving, sources }) {
  const [form, setForm] = useState({
    phone: '', first_name: '', last_name: '', age: '',
    city: 'Cochabamba', country: 'Bolivia', timezone: 'America/La_Paz',
    source: 'Otro', fee: '250', modality: 'Online',
  });

  function set(k, v) { setForm(f => ({ ...f, [k]: v })); }

  function handleSubmit(e) {
    e.preventDefault();
    onCreate({
      ...form,
      age: form.age ? parseInt(form.age) : undefined,
      fee: form.fee ? parseFloat(form.fee) : undefined,
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-6 shadow-xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold">Crear cliente</h3>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Nombre" required>
              <input value={form.first_name} onChange={e => set('first_name', e.target.value)} required className="input" />
            </Field>
            <Field label="Apellido" required>
              <input value={form.last_name} onChange={e => set('last_name', e.target.value)} required className="input" />
            </Field>
            <Field label="Teléfono" required>
              <input value={form.phone} onChange={e => set('phone', normalizePhoneInput(e.target.value))} required placeholder="59172034151" className="input" />
            </Field>
            <Field label="Edad">
              <input type="number" value={form.age} onChange={e => set('age', e.target.value)} className="input" />
            </Field>
            <Field label="Ciudad">
              <input value={form.city} onChange={e => set('city', e.target.value)} className="input" />
            </Field>
            <Field label="País">
              <input value={form.country} onChange={e => set('country', e.target.value)} className="input" />
            </Field>
            <Field label="Zona horaria">
              <select value={form.timezone} onChange={e => set('timezone', e.target.value)} className="input">
                {TIMEZONES.map(tz => <option key={tz} value={tz}>{tz.replace('America/', '')}</option>)}
              </select>
            </Field>
            <Field label="Modalidad">
              <select value={form.modality} onChange={e => set('modality', e.target.value)} className="input">
                <option>Presencial</option><option>Online</option><option>Mixto</option>
              </select>
            </Field>
            <Field label="Fuente">
              <select value={form.source} onChange={e => set('source', e.target.value)} className="input">
                {sources.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
            <Field label="Arancel (Bs)">
              <input type="number" value={form.fee} onChange={e => set('fee', e.target.value)} className="input" />
            </Field>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">Cancelar</button>
            <button type="submit" disabled={saving} className="px-4 py-2 text-sm bg-gray-900 text-white rounded-lg font-medium disabled:opacity-40 hover:bg-gray-800">
              {saving ? 'Creando...' : 'Crear cliente'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function getRecurringStatusMeta(schedule) {
  if (!schedule) return null;
  if (schedule.ended_at) {
    return { label: 'Finalizada', className: 'bg-gray-100 text-gray-600' };
  }
  if (schedule.paused_at) {
    return { label: 'Pausada', className: 'bg-amber-100 text-amber-700' };
  }
  return { label: 'Activa', className: 'bg-blue-100 text-blue-700' };
}

function EditClientModal({ client, recurringSchedule, onClose, onSave, onRecurringChange, sources, statuses, showToast }) {
  const [form, setForm] = useState({ ...client });
  const [saving, setSaving] = useState(false);
  const [currentSchedule, setCurrentSchedule] = useState(recurringSchedule);
  const [recurringForm, setRecurringForm] = useState(buildRecurringForm(recurringSchedule, client));
  const [savingRecurring, setSavingRecurring] = useState(false);

  function set(k, v) { setForm(f => ({ ...f, [k]: v })); }
  function setRecurringField(k, v) { setRecurringForm(f => ({ ...f, [k]: v })); }

  useEffect(() => {
    setForm({ ...client });
  }, [client]);

  useEffect(() => {
    setCurrentSchedule(recurringSchedule);
    setRecurringForm(buildRecurringForm(recurringSchedule, client));
  }, [recurringSchedule, client]);

  const recurringMeta = getRecurringStatusMeta(currentSchedule);
  const recurringIsActive = currentSchedule && !currentSchedule.ended_at && !currentSchedule.paused_at;
  const recurringCanEdit = currentSchedule && !currentSchedule.ended_at;

  async function refreshRecurring(nextSchedule) {
    setCurrentSchedule(nextSchedule);
    setRecurringForm(buildRecurringForm(nextSchedule, client));
    if (onRecurringChange) {
      await onRecurringChange();
    }
  }

  async function handleRecurringActivate() {
    if (recurringForm.day_of_week === '' || !recurringForm.time || !recurringForm.started_at) {
      showToast('Completa día, hora y fecha de inicio', 'error');
      return;
    }

    setSavingRecurring(true);
    try {
      const created = await api.post('/recurring', {
        client_id: client.id,
        day_of_week: Number(recurringForm.day_of_week),
        time: recurringForm.time,
        started_at: recurringForm.started_at,
        notes: recurringForm.notes || null,
      });
      await refreshRecurring(created);
      showToast('Sesión recurrente activada');
    } catch (err) {
      showToast('Error: ' + err.message, 'error');
    } finally {
      setSavingRecurring(false);
    }
  }

  async function handleRecurringUpdate() {
    if (!currentSchedule) return;
    if (recurringForm.day_of_week === '' || !recurringForm.time) {
      showToast('Completa día y hora', 'error');
      return;
    }

    setSavingRecurring(true);
    try {
      const updated = await api.put(`/recurring/${currentSchedule.id}`, {
        day_of_week: Number(recurringForm.day_of_week),
        time: recurringForm.time,
        notes: recurringForm.notes || null,
      });
      await refreshRecurring(updated);
      showToast('Sesión recurrente actualizada');
    } catch (err) {
      showToast('Error: ' + err.message, 'error');
    } finally {
      setSavingRecurring(false);
    }
  }

  async function handleRecurringAction(action) {
    if (!currentSchedule) return;
    setSavingRecurring(true);
    try {
      const updated = await api.put(`/recurring/${currentSchedule.id}/${action}`, {});
      await refreshRecurring(updated);
      showToast(
        action === 'pause'
          ? 'Sesión recurrente pausada'
          : action === 'resume'
            ? 'Sesión recurrente reactivada'
            : 'Sesión recurrente finalizada'
      );
    } catch (err) {
      showToast('Error: ' + err.message, 'error');
    } finally {
      setSavingRecurring(false);
    }
  }

  async function handleSave() {
    setSaving(true);
    try {
      const fields = ['first_name', 'last_name', 'phone', 'age', 'city', 'country', 'timezone', 'modality', 'frequency', 'source', 'referred_by', 'fee', 'payment_method', 'notes', 'diagnosis', 'status_override'];
      for (const f of fields) {
        if (form[f] !== client[f]) {
          await onSave(client.id, f, form[f]);
        }
      }
      onClose();
    } catch (err) {
      showToast('Error: ' + err.message, 'error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-6 shadow-xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold">Editar: {client.first_name} {client.last_name}</h3>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
        </div>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Nombre">
              <input value={form.first_name || ''} onChange={e => set('first_name', e.target.value)} className="input" />
            </Field>
            <Field label="Apellido">
              <input value={form.last_name || ''} onChange={e => set('last_name', e.target.value)} className="input" />
            </Field>
            <Field label="Teléfono">
              <input value={form.phone || ''} onChange={e => set('phone', normalizePhoneInput(e.target.value))} className="input" />
            </Field>
            <Field label="Edad">
              <input type="number" value={form.age || ''} onChange={e => set('age', parseInt(e.target.value) || null)} className="input" />
            </Field>
            <Field label="Ciudad">
              <input value={form.city || ''} onChange={e => set('city', e.target.value)} className="input" />
            </Field>
            <Field label="País">
              <input value={form.country || ''} onChange={e => set('country', e.target.value)} className="input" />
            </Field>
            <Field label="Zona horaria">
              <select value={form.timezone || 'America/La_Paz'} onChange={e => set('timezone', e.target.value)} className="input">
                {TIMEZONES.map(tz => <option key={tz} value={tz}>{tz.replace('America/', '')}</option>)}
              </select>
            </Field>
            <Field label="Modalidad">
              <select value={form.modality || 'Presencial'} onChange={e => set('modality', e.target.value)} className="input">
                <option>Presencial</option><option>Online</option><option>Mixto</option>
              </select>
            </Field>
            <Field label="Frecuencia">
              <select value={form.frequency || 'Semanal'} onChange={e => set('frequency', e.target.value)} className="input">
                <option>Semanal</option><option>Quincenal</option><option>Mensual</option><option>Irregular</option>
              </select>
            </Field>
            <Field label="Fuente">
              <select value={form.source || 'Otro'} onChange={e => set('source', e.target.value)} className="input">
                {sources.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
            <Field label="Referido por">
              <input value={form.referred_by || ''} onChange={e => set('referred_by', e.target.value)} className="input" />
            </Field>
            <Field label="Arancel (Bs)">
              <input type="number" value={form.fee || ''} onChange={e => set('fee', parseFloat(e.target.value))} className="input" />
            </Field>
            <Field label="Método de pago">
              <select value={form.payment_method || 'QR'} onChange={e => set('payment_method', e.target.value)} className="input">
                <option>QR</option><option>Efectivo</option><option>Transferencia</option>
              </select>
            </Field>
            <Field label="Status">
              <select value={form.status_override || ''} onChange={e => set('status_override', e.target.value || null)} className="input">
                <option value="">Auto ({client.calculated_status})</option>
                {statuses.map(s => <option key={s.name} value={s.name}>{s.name}</option>)}
              </select>
            </Field>
          </div>

          <Field label="Diagnóstico">
            <textarea value={form.diagnosis || ''} onChange={e => set('diagnosis', e.target.value)} rows={2} className="input" />
          </Field>
          <Field label="Notas">
            <textarea value={form.notes || ''} onChange={e => set('notes', e.target.value)} rows={2} className="input" />
          </Field>

          <div className="rounded-xl border border-gray-200 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-gray-900">Sesión recurrente</div>
                <div className="text-xs text-gray-400">Patrón semanal administrado desde la app.</div>
              </div>
              {recurringMeta ? (
                <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${recurringMeta.className}`}>
                  {recurringMeta.label}
                </span>
              ) : (
                <span className="rounded-full bg-gray-100 px-2.5 py-1 text-xs font-semibold text-gray-500">Sin activar</span>
              )}
            </div>

            {currentSchedule ? (
              <div className="mt-4 space-y-3">
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <div className="text-xs text-gray-400">Inicio</div>
                    <div className="font-medium text-gray-700">{currentSchedule.started_at || '—'}</div>
                  </div>
                  <div>
                    <div className="text-xs text-gray-400">Último estado</div>
                    <div className="font-medium text-gray-700">
                      {currentSchedule.ended_at
                        ? `Finalizada el ${currentSchedule.ended_at}`
                        : currentSchedule.paused_at
                          ? `Pausada desde ${currentSchedule.paused_at}`
                          : 'Activa ahora'}
                    </div>
                  </div>
                </div>

                {recurringCanEdit ? (
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Día">
                      <select
                        value={recurringForm.day_of_week}
                        onChange={e => setRecurringField('day_of_week', e.target.value)}
                        className="input"
                      >
                        <option value="">Selecciona</option>
                        {WEEKDAY_OPTIONS.map(option => (
                          <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Hora">
                      <input
                        type="time"
                        value={recurringForm.time}
                        onChange={e => setRecurringField('time', e.target.value)}
                        className="input"
                      />
                    </Field>
                    <div className="col-span-2">
                      <Field label="Notas">
                        <textarea
                          value={recurringForm.notes}
                          onChange={e => setRecurringField('notes', e.target.value)}
                          rows={2}
                          className="input"
                        />
                      </Field>
                    </div>
                  </div>
                ) : null}

                <div className="flex flex-wrap gap-2">
                  {recurringCanEdit ? (
                    <button
                      type="button"
                      onClick={handleRecurringUpdate}
                      disabled={savingRecurring}
                      className="rounded-lg bg-gray-900 px-3 py-2 text-xs font-medium text-white disabled:opacity-40"
                    >
                      Guardar recurrencia
                    </button>
                  ) : null}
                  {recurringIsActive ? (
                    <button
                      type="button"
                      onClick={() => handleRecurringAction('pause')}
                      disabled={savingRecurring}
                      className="rounded-lg bg-amber-100 px-3 py-2 text-xs font-medium text-amber-700 disabled:opacity-40"
                    >
                      Pausar
                    </button>
                  ) : null}
                  {currentSchedule && currentSchedule.paused_at && !currentSchedule.ended_at ? (
                    <button
                      type="button"
                      onClick={() => handleRecurringAction('resume')}
                      disabled={savingRecurring}
                      className="rounded-lg bg-blue-100 px-3 py-2 text-xs font-medium text-blue-700 disabled:opacity-40"
                    >
                      Reactivar
                    </button>
                  ) : null}
                  {currentSchedule && !currentSchedule.ended_at ? (
                    <button
                      type="button"
                      onClick={() => handleRecurringAction('end')}
                      disabled={savingRecurring}
                      className="rounded-lg bg-gray-100 px-3 py-2 text-xs font-medium text-gray-700 disabled:opacity-40"
                    >
                      Finalizar
                    </button>
                  ) : null}
                </div>
              </div>
            ) : null}

            {(!currentSchedule || currentSchedule.ended_at) ? (
              <div className="mt-4 space-y-3 border-t border-gray-100 pt-4">
                <div className="text-sm font-medium text-gray-700">Activar semanal</div>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Día">
                    <select
                      value={recurringForm.day_of_week}
                      onChange={e => setRecurringField('day_of_week', e.target.value)}
                      className="input"
                    >
                      <option value="">Selecciona</option>
                      {WEEKDAY_OPTIONS.map(option => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Hora">
                    <input
                      type="time"
                      value={recurringForm.time}
                      onChange={e => setRecurringField('time', e.target.value)}
                      className="input"
                    />
                  </Field>
                  <Field label="Fecha de inicio">
                    <input
                      type="date"
                      value={recurringForm.started_at}
                      onChange={e => setRecurringField('started_at', e.target.value)}
                      className="input"
                    />
                  </Field>
                  <div className="text-xs text-gray-400">
                    {client.last_session
                      ? `Sugerencia tomada de la última sesión: ${formatTimeBolivia(client.last_session)}`
                      : 'Puedes definir la hora manualmente.'}
                  </div>
                  <div className="col-span-2">
                    <Field label="Notas">
                      <textarea
                        value={recurringForm.notes}
                        onChange={e => setRecurringField('notes', e.target.value)}
                        rows={2}
                        className="input"
                      />
                    </Field>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleRecurringActivate}
                  disabled={savingRecurring}
                  className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-medium text-white disabled:opacity-40"
                >
                  Activar semanal
                </button>
              </div>
            ) : null}
          </div>

          {/* Info */}
          <div className="grid grid-cols-3 gap-3 pt-2 border-t border-gray-100 text-xs text-gray-400">
            <div>Sesiones: <span className="text-gray-700 font-medium">{client.completed_sessions || 0}</span></div>
            <div>Reagendamientos: <span className="text-gray-700 font-medium">{client.reschedule_count || 0}</span></div>
            <div>Total citas: <span className="text-gray-700 font-medium">{client.total_appointments || 0}</span></div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">Cancelar</button>
            <button type="button" onClick={handleSave} disabled={saving} className="px-4 py-2 text-sm bg-gray-900 text-white rounded-lg font-medium disabled:opacity-40 hover:bg-gray-800">
              {saving ? 'Guardando...' : 'Guardar cambios'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, required, children }) {
  return (
    <div>
      <label className="block text-xs text-gray-500 mb-1">
        {label}{required && <span className="text-red-400"> *</span>}
      </label>
      {children}
    </div>
  );
}
