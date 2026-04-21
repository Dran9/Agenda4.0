import { useState, useEffect, useCallback } from 'react';
import { Plus, Trash2, X, Search, Repeat, Download } from 'lucide-react';
import AdminLayout from '../../components/AdminLayout';
import InlineConfirmButton from '../../components/InlineConfirmButton';
import RecurringQuickModal from '../../components/RecurringQuickModal';
import { api } from '../../utils/api';
import { getRecurringSyncIssue, pickDefaultRecurringSource } from '../../utils/recurring';
import { useToast, Toast } from '../../hooks/useToast';
import useAdminEvents from '../../hooks/useAdminEvents';
import { formatTimeBolivia, formatWeekdayShort, getBoliviaDateKey } from '../../utils/dates';
import { TIMEZONE_OPTIONS } from '../../utils/timezones';

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

const TIMEZONE_SET = new Set(TIMEZONE_OPTIONS.map((option) => option.tz));

function getTimezoneOptions(currentTimezone) {
  if (currentTimezone && !TIMEZONE_SET.has(currentTimezone)) {
    return [{ tz: currentTimezone, label: currentTimezone }, ...TIMEZONE_OPTIONS];
  }
  return TIMEZONE_OPTIONS;
}

function parseForeignPricingProfiles(rawProfiles) {
  let parsed = rawProfiles;
  if (typeof parsed === 'string') {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      parsed = [];
    }
  }
  if (!Array.isArray(parsed)) return [];
  return parsed
    .map((profile) => {
      const key = String(profile?.key || '').trim();
      if (!key) return null;
      const amount = Number(profile?.amount);
      return {
        key,
        name: String(profile?.name || key).trim() || key,
        amount: Number.isFinite(amount) ? amount : 0,
        currency: String(profile?.currency || 'USD').toUpperCase() === 'BOB' ? 'BOB' : 'USD',
        stripe_fee_percent: Math.max(0, Number(profile?.stripe_fee_percent ?? 0) || 0),
        meru_fee_percent: Math.max(0, Number(profile?.meru_fee_percent ?? 0) || 0),
        stripe_fee_fixed: Math.max(0, Number(profile?.stripe_fee_fixed ?? 0) || 0),
        url: String(profile?.url || '').trim(),
      };
    })
    .filter(Boolean);
}

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

function formatShortDate(dateStr) {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString('es-BO', {
    day: '2-digit',
    month: 'short',
    year: '2-digit',
    timeZone: 'America/La_Paz',
  });
}

function formatClientLocation(client) {
  const parts = [client.city, client.country].filter(Boolean);
  return parts.length ? parts.join(', ') : 'Sin ubicación';
}

function formatRetentionInline(client) {
  const label = client.retention_status || 'Sin dato';
  if (client.days_since_last_session == null) return label;
  return `${label} · ${client.days_since_last_session}d`;
}

function formatRecurringInline(schedule) {
  if (!schedule || schedule.ended_at) return 'No recurrente';
  const slot = `${formatWeekdayShort(schedule.day_of_week)} ${schedule.time}`;
  return schedule.paused_at ? `Pausada · ${slot}` : slot;
}

function buildRecurringForm(schedule, client) {
  return {
    day_of_week: schedule?.day_of_week ?? '',
    time: schedule?.time ?? (client?.last_session ? formatTimeBolivia(client.last_session) : ''),
    started_at: schedule?.started_at || getBoliviaDateKey(),
    notes: schedule?.notes || '',
  };
}

function recurringPriority(schedule) {
  if (!schedule) return 99;
  if (!schedule.ended_at && !schedule.paused_at) return 0;
  if (schedule.paused_at && !schedule.ended_at) return 1;
  return 2;
}

function pickRecurringSchedule(current, candidate) {
  if (!current) return candidate;
  const currentPriority = recurringPriority(current);
  const candidatePriority = recurringPriority(candidate);
  if (candidatePriority !== currentPriority) {
    return candidatePriority < currentPriority ? candidate : current;
  }
  return new Date(candidate.updated_at || 0) > new Date(current.updated_at || 0) ? candidate : current;
}

function getRecurringFieldMeta(schedule) {
  if (!schedule || schedule.ended_at) {
    return {
      label: '—',
      detail: '',
      className: 'border-gray-200 bg-white text-gray-400',
    };
  }

  const detail = `${formatWeekdayShort(schedule.day_of_week)} ${schedule.time}${schedule.started_at ? ` · desde ${schedule.started_at}` : ''}`;
  if (schedule.paused_at) {
    return {
      label: 'Pausada',
      detail,
      className: 'border-amber-200 bg-amber-50 text-amber-700',
    };
  }

  return {
    label: 'Recurrente',
    detail,
    className: 'border-blue-200 bg-blue-50 text-blue-700',
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

const INLINE_SELECT_CLASS = 'h-9 rounded-xl border border-gray-200 bg-white px-3 text-xs font-medium text-gray-700 outline-none transition focus:border-gray-400 focus:ring-0 disabled:opacity-50';
const INLINE_ACTION_CLASS = 'inline-flex h-8 items-center rounded-lg border px-2.5 text-[11px] font-semibold whitespace-nowrap transition';

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
  const [foreignPricingProfiles, setForeignPricingProfiles] = useState([]);
  const [saving, setSaving] = useState(false);
  const [savingRecurringClientId, setSavingRecurringClientId] = useState(null);
  const [recurringModal, setRecurringModal] = useState(null);
  const [loadingRecurringModal, setLoadingRecurringModal] = useState(false);
  const [archiveView, setArchiveView] = useState('active');
  const [exporting, setExporting] = useState(false);

  const loadClients = useCallback(async () => {
    setLoading(true);
    try {
      const suffix = archiveView === 'active' ? '' : `?view=${archiveView}`;
      const data = await api.get(`/clients${suffix}`);
      setClients(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [archiveView]);

  const loadRecurringSchedules = useCallback(async () => {
    try {
      const data = await api.get('/recurring');
      setRecurringSchedules(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error(err);
    }
  }, []);

  const loadConfig = useCallback(async () => {
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
      setForeignPricingProfiles(parseForeignPricingProfiles(cfg.foreign_pricing_profiles));
    } catch (err) {
      console.error(err);
    }
  }, []);

  const refreshAll = useCallback(() => {
    loadClients();
    loadRecurringSchedules();
  }, [loadClients, loadRecurringSchedules]);

  useEffect(() => {
    loadClients();
  }, [loadClients]);

  useEffect(() => {
    loadRecurringSchedules();
    loadConfig();
  }, [loadRecurringSchedules, loadConfig]);

  useEffect(() => {
    setSelected(new Set());
  }, [archiveView]);

  // Real-time updates via SSE
  useAdminEvents(
    ['client:change', 'recurring:change', 'appointment:change'],
    refreshAll,
  );

  async function handleUpdate(id, field, value) {
    try {
      await api.put(`/clients/${id}`, { [field]: value });
      setClients(prev => prev.map(c => c.id === id ? { ...c, [field]: value, calculated_status: field === 'status_override' ? value : c.calculated_status } : c));
    } catch (err) {
      console.error(err);
    }
  }

  async function handleForeignPricingProfileChange(client, profileKey) {
    const normalizedKey = String(profileKey || '').trim() || null;
    const selectedProfile = normalizedKey
      ? foreignPricingProfiles.find((profile) => profile.key === normalizedKey)
      : null;

    const payload = {
      foreign_pricing_key: normalizedKey,
    };
    if (selectedProfile) {
      payload.fee = Number(selectedProfile.amount || 0);
      payload.fee_currency = selectedProfile.currency || 'USD';
    }

    try {
      await api.put(`/clients/${client.id}`, payload);
      setClients(prev => prev.map((row) => (
        row.id === client.id
          ? {
            ...row,
            foreign_pricing_key: normalizedKey,
            fee: selectedProfile ? Number(selectedProfile.amount || 0) : row.fee,
            fee_currency: selectedProfile ? (selectedProfile.currency || 'USD') : (row.fee_currency || 'BOB'),
          }
          : row
      )));
      showToast(normalizedKey ? 'Perfil Stripe asignado' : 'Perfil Stripe removido');
    } catch (err) {
      showToast('Error: ' + err.message, 'error');
    }
  }

  async function handleDelete(id) {
    try {
      await api.delete(`/clients/${id}`);
      setSelected(prev => { const n = new Set(prev); n.delete(id); return n; });
      await loadClients();
      showToast('Cliente archivado');
    } catch (err) {
      showToast('Error: ' + err.message, 'error');
    }
  }

  async function handleBulkDelete() {
    if (selected.size === 0) return;
    try {
      await Promise.all([...selected].map((id) => api.delete(`/clients/${id}`)));
      setSelected(new Set());
      await loadClients();
      showToast(`${selected.size} cliente(s) archivado(s)`);
    } catch (err) {
      showToast('Error: ' + err.message, 'error');
    }
  }

  async function handleRestore(id) {
    try {
      await api.post(`/clients/${id}/restore`, {});
      setSelected(prev => { const n = new Set(prev); n.delete(id); return n; });
      await loadClients();
      showToast('Cliente restaurado');
    } catch (err) {
      showToast('Error: ' + err.message, 'error');
    }
  }

  async function handleBulkRestore() {
    if (selected.size === 0) return;
    try {
      await Promise.all([...selected].map((id) => api.post(`/clients/${id}/restore`, {})));
      setSelected(new Set());
      await loadClients();
      showToast(`${selected.size} cliente(s) restaurado(s)`);
    } catch (err) {
      showToast('Error: ' + err.message, 'error');
    }
  }

  async function handlePurge(id) {
    try {
      await api.delete(`/clients/${id}/purge`);
      setSelected(prev => { const n = new Set(prev); n.delete(id); return n; });
      await loadClients();
      showToast('Cliente borrado definitivamente');
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

  async function handleRecurringQuickAction(client, schedule, action) {
    if (!schedule?.id) return;

    setSavingRecurringClientId(client.id);
    try {
      const result = await api.put(`/recurring/${schedule.id}/${action}`, {});
      await Promise.all([loadClients(), loadRecurringSchedules()]);
      const syncIssue = action === 'resume' ? getRecurringSyncIssue(result, 'resume') : null;
      showToast(
        syncIssue || (
          action === 'pause'
            ? 'Recurrencia pausada'
            : action === 'resume'
              ? 'Recurrencia reactivada'
              : 'Recurrencia quitada'
        ),
        syncIssue ? 'error' : 'success'
      );
    } catch (err) {
      showToast('Error: ' + err.message, 'error');
    } finally {
      setSavingRecurringClientId(null);
    }
  }

  async function openRecurringModal(client, schedule) {
    setLoadingRecurringModal(true);
    try {
      const detail = await api.get(`/clients/${client.id}`);
      const appointmentsHistory = Array.isArray(detail?.appointments) ? detail.appointments : [];
      const sourceAppointment = pickDefaultRecurringSource(appointmentsHistory);
      setRecurringModal({
        clientId: client.id,
        clientName: `${client.first_name} ${client.last_name}`.trim(),
        schedule,
        sourceAppointment,
      });
    } catch (err) {
      showToast('Error: ' + err.message, 'error');
    } finally {
      setLoadingRecurringModal(false);
    }
  }

  async function handleRecurringModalSubmit(payload) {
    if (!recurringModal) return;
    setSavingRecurringClientId(recurringModal.clientId);
    try {
      if (recurringModal.schedule && !recurringModal.schedule.ended_at) {
        const updated = await api.put(`/recurring/${recurringModal.schedule.id}`, {
          day_of_week: payload.day_of_week,
          time: payload.time,
          started_at: payload.started_at,
        });
        const syncIssue = getRecurringSyncIssue(updated, 'update');
        showToast(syncIssue || 'Recurrencia actualizada', syncIssue ? 'error' : 'success');
      } else {
        const created = await api.post('/recurring', {
          client_id: recurringModal.clientId,
          day_of_week: payload.day_of_week,
          time: payload.time,
          started_at: payload.started_at,
          source_appointment_id: payload.source_appointment_id,
        });
        const syncIssue = getRecurringSyncIssue(created, 'activate');
        showToast(syncIssue || 'Recurrencia activada', syncIssue ? 'error' : 'success');
      }

      setRecurringModal(null);
      await Promise.all([loadClients(), loadRecurringSchedules()]);
    } catch (err) {
      showToast('Error: ' + err.message, 'error');
    } finally {
      setSavingRecurringClientId(null);
    }
  }

  async function handleExport() {
    setExporting(true);
    try {
      const params = new URLSearchParams();
      if (archiveView) params.set('view', archiveView);
      if (search.trim()) params.set('search', search.trim());
      await api.download(`/clients/export?${params.toString()}`, 'contactos.xlsx');
      showToast('Excel de contactos descargado');
    } catch (err) {
      showToast('Error: ' + err.message, 'error');
    } finally {
      setExporting(false);
    }
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
    recurringByClient.set(
      schedule.client_id,
      pickRecurringSchedule(recurringByClient.get(schedule.client_id), schedule)
    );
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

        <div className="inline-flex rounded-lg border border-gray-200 bg-white p-1">
          {[
            { value: 'active', label: 'Activos' },
            { value: 'archived', label: 'Archivados' },
            { value: 'all', label: 'Todos' },
          ].map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => setArchiveView(option.value)}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${
                archiveView === option.value
                  ? 'bg-gray-900 text-white'
                  : 'text-gray-500 hover:bg-gray-100'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-1.5 px-3 py-2 bg-gray-900 text-white rounded-lg text-sm font-medium hover:bg-gray-800"
        >
          <Plus size={16} />
          Crear cliente
        </button>

        <button
          type="button"
          onClick={handleExport}
          disabled={loading || exporting}
          className="flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          <Download size={16} />
          {exporting ? 'Exportando...' : 'Exportar Excel'}
        </button>

        {selected.size > 0 && archiveView === 'active' ? (
          <InlineConfirmButton
            onConfirm={handleBulkDelete}
            confirmLabel="¿Confirmas?"
            cancelLabel="Cancelar"
            wrapperClassName="flex items-center gap-2"
            idleClassName="flex items-center gap-1.5 rounded-lg bg-[#B34E35] px-3 py-2 text-sm font-medium text-white transition hover:bg-[#9f452f]"
            confirmClassName="inline-flex items-center gap-1.5 rounded-lg bg-[#FF2C2C] px-3 py-2 text-sm font-medium text-white transition hover:bg-[#e32727]"
            cancelClassName="inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50"
          >
            <Trash2 size={16} />
            Archivar ({selected.size})
          </InlineConfirmButton>
        ) : null}

        {selected.size > 0 && archiveView === 'archived' ? (
          <button
            type="button"
            onClick={handleBulkRestore}
            className="flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-700 hover:bg-emerald-100"
          >
            Restaurar ({selected.size})
          </button>
        ) : null}

        <span className="text-xs text-gray-400 ml-auto">{filtered.length} cliente{filtered.length !== 1 ? 's' : ''}</span>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
        {loading ? (
          <div className="p-8 text-center text-gray-400">Cargando...</div>
        ) : (
          <table className="w-full min-w-[2140px] text-sm">
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
                <th className="text-left p-3 font-medium min-w-[190px]">Cliente</th>
                <th className="text-left p-3 font-medium min-w-[165px]">Celular</th>
                <th className="text-left p-3 font-medium min-w-[180px]">Ubicación</th>
                <th className="text-left p-3 font-medium min-w-[210px]">Zona horaria</th>
                <th className="text-left p-3 font-medium min-w-[320px]">Recurrencia</th>
                <th className="text-left p-3 font-medium min-w-[160px]">Status</th>
                <th className="text-left p-3 font-medium min-w-[150px]">Retención</th>
                <th className="text-left p-3 font-medium min-w-[180px]">Arancel</th>
                <th className="text-left p-3 font-medium min-w-[210px]">Perfil Stripe</th>
                <th className="text-left p-3 font-medium min-w-[170px]">Fuente</th>
                <th className="text-left p-3 font-medium min-w-[110px]">Sesiones</th>
                <th className="text-left p-3 font-medium min-w-[110px]">Registro</th>
                <th className="text-left p-3 font-medium min-w-[210px]">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((client, index) => {
                const recurringSchedule = recurringByClient.get(client.id) || null;
                const isArchived = Boolean(client.deleted_at);
                const rowTone = index % 2 === 0 ? 'appointments-zebra-even' : 'appointments-zebra-odd';
                const recurringMeta = getRecurringFieldMeta(recurringSchedule);
                const recurringLabel = isArchived ? 'Archivado' : formatRecurringInline(recurringSchedule);
                const recurringButtonClassName = isArchived
                  ? 'border-gray-200 bg-gray-100 text-gray-500'
                  : !recurringSchedule || recurringSchedule.ended_at
                    ? 'border-gray-200 bg-white text-gray-500 hover:bg-gray-50'
                    : `${recurringMeta.className} hover:brightness-[0.98]`;

                return (
                  <tr key={client.id} className={`border-b border-gray-100 transition-colors appointments-zebra-hover ${rowTone}`}>
                    <td className="p-3 align-middle">
                      <input
                        type="checkbox"
                        checked={selected.has(client.id)}
                        onChange={() => toggleSelect(client.id)}
                        className="w-4 h-4 accent-black rounded"
                      />
                    </td>

                    <td className="p-3 align-middle whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => setEditClient(client)}
                        className="text-left text-[13px] font-semibold text-gray-800 transition hover:text-blue-600"
                      >
                        {client.first_name} {client.last_name}
                      </button>
                    </td>

                    <td className="p-3 align-middle whitespace-nowrap">
                      <a
                        href={`https://wa.me/${client.phone}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-mono text-xs text-blue-600 hover:underline"
                      >
                        {client.phone}
                      </a>
                    </td>

                    <td className="p-3 align-middle whitespace-nowrap text-xs font-medium text-gray-700">
                      {formatClientLocation(client)}
                    </td>

                    <td className="p-3 align-middle">
                      <select
                        value={client.timezone || 'America/La_Paz'}
                        onChange={e => handleUpdate(client.id, 'timezone', e.target.value)}
                        disabled={isArchived}
                        className={`w-full min-w-[190px] ${INLINE_SELECT_CLASS}`}
                      >
                        {getTimezoneOptions(client.timezone || 'America/La_Paz').map((zone) => (
                          <option key={zone.tz} value={zone.tz}>{zone.label}</option>
                        ))}
                      </select>
                    </td>

                    <td className="p-3 align-middle">
                      <div className="flex items-center gap-1.5 whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => openRecurringModal(client, recurringSchedule)}
                          disabled={isArchived || loadingRecurringModal || savingRecurringClientId === client.id}
                          className={`inline-flex h-8 items-center rounded-full border px-3 text-xs font-semibold transition disabled:opacity-60 ${recurringButtonClassName}`}
                        >
                          {recurringLabel}
                        </button>
                        {!isArchived && recurringSchedule && !recurringSchedule.ended_at ? (
                          <>
                            {!recurringSchedule.paused_at ? (
                              <button
                                type="button"
                                onClick={() => handleRecurringQuickAction(client, recurringSchedule, 'pause')}
                                disabled={savingRecurringClientId === client.id}
                                className={`${INLINE_ACTION_CLASS} border-amber-200 text-amber-700 hover:bg-amber-50 disabled:opacity-60`}
                              >
                                Pausar
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={() => handleRecurringQuickAction(client, recurringSchedule, 'resume')}
                                disabled={savingRecurringClientId === client.id}
                                className={`${INLINE_ACTION_CLASS} border-emerald-200 text-emerald-700 hover:bg-emerald-50 disabled:opacity-60`}
                              >
                                Reactivar
                              </button>
                            )}
                            <InlineConfirmButton
                              onConfirm={() => handleRecurringQuickAction(client, recurringSchedule, 'end')}
                              confirmLabel="Confirmar"
                              cancelLabel="Cancelar"
                              compactCancel
                              wrapperClassName="flex items-center gap-2"
                              idleClassName={`${INLINE_ACTION_CLASS} border-rose-200 text-rose-700 hover:bg-rose-50 disabled:opacity-60`}
                              confirmClassName="inline-flex h-8 items-center gap-1 rounded-lg border border-rose-200 bg-rose-50 px-2.5 text-[11px] font-semibold text-rose-700 hover:bg-rose-100"
                              cancelClassName="inline-flex items-center justify-center rounded-lg border border-gray-200 p-1 text-gray-500 hover:bg-gray-50"
                              disabled={savingRecurringClientId === client.id}
                            >
                              Quitar
                            </InlineConfirmButton>
                          </>
                        ) : null}
                      </div>
                    </td>

                    <td className="p-3 align-middle">
                      {isArchived ? (
                        <span className="inline-flex h-8 items-center rounded-full bg-gray-100 px-3 text-xs font-semibold text-gray-500">
                          Archivado
                        </span>
                      ) : (
                        <select
                          value={client.status_override || client.calculated_status || ''}
                          onChange={e => handleUpdate(client.id, 'status_override', e.target.value || null)}
                          className="w-full min-w-[140px] h-9 rounded-full border-0 px-3 text-xs font-semibold cursor-pointer"
                          style={statusStyle((statuses.find(s => s.name === (client.status_override || client.calculated_status))?.color) || '#9CA3AF')}
                        >
                          <option value="">Auto ({client.calculated_status})</option>
                          {statuses.map(s => (
                            <option key={s.name} value={s.name}>{s.name}</option>
                          ))}
                        </select>
                      )}
                    </td>

                    <td className="p-3 align-middle">
                      <span
                        className="inline-flex h-8 items-center rounded-full px-3 text-xs font-semibold whitespace-nowrap"
                        style={retentionStyle(client.retention_status)}
                      >
                        {formatRetentionInline(client)}
                      </span>
                    </td>

                    <td className="p-3 align-middle">
                      <div className="flex items-center gap-2 whitespace-nowrap">
                        <input
                          type="number"
                          value={client.fee || ''}
                          onChange={e => handleUpdate(client.id, 'fee', e.target.value === '' ? null : parseFloat(e.target.value))}
                          disabled={isArchived}
                          className="h-9 w-24 rounded-xl border border-gray-200 bg-white px-3 text-right text-sm font-semibold text-gray-700 outline-none transition focus:border-gray-400 focus:ring-0 disabled:opacity-50"
                        />
                        <select
                          value={client.fee_currency || 'BOB'}
                          onChange={e => handleUpdate(client.id, 'fee_currency', e.target.value)}
                          disabled={isArchived}
                          className={`w-[72px] ${INLINE_SELECT_CLASS}`}
                        >
                          <option value="BOB">BOB</option>
                          <option value="USD">USD</option>
                        </select>
                      </div>
                    </td>

                    <td className="p-3 align-middle">
                      {isArchived ? (
                        <span className="text-xs text-gray-400 whitespace-nowrap">
                          {client.foreign_pricing_key || 'Sin perfil'}
                        </span>
                      ) : (
                        <select
                          value={client.foreign_pricing_key || ''}
                          onChange={e => handleForeignPricingProfileChange(client, e.target.value)}
                          disabled={isArchived}
                          className={`w-full min-w-[190px] ${INLINE_SELECT_CLASS}`}
                        >
                          <option value="">Sin perfil Stripe</option>
                          {foreignPricingProfiles.map(profile => (
                            <option key={profile.key} value={profile.key}>
                              {profile.key} · {profile.currency} {profile.amount}
                            </option>
                          ))}
                        </select>
                      )}
                    </td>

                    <td className="p-3 align-middle">
                      <select
                        value={client.source || 'Otro'}
                        onChange={e => handleUpdate(client.id, 'source', e.target.value)}
                        disabled={isArchived}
                        className={`w-full min-w-[150px] ${INLINE_SELECT_CLASS}`}
                      >
                        {sources.map((source) => (
                          <option key={source} value={source}>{source}</option>
                        ))}
                      </select>
                    </td>

                    <td className="p-3 align-middle text-center text-sm font-semibold text-gray-700">
                      {client.completed_sessions || 0}
                    </td>

                    <td className="p-3 align-middle whitespace-nowrap text-xs font-medium text-gray-500">
                      {formatShortDate(client.created_at)}
                    </td>

                    <td className="p-3 align-middle">
                      {isArchived ? (
                        <div className="flex items-center gap-1.5 whitespace-nowrap">
                          <button
                            type="button"
                            onClick={() => handleRestore(client.id)}
                            className={`${INLINE_ACTION_CLASS} border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100`}
                          >
                            Restaurar
                          </button>
                          <InlineConfirmButton
                            onConfirm={() => handlePurge(client.id)}
                            confirmLabel="¿Confirmas?"
                            cancelLabel="Cancelar"
                            compactCancel
                            wrapperClassName="flex items-center gap-2"
                            idleClassName="inline-flex h-8 items-center rounded-lg bg-[#B34E35] px-2.5 text-[11px] font-semibold text-white transition hover:bg-[#9f452f]"
                            confirmClassName="inline-flex h-8 items-center gap-1 rounded-lg bg-[#FF2C2C] px-2.5 text-[11px] font-semibold text-white transition hover:bg-[#e32727]"
                            cancelClassName="inline-flex items-center justify-center rounded-lg border border-gray-200 p-1 text-gray-500 hover:bg-gray-50"
                            idleTitle="Borrar definitivamente"
                          >
                            Borrar
                          </InlineConfirmButton>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1.5 whitespace-nowrap">
                          <button
                            type="button"
                            onClick={() => setEditClient(client)}
                            className={`${INLINE_ACTION_CLASS} border-gray-200 text-gray-700 hover:bg-gray-50`}
                          >
                            Editar
                          </button>
                          <InlineConfirmButton
                            onConfirm={() => handleDelete(client.id)}
                            confirmLabel="¿Confirmas?"
                            cancelLabel="Cancelar"
                            compactCancel
                            wrapperClassName="flex items-center gap-2"
                            idleClassName="inline-flex h-8 items-center rounded-lg bg-[#B34E35] px-2.5 text-[11px] font-semibold text-white transition hover:bg-[#9f452f]"
                            confirmClassName="inline-flex h-8 items-center gap-1 rounded-lg bg-[#FF2C2C] px-2.5 text-[11px] font-semibold text-white transition hover:bg-[#e32727]"
                            cancelClassName="inline-flex items-center justify-center rounded-lg border border-gray-200 p-1 text-gray-500 hover:bg-gray-50"
                            idleTitle="Archivar"
                          >
                            Archivar
                          </InlineConfirmButton>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr><td colSpan={14} className="p-8 text-center text-gray-400">Sin resultados</td></tr>
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
          foreignPricingProfiles={foreignPricingProfiles}
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
          foreignPricingProfiles={foreignPricingProfiles}
          showToast={showToast}
        />
      )}

      <RecurringQuickModal
        open={!!recurringModal}
        clientName={recurringModal?.clientName || ''}
        schedule={recurringModal?.schedule || null}
        sourceAppointment={recurringModal?.sourceAppointment || null}
        saving={savingRecurringClientId === recurringModal?.clientId}
        onClose={() => setRecurringModal(null)}
        onSubmit={handleRecurringModalSubmit}
      />
    </AdminLayout>
  );
}

function CreateClientModal({ onClose, onCreate, saving, sources, foreignPricingProfiles }) {
  const [form, setForm] = useState({
    phone: '', first_name: '', last_name: '', age: '',
    city: 'Cochabamba', country: 'Bolivia', timezone: 'America/La_Paz',
    source: 'Otro', fee: '250', fee_currency: 'BOB', foreign_pricing_key: '', modality: 'Online',
  });

  function set(k, v) { setForm(f => ({ ...f, [k]: v })); }

  function handleSubmit(e) {
    e.preventDefault();
    onCreate({
      ...form,
      age: form.age ? parseInt(form.age) : undefined,
      fee: form.fee ? parseFloat(form.fee) : undefined,
      foreign_pricing_key: form.foreign_pricing_key || null,
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
                {getTimezoneOptions(form.timezone).map((zone) => (
                  <option key={zone.tz} value={zone.tz}>{zone.label}</option>
                ))}
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
            <Field label={`Arancel (${form.fee_currency === 'USD' ? 'USD' : 'Bs'})`}>
              <input type="number" value={form.fee} onChange={e => set('fee', e.target.value)} className="input" />
            </Field>
            <Field label="Moneda arancel">
              <select value={form.fee_currency} onChange={e => set('fee_currency', e.target.value)} className="input">
                <option value="BOB">BOB</option>
                <option value="USD">USD</option>
              </select>
            </Field>
            <Field label="Perfil Stripe">
              <select
                value={form.foreign_pricing_key}
                onChange={e => {
                  const nextKey = e.target.value;
                  const selectedProfile = (foreignPricingProfiles || []).find((profile) => profile.key === nextKey);
                  set('foreign_pricing_key', nextKey);
                  if (selectedProfile) {
                    set('fee', String(selectedProfile.amount || ''));
                    set('fee_currency', selectedProfile.currency || 'USD');
                  }
                }}
                className="input"
              >
                <option value="">Sin perfil</option>
                {(foreignPricingProfiles || []).map((profile) => (
                  <option key={profile.key} value={profile.key}>
                    {profile.key} · {profile.currency} {profile.amount}
                  </option>
                ))}
              </select>
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

function EditClientModal({ client, recurringSchedule, onClose, onSave, onRecurringChange, sources, statuses, foreignPricingProfiles, showToast }) {
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
      const fields = [
        'first_name', 'last_name', 'phone', 'age', 'city', 'country', 'timezone', 'modality', 'frequency',
        'source', 'referred_by', 'fee', 'fee_currency', 'foreign_pricing_key', 'payment_method',
        'notes', 'diagnosis', 'status_override',
      ];
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
                {getTimezoneOptions(form.timezone || 'America/La_Paz').map((zone) => (
                  <option key={zone.tz} value={zone.tz}>{zone.label}</option>
                ))}
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
            <Field label={`Arancel (${(form.fee_currency || 'BOB') === 'USD' ? 'USD' : 'Bs'})`}>
              <input type="number" value={form.fee || ''} onChange={e => set('fee', parseFloat(e.target.value))} className="input" />
            </Field>
            <Field label="Moneda arancel">
              <select value={form.fee_currency || 'BOB'} onChange={e => set('fee_currency', e.target.value)} className="input">
                <option value="BOB">BOB</option>
                <option value="USD">USD</option>
              </select>
            </Field>
            <Field label="Perfil Stripe">
              <select
                value={form.foreign_pricing_key || ''}
                onChange={e => {
                  const nextKey = e.target.value || null;
                  const selectedProfile = (foreignPricingProfiles || []).find((profile) => profile.key === nextKey);
                  set('foreign_pricing_key', nextKey);
                  if (selectedProfile) {
                    set('fee', Number(selectedProfile.amount || 0));
                    set('fee_currency', selectedProfile.currency || 'USD');
                  }
                }}
                className="input"
              >
                <option value="">Sin perfil</option>
                {(foreignPricingProfiles || []).map((profile) => (
                  <option key={profile.key} value={profile.key}>
                    {profile.key} · {profile.currency} {profile.amount}
                  </option>
                ))}
              </select>
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
                    <InlineConfirmButton
                      onConfirm={() => handleRecurringAction('end')}
                      confirmLabel="Finalizar"
                      cancelLabel="Cancelar"
                      compactCancel
                      idleClassName="rounded-lg bg-gray-100 px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-200 disabled:opacity-40"
                      confirmClassName="inline-flex items-center gap-1 rounded-lg bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700 hover:bg-rose-100"
                      cancelClassName="inline-flex items-center justify-center rounded-lg border border-gray-200 p-2 text-gray-500 hover:bg-gray-50"
                      disabled={savingRecurring}
                    >
                      Finalizar
                    </InlineConfirmButton>
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
