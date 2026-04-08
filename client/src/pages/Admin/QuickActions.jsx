import { useState, useEffect, useRef, useCallback } from 'react';
import {
  BellRing,
  CalendarClock,
  CalendarX2,
  Check,
  ChevronDown,
  ChevronUp,
  CircleDollarSign,
  CreditCard,
  Loader2,
  Repeat,
  Search,
  UserX,
  X,
} from 'lucide-react';
import AdminLayout from '../../components/AdminLayout';
import RecurringQuickModal from '../../components/RecurringQuickModal';
import { api } from '../../utils/api';
import { getRecurringSyncIssue } from '../../utils/recurring';
import { useToast, Toast } from '../../hooks/useToast';
import useAdminEvents from '../../hooks/useAdminEvents';
import { formatWeekdayShort, formatTimeBolivia, formatDateBolivia, formatRelativeDay } from '../../utils/dates';

// ─── Constants ────────────────────────────────────────────────────

const ACTIONS = [
  { id: 'reschedule', label: 'Reagendar', icon: CalendarClock, color: 'bg-blue-600', desc: 'Envía link de reagendamiento por WhatsApp' },
  { id: 'cancel', label: 'Cancelar', icon: CalendarX2, color: 'bg-red-600', desc: 'Cancela la próxima cita' },
  { id: 'noshow', label: 'No-show', icon: UserX, color: 'bg-slate-600', desc: 'Marca como inasistencia' },
  { id: 'reminder', label: 'Recordar cita', icon: BellRing, color: 'bg-emerald-600', desc: 'Fuerza envío del recordatorio de cita' },
  { id: 'payment-reminder', label: 'Recordar cobro', icon: CreditCard, color: 'bg-teal-600', desc: 'Envía el template de cobro pendiente' },
  { id: 'recurring', label: 'Gestionar recurrencia', icon: Repeat, color: 'bg-violet-600', desc: 'Activa, pausa, reactiva o finaliza la sesión semanal' },
  { id: 'fee', label: 'Ajustar arancel', icon: CircleDollarSign, color: 'bg-amber-600', desc: 'Cambia el arancel del cliente' },
];

// ─── Main Component ──────────────────────────────────────────────

export default function QuickActions() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [selectedClient, setSelectedClient] = useState(null);
  const [activeAction, setActiveAction] = useState(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [actionResult, setActionResult] = useState(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Fee editing
  const [feeValue, setFeeValue] = useState('');

  // Cancel options
  const [cancelEndRecurring, setCancelEndRecurring] = useState(false);
  const [cancelSendWA, setCancelSendWA] = useState(true);

  // No-show options
  const [noshowSendWA, setNoshowSendWA] = useState(false);

  // Recurring modal
  const [recurringModalOpen, setRecurringModalOpen] = useState(false);
  const [recurringSaving, setRecurringSaving] = useState(false);

  // Config quick settings
  const [config, setConfig] = useState(null);

  // Upcoming clients
  const [upcoming, setUpcoming] = useState([]);
  const [upcomingLoading, setUpcomingLoading] = useState(true);

  const searchRef = useRef(null);
  const debounceRef = useRef(null);
  const { toast, show: showToast } = useToast();

  // Focus search on mount + load upcoming
  useEffect(() => {
    searchRef.current?.focus();
    api.get('/config').then(setConfig).catch(() => {});
    api.get('/quick-actions/upcoming')
      .then(setUpcoming)
      .catch(() => {})
      .finally(() => setUpcomingLoading(false));
  }, []);

  // Real-time updates via SSE — refresh search results and upcoming
  const refreshSearch = useCallback(() => {
    if (query.trim().length >= 2) {
      api.get(`/quick-actions/clients?q=${encodeURIComponent(query.trim())}`)
        .then(setResults)
        .catch(() => {});
    }
    api.get('/quick-actions/upcoming').then(setUpcoming).catch(() => {});
  }, [query]);
  useAdminEvents(
    ['appointment:change', 'recurring:change', 'client:change', 'payment:change'],
    refreshSearch,
  );

  // Debounced search
  const handleSearch = useCallback((value) => {
    setQuery(value);
    setSelectedClient(null);
    setActiveAction(null);
    setActionResult(null);

    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (!value.trim()) {
      setResults([]);
      return;
    }

    setSearching(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const data = await api.get(`/quick-actions/clients?q=${encodeURIComponent(value.trim())}`);
        setResults(data);
      } catch (err) {
        console.error(err);
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 220);
  }, []);

  function selectClient(client) {
    setSelectedClient(client);
    setResults([]);
    setQuery('');
    setActiveAction(null);
    setActionResult(null);
    setFeeValue(String(client.fee || 250));
    setCancelEndRecurring(client.has_recurring > 0);
    setCancelSendWA(true);
    setNoshowSendWA(false);
  }

  function clearClient() {
    setSelectedClient(null);
    setActiveAction(null);
    setActionResult(null);
    setQuery('');
    setTimeout(() => searchRef.current?.focus(), 50);
  }

  // ─── Execute action ─────────────────────────────────────────────

  async function executeAction(actionId) {
    if (!selectedClient) return;
    setActionLoading(true);
    setActionResult(null);

    try {
      let result;
      const clientId = selectedClient.id;
      const nombre = selectedClient.first_name;

      switch (actionId) {
        case 'reschedule': {
          result = await api.post('/quick-actions/send-reschedule-link', { client_id: clientId });
          setActionResult({
            success: true,
            title: 'Link de reagendamiento enviado',
            detail: `Se envió el link a ${nombre} por WhatsApp.`,
          });
          break;
        }

        case 'cancel': {
          result = await api.post('/quick-actions/cancel', {
            client_id: clientId,
            end_recurring: cancelEndRecurring,
            send_whatsapp: cancelSendWA,
          });
          const parts = [];
          if (result.had_appointment) parts.push('Cita cancelada');
          else parts.push('No tenía cita próxima');
          if (cancelEndRecurring && result.actions?.some((a) => a.type === 'recurring_ended')) {
            parts.push('recurrencia finalizada');
          }
          if (result.actions?.some((a) => a.type === 'whatsapp_sent')) {
            parts.push('WhatsApp enviado');
          }
          setActionResult({
            success: true,
            title: 'Cancelación procesada',
            detail: parts.join(' · '),
          });
          // Refresh client data
          refreshClient(clientId);
          break;
        }

        case 'noshow': {
          result = await api.post('/quick-actions/noshow', {
            client_id: clientId,
            send_whatsapp: noshowSendWA,
          });
          const parts = ['Marcada como no-show'];
          if (result.actions?.some((a) => a.type === 'whatsapp_sent')) {
            parts.push('WhatsApp enviado');
          }
          setActionResult({
            success: true,
            title: 'No-show registrado',
            detail: parts.join(' · '),
          });
          refreshClient(clientId);
          break;
        }

        case 'reminder': {
          result = await api.post('/quick-actions/send-reminder', { client_id: clientId });
          if (result.sent > 0) {
            setActionResult({
              success: true,
              title: 'Recordatorio de cita enviado',
              detail: `Se envió el recordatorio de cita a ${nombre}.`,
            });
          } else {
            let detail = 'El recordatorio ya fue enviado anteriormente.';
            if (result.reason === 'no_upcoming_appointment') {
              detail = 'No se encontró cita próxima para este cliente.';
            } else if (result.matched === 0 && result.targetFound === false) {
              detail = 'No se pudo asociar la cita con un evento de Google Calendar, y no se encontró teléfono del cliente.';
            }
            setActionResult({
              success: false,
              title: 'No se envió recordatorio de cita',
              detail,
            });
          }
          break;
        }

        case 'payment-reminder': {
          result = await api.post('/quick-actions/send-payment-reminder', { client_id: clientId });
          if (result.sent > 0) {
            setActionResult({
              success: true,
              title: 'Recordatorio de cobro enviado',
              detail: `Se envió el recordatorio de cobro a ${nombre}.`,
            });
          } else {
            setActionResult({
              success: false,
              title: 'No se envió recordatorio de cobro',
              detail: result.targetFound === false
                ? 'No se encontró un pago pendiente con cita futura para este cliente.'
                : 'No había pagos pendientes listos para enviar.',
            });
          }
          break;
        }

        case 'fee': {
          const newFee = parseInt(feeValue, 10);
          if (isNaN(newFee) || newFee < 0) {
            setActionResult({ success: false, title: 'Arancel inválido', detail: 'Ingresa un número válido.' });
            break;
          }
          result = await api.post('/quick-actions/update-fee', { client_id: clientId, fee: newFee });
          setActionResult({
            success: true,
            title: 'Arancel actualizado',
            detail: `${nombre} ahora tiene arancel de Bs ${newFee}.`,
          });
          refreshClient(clientId);
          break;
        }

        default:
          break;
      }
    } catch (err) {
      setActionResult({
        success: false,
        title: 'Error',
        detail: err.message || 'No se pudo ejecutar la acción.',
      });
    } finally {
      setActionLoading(false);
    }
  }

  async function refreshClient(clientId) {
    try {
      const updated = await api.get(`/quick-actions/clients/${clientId}`);
      if (updated?.id) setSelectedClient(updated);
    } catch (_) {}
  }

  // ─── Recurring handlers ─────────────────────────────────────────

  async function handleRecurringSubmit(formData) {
    if (!selectedClient) return;
    setRecurringSaving(true);
    try {
      const created = await api.post('/recurring', {
        client_id: selectedClient.id,
        ...formData,
      });
      const syncIssue = getRecurringSyncIssue(created, 'activate');
      setRecurringModalOpen(false);
      setActionResult({
        success: !syncIssue,
        title: syncIssue ? 'Recurrencia guardada en la app' : 'Recurrencia activada',
        detail: syncIssue || `${selectedClient.first_name} ahora tiene sesión semanal.`,
      });
      refreshClient(selectedClient.id);
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setRecurringSaving(false);
    }
  }

  async function handleRecurringPause() {
    if (!selectedClient) return;
    setActionLoading(true);
    try {
      const [schedules] = await Promise.all([api.get('/recurring')]);
      const schedule = schedules.find(
        (s) => s.client_id === selectedClient.id && !s.ended_at && !s.paused_at
      );
      if (!schedule) {
        setActionResult({ success: false, title: 'Sin recurrencia activa', detail: 'No se encontró schedule activo.' });
        return;
      }
      await api.put(`/recurring/${schedule.id}/pause`);
      setActionResult({
        success: true,
        title: 'Recurrencia pausada',
        detail: `${selectedClient.first_name} en pausa. Puede reactivarse cuando quieras.`,
      });
      refreshClient(selectedClient.id);
    } catch (err) {
      setActionResult({ success: false, title: 'Error', detail: err.message });
    } finally {
      setActionLoading(false);
    }
  }

  async function handleRecurringResume() {
    if (!selectedClient) return;
    setActionLoading(true);
    try {
      const schedules = await api.get('/recurring');
      const schedule = schedules.find(
        (s) => s.client_id === selectedClient.id && !s.ended_at && s.paused_at
      );
      if (!schedule) {
        setActionResult({ success: false, title: 'Sin recurrencia pausada', detail: '' });
        return;
      }
      const resumed = await api.put(`/recurring/${schedule.id}/resume`);
      const syncIssue = getRecurringSyncIssue(resumed, 'resume');
      setActionResult({
        success: !syncIssue,
        title: syncIssue ? 'Recurrencia reactivada en la app' : 'Recurrencia reactivada',
        detail: syncIssue || `${selectedClient.first_name} vuelve a sesión semanal.`,
      });
      refreshClient(selectedClient.id);
    } catch (err) {
      setActionResult({ success: false, title: 'Error', detail: err.message });
    } finally {
      setActionLoading(false);
    }
  }

  async function handleRecurringEnd() {
    if (!selectedClient) return;
    setActionLoading(true);
    try {
      const schedules = await api.get('/recurring');
      const schedule = schedules.find(
        (s) => s.client_id === selectedClient.id && !s.ended_at
      );
      if (!schedule) {
        setActionResult({ success: false, title: 'Sin recurrencia', detail: '' });
        return;
      }
      await api.put(`/recurring/${schedule.id}/end`);
      setActionResult({
        success: true,
        title: 'Recurrencia finalizada',
        detail: `${selectedClient.first_name} ya no tiene sesión semanal.`,
      });
      refreshClient(selectedClient.id);
    } catch (err) {
      setActionResult({ success: false, title: 'Error', detail: err.message });
    } finally {
      setActionLoading(false);
    }
  }

  // ─── Quick settings ─────────────────────────────────────────────

  async function toggleReminders() {
    if (!config) return;
    const newVal = !config.reminder_enabled;
    try {
      await api.put('/config', { reminder_enabled: newVal });
      setConfig((prev) => ({ ...prev, reminder_enabled: newVal }));
      showToast(newVal ? 'Recordatorios activados' : 'Recordatorios desactivados');
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  // ─── Render ─────────────────────────────────────────────────────

  return (
    <AdminLayout title="Comandos">
      <Toast toast={toast} />

      <div className="mx-auto max-w-lg space-y-4">
        {/* Search bar */}
        <div className="relative">
          <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            ref={searchRef}
            type="text"
            value={query}
            onChange={(e) => handleSearch(e.target.value)}
            placeholder="Buscar cliente por nombre o teléfono..."
            className="w-full rounded-2xl border border-slate-200 bg-white py-4 pl-11 pr-4 text-base outline-none transition placeholder:text-slate-400 focus:border-slate-400 focus:shadow-[0_8px_30px_rgba(0,0,0,0.06)]"
            autoComplete="off"
          />
          {query && (
            <button
              type="button"
              onClick={() => { setQuery(''); setResults([]); searchRef.current?.focus(); }}
              className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
            >
              <X size={18} />
            </button>
          )}
        </div>

        {/* Search results */}
        {results.length > 0 && !selectedClient && (
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            {results.map((client) => (
              <button
                key={client.id}
                type="button"
                onClick={() => selectClient(client)}
                className="flex w-full items-center gap-3 border-b border-slate-100 px-4 py-3.5 text-left transition last:border-0 hover:bg-slate-50 active:bg-slate-100"
              >
                <div className="flex h-10 w-10 flex-none items-center justify-center rounded-xl bg-slate-100 text-sm font-semibold text-slate-600">
                  {client.first_name?.[0]}{client.last_name?.[0]}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-[15px] font-semibold text-slate-900">
                    {client.first_name} {client.last_name}
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                    <span>Bs {client.fee}</span>
                    {client.has_recurring > 0 && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-blue-700">
                        <Repeat size={10} />
                        {formatWeekdayShort(client.recurring_day)} {client.recurring_time}
                      </span>
                    )}
                    {client.next_appointment && (
                      <span className="text-emerald-600">
                        Próxima: {formatTimeBolivia(client.next_appointment)}
                      </span>
                    )}
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}

        {searching && results.length === 0 && query && (
          <div className="py-6 text-center text-sm text-slate-400">
            <Loader2 size={18} className="mx-auto mb-2 animate-spin" />
            Buscando...
          </div>
        )}

        {!searching && query && results.length === 0 && (
          <div className="py-6 text-center text-sm text-slate-400">
            No se encontraron clientes
          </div>
        )}

        {/* Selected client card */}
        {selectedClient && (
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            {/* Client header */}
            <div className="flex items-start justify-between border-b border-slate-100 px-4 py-4">
              <div>
                <div className="text-lg font-semibold text-slate-900">
                  {selectedClient.first_name} {selectedClient.last_name}
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-slate-500">
                  <span>{selectedClient.phone}</span>
                  <span className="text-slate-300">·</span>
                  <span>Bs {selectedClient.fee}</span>
                  {selectedClient.city && (
                    <>
                      <span className="text-slate-300">·</span>
                      <span>{selectedClient.city}</span>
                    </>
                  )}
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {selectedClient.has_recurring > 0 && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700">
                      <Repeat size={11} />
                      Semanal · {formatWeekdayShort(selectedClient.recurring_day)} {selectedClient.recurring_time}
                    </span>
                  )}
                  {selectedClient.next_appointment && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700">
                      Próxima: {formatDateBolivia(selectedClient.next_appointment)} {formatTimeBolivia(selectedClient.next_appointment)}
                    </span>
                  )}
                  {!selectedClient.next_appointment && selectedClient.has_recurring === 0 && (
                    <span className="inline-flex rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-500">
                      Sin cita próxima
                    </span>
                  )}
                  <span className="inline-flex rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-500">
                    {selectedClient.completed_sessions || 0} sesiones
                  </span>
                </div>
              </div>
              <button
                type="button"
                onClick={clearClient}
                className="rounded-xl p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
              >
                <X size={18} />
              </button>
            </div>

            {/* Action buttons */}
            <div className="grid grid-cols-3 gap-2 px-4 py-4">
              {ACTIONS.map((action) => {
                const Icon = action.icon;
                const isActive = activeAction === action.id;
                return (
                  <button
                    key={action.id}
                    type="button"
                    onClick={() => setActiveAction(isActive ? null : action.id)}
                    className={`flex min-h-[6.1rem] flex-col items-center justify-center gap-2 rounded-2xl border px-3 py-3 text-center transition active:scale-[0.97] ${
                      isActive
                        ? 'border-slate-900 bg-slate-900 text-white shadow-[0_8px_24px_rgba(0,0,0,0.15)]'
                        : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50'
                    }`}
                  >
                    <Icon size={20} />
                    <span className="flex min-h-[2.35rem] items-center justify-center text-[11px] font-semibold leading-tight">
                      {action.label}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Action detail panel */}
            {activeAction && (
              <div className="border-t border-slate-100 px-4 py-4">
                <ActionPanel
                  actionId={activeAction}
                  client={selectedClient}
                  loading={actionLoading}
                  feeValue={feeValue}
                  setFeeValue={setFeeValue}
                  cancelEndRecurring={cancelEndRecurring}
                  setCancelEndRecurring={setCancelEndRecurring}
                  cancelSendWA={cancelSendWA}
                  setCancelSendWA={setCancelSendWA}
                  noshowSendWA={noshowSendWA}
                  setNoshowSendWA={setNoshowSendWA}
                  onExecute={executeAction}
                  onRecurringActivate={() => setRecurringModalOpen(true)}
                  onRecurringPause={handleRecurringPause}
                  onRecurringResume={handleRecurringResume}
                  onRecurringEnd={handleRecurringEnd}
                />
              </div>
            )}
          </div>
        )}

        {/* Action result */}
        {actionResult && (
          <div
            className={`flex items-start gap-3 rounded-2xl border px-4 py-4 ${
              actionResult.success
                ? 'border-emerald-200 bg-emerald-50'
                : 'border-red-200 bg-red-50'
            }`}
          >
            <div className={`mt-0.5 flex h-7 w-7 flex-none items-center justify-center rounded-full ${
              actionResult.success ? 'bg-emerald-600' : 'bg-red-500'
            }`}>
              {actionResult.success ? <Check size={14} className="text-white" /> : <X size={14} className="text-white" />}
            </div>
            <div>
              <div className={`text-sm font-semibold ${actionResult.success ? 'text-emerald-900' : 'text-red-900'}`}>
                {actionResult.title}
              </div>
              {actionResult.detail && (
                <div className={`mt-0.5 text-sm ${actionResult.success ? 'text-emerald-700' : 'text-red-700'}`}>
                  {actionResult.detail}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Upcoming clients */}
        {!selectedClient && !query && upcoming.length > 0 && (
          <div>
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400 px-1">
              Próximas citas
            </div>
            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              {upcoming.map((client) => (
                <button
                  key={client.id}
                  type="button"
                  onClick={() => selectClient(client)}
                  className="flex w-full items-center gap-3 border-b border-slate-100 px-4 py-3.5 text-left transition last:border-0 hover:bg-slate-50 active:bg-slate-100"
                >
                  <div className="flex h-10 w-10 flex-none items-center justify-center rounded-xl bg-slate-100 text-sm font-semibold text-slate-600">
                    {client.first_name?.[0]}{client.last_name?.[0]}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-[15px] font-semibold text-slate-900">
                      {client.first_name} {client.last_name}
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                      <span>Bs {client.fee}</span>
                      {client.has_recurring > 0 && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-blue-700">
                          <Repeat size={10} />
                          {formatWeekdayShort(client.recurring_day)} {client.recurring_time}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex-none text-right">
                    <div className="text-xs font-semibold text-emerald-700">
                      {formatRelativeDay(client.next_appointment)}
                    </div>
                    <div className="text-sm font-medium text-slate-900">
                      {formatTimeBolivia(client.next_appointment)}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Quick settings */}
        <div className="rounded-2xl border border-slate-200 bg-white">
          <button
            type="button"
            onClick={() => setSettingsOpen(!settingsOpen)}
            className="flex w-full items-center justify-between px-4 py-3.5 text-left"
          >
            <span className="text-sm font-semibold text-slate-600">Ajustes rápidos</span>
            {settingsOpen ? <ChevronUp size={16} className="text-slate-400" /> : <ChevronDown size={16} className="text-slate-400" />}
          </button>

          {settingsOpen && config && (
            <div className="border-t border-slate-100 px-4 py-4 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium text-slate-700">Recordatorios WhatsApp</div>
                  <div className="text-xs text-slate-500">
                    Envío diario a las {config.reminder_time || '18:40'}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={toggleReminders}
                  className={`relative h-7 w-12 rounded-full transition ${config.reminder_enabled ? 'bg-emerald-500' : 'bg-slate-300'}`}
                >
                  <span className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition ${config.reminder_enabled ? 'left-[22px]' : 'left-0.5'}`} />
                </button>
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium text-slate-700">Ventana de agenda</div>
                  <div className="text-xs text-slate-500">Días visibles para clientes</div>
                </div>
                <span className="rounded-xl bg-slate-100 px-3 py-1.5 text-sm font-medium text-slate-700">
                  {config.window_days || 10} días
                </span>
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium text-slate-700">Cobro automático</div>
                  <div className="text-xs text-slate-500">Reminder de pago antes de cita</div>
                </div>
                <span className={`rounded-xl px-3 py-1.5 text-sm font-medium ${config.payment_reminder_enabled ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                  {config.payment_reminder_enabled ? 'Activo' : 'Inactivo'}
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Empty state — only when no upcoming either */}
        {!selectedClient && !query && upcoming.length === 0 && !upcomingLoading && (
          <div className="py-8 text-center">
            <div className="mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-2xl bg-slate-100">
              <Search size={24} className="text-slate-400" />
            </div>
            <div className="text-sm font-medium text-slate-500">
              Busca un cliente para ejecutar acciones rápidas
            </div>
            <div className="mt-1 text-xs text-slate-400">
              Reagendar, recordar, gestionar recurrencia o ajustar arancel
            </div>
          </div>
        )}
      </div>

      {/* Recurring modal */}
      <RecurringQuickModal
        open={recurringModalOpen}
        clientName={selectedClient ? `${selectedClient.first_name} ${selectedClient.last_name}` : ''}
        schedule={null}
        sourceAppointment={
          selectedClient?.last_completed_id
            ? { id: selectedClient.last_completed_id, date_time: selectedClient.last_completed_date }
            : selectedClient?.next_appointment_id
              ? { id: selectedClient.next_appointment_id, date_time: selectedClient.next_appointment }
              : null
        }
        saving={recurringSaving}
        onClose={() => setRecurringModalOpen(false)}
        onSubmit={handleRecurringSubmit}
      />
    </AdminLayout>
  );
}

// ─── Action Panel (contextual per action) ─────────────────────────

function ActionPanel({
  actionId,
  client,
  loading,
  feeValue,
  setFeeValue,
  cancelEndRecurring,
  setCancelEndRecurring,
  cancelSendWA,
  setCancelSendWA,
  noshowSendWA,
  setNoshowSendWA,
  onExecute,
  onRecurringActivate,
  onRecurringPause,
  onRecurringResume,
  onRecurringEnd,
}) {
  const action = ACTIONS.find((a) => a.id === actionId);
  if (!action) return null;

  // Recurring has its own UI
  if (actionId === 'recurring') {
    const hasActive = client.has_recurring > 0;
    const hasPaused = client.has_paused_recurring > 0;
    const hasAny = hasActive || hasPaused;
    return (
      <div className="space-y-3">
        <p className="text-sm text-slate-600">
          {hasActive
            ? `${client.first_name} tiene sesión semanal los ${formatWeekdayShort(client.recurring_day)} a las ${client.recurring_time}.`
            : hasPaused
              ? `${client.first_name} tiene recurrencia pausada (${formatWeekdayShort(client.recurring_day)} a las ${client.recurring_time}).`
              : `${client.first_name} no tiene sesión recurrente activa.`}
        </p>
        <div className="flex flex-wrap gap-2">
          {!hasAny && (
            <button
              type="button"
              onClick={onRecurringActivate}
              disabled={loading}
              className="rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-violet-700 active:scale-[0.97] disabled:opacity-60"
            >
              Activar semanal
            </button>
          )}
          {hasActive && (
            <>
              <button
                type="button"
                onClick={onRecurringPause}
                disabled={loading}
                className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 active:scale-[0.97] disabled:opacity-60"
              >
                {loading ? <Loader2 size={14} className="animate-spin" /> : 'Pausar'}
              </button>
              <button
                type="button"
                onClick={onRecurringEnd}
                disabled={loading}
                className="rounded-xl border border-red-200 bg-white px-4 py-2.5 text-sm font-semibold text-red-600 transition hover:bg-red-50 active:scale-[0.97] disabled:opacity-60"
              >
                Finalizar
              </button>
            </>
          )}
          {hasPaused && (
            <>
              <button
                type="button"
                onClick={onRecurringResume}
                disabled={loading}
                className="rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-violet-700 active:scale-[0.97] disabled:opacity-60"
              >
                {loading ? <Loader2 size={14} className="animate-spin" /> : 'Reactivar'}
              </button>
              <button
                type="button"
                onClick={onRecurringEnd}
                disabled={loading}
                className="rounded-xl border border-red-200 bg-white px-4 py-2.5 text-sm font-semibold text-red-600 transition hover:bg-red-50 active:scale-[0.97] disabled:opacity-60"
              >
                Finalizar
              </button>
            </>
          )}
        </div>
      </div>
    );
  }

  // Fee has input
  if (actionId === 'fee') {
    return (
      <div className="space-y-3">
        <p className="text-sm text-slate-600">Arancel actual: Bs {client.fee}</p>
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-slate-500">Bs</span>
          <input
            type="number"
            value={feeValue}
            onChange={(e) => setFeeValue(e.target.value)}
            className="w-24 rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-slate-400"
            min="0"
            step="10"
          />
          <button
            type="button"
            onClick={() => onExecute('fee')}
            disabled={loading}
            className="rounded-xl bg-amber-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-amber-700 active:scale-[0.97] disabled:opacity-60"
          >
            {loading ? <Loader2 size={14} className="animate-spin" /> : 'Guardar'}
          </button>
        </div>
      </div>
    );
  }

  // Cancel has options
  if (actionId === 'cancel') {
    return (
      <div className="space-y-3">
        <p className="text-sm text-slate-600">{action.desc}</p>

        {client.has_recurring > 0 && (
          <label className="flex items-center gap-2.5">
            <input
              type="checkbox"
              checked={cancelEndRecurring}
              onChange={(e) => setCancelEndRecurring(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300"
            />
            <span className="text-sm text-slate-700">También finalizar recurrencia semanal</span>
          </label>
        )}

        <label className="flex items-center gap-2.5">
          <input
            type="checkbox"
            checked={cancelSendWA}
            onChange={(e) => setCancelSendWA(e.target.checked)}
            className="h-4 w-4 rounded border-slate-300"
          />
          <span className="text-sm text-slate-700">Avisar al cliente por WhatsApp</span>
        </label>

        <button
          type="button"
          onClick={() => onExecute('cancel')}
          disabled={loading}
          className="w-full rounded-xl bg-red-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-red-700 active:scale-[0.97] disabled:opacity-60"
        >
          {loading ? <Loader2 size={14} className="mx-auto animate-spin" /> : 'Confirmar cancelación'}
        </button>
      </div>
    );
  }

  // No-show has option
  if (actionId === 'noshow') {
    return (
      <div className="space-y-3">
        <p className="text-sm text-slate-600">{action.desc}</p>

        <label className="flex items-center gap-2.5">
          <input
            type="checkbox"
            checked={noshowSendWA}
            onChange={(e) => setNoshowSendWA(e.target.checked)}
            className="h-4 w-4 rounded border-slate-300"
          />
          <span className="text-sm text-slate-700">Avisar al cliente por WhatsApp</span>
        </label>

        <button
          type="button"
          onClick={() => onExecute('noshow')}
          disabled={loading}
          className="w-full rounded-xl bg-slate-700 px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 active:scale-[0.97] disabled:opacity-60"
        >
          {loading ? <Loader2 size={14} className="mx-auto animate-spin" /> : 'Marcar no-show'}
        </button>
      </div>
    );
  }

  // Default: simple execute button (reschedule, reminder)
  const primaryLabel = {
    reschedule: 'Enviar link de reagendamiento',
    reminder: 'Enviar recordatorio de cita',
    'payment-reminder': 'Enviar recordatorio de cobro',
    noshow: 'Marcar no-show',
  }[actionId] || `Ejecutar ${action.label.toLowerCase()}`;

  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-600">{action.desc}</p>
      <button
        type="button"
        onClick={() => onExecute(actionId)}
        disabled={loading}
        className={`w-full rounded-xl px-4 py-3 text-sm font-semibold text-white transition active:scale-[0.97] disabled:opacity-60 ${action.color} hover:opacity-90`}
      >
        {loading ? <Loader2 size={14} className="mx-auto animate-spin" /> : primaryLabel}
      </button>
    </div>
  );
}
