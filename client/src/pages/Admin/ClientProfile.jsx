import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Phone, MapPin, Clock, Calendar, DollarSign, MessageSquare,
  User, Activity, FileText, ChevronRight, Save, X
} from 'lucide-react';
import AdminLayout from '../../components/AdminLayout';
import { api } from '../../utils/api';
import { useToast, Toast } from '../../hooks/useToast';
import { formatDateBolivia, formatTimeBolivia, formatRelativeDay } from '../../utils/dates';
import { TIMEZONE_OPTIONS } from '../../utils/timezones';

const TABS = [
  { id: 'info', label: 'Info general', icon: User },
  { id: 'appointments', label: 'Citas', icon: Calendar },
  { id: 'payments', label: 'Pagos', icon: DollarSign },
  { id: 'whatsapp', label: 'WhatsApp', icon: MessageSquare },
  { id: 'timeline', label: 'Timeline', icon: Activity },
];

function formatFeeDisplay(value, currency) {
  let amount = Number(value);
  if (!Number.isFinite(amount)) return '0';
  const cur = String(currency || 'BOB').toUpperCase();
  if (cur === 'BOB' && amount >= 1000 && amount % 10 === 0) {
    const scaled = amount / 10;
    if (scaled >= 80 && scaled <= 800) amount = scaled;
  }
  return cur === 'USD'
    ? amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : amount.toLocaleString('es-BO', { minimumFractionDigits: 0, maximumFractionDigits: Number.isInteger(amount) ? 0 : 2 });
}

const DEFAULT_STATUSES = [
  { name: 'Nuevo', color: '#3B82F6' },
  { name: 'Activo', color: '#10B981' },
  { name: 'Recurrente', color: '#059669' },
  { name: 'En pausa', color: '#F59E0B' },
  { name: 'Inactivo', color: '#9CA3AF' },
  { name: 'Archivado', color: '#EF4444' },
];

const DEFAULT_SOURCES = ['Referencia de amigos', 'Redes sociales', 'Otro'];

const MODALITIES = ['Presencial', 'Online', 'Mixto'];
const FREQUENCIES = ['Semanal', 'Quincenal', 'Mensual', 'Irregular'];
const PAYMENT_METHODS = ['QR', 'Efectivo', 'Transferencia'];
const CURRENCIES = ['BOB', 'USD'];

function statusColor(status) {
  const colors = {
    'Nuevo': { bg: '#dbeafe', text: '#1e40af' },
    'Activo': { bg: '#d1fae5', text: '#047857' },
    'Recurrente': { bg: '#dbeafe', text: '#1e40af' },
    'En pausa': { bg: '#fef3c7', text: '#92400e' },
    'Inactivo': { bg: '#f3f4f6', text: '#4b5563' },
    'Archivado': { bg: '#fee2e2', text: '#991b1b' },
  };
  return colors[status] || { bg: '#f3f4f6', text: '#4b5563' };
}

function retentionColor(status) {
  const colors = {
    'Con cita': { bg: '#dbeafe', text: '#1d4ed8' },
    'Recurrente': { bg: '#dbeafe', text: '#1d4ed8' },
    'Al dia': { bg: '#d1fae5', text: '#047857' },
    'En pausa': { bg: '#fef3c7', text: '#b45309' },
    'En riesgo': { bg: '#fef3c7', text: '#92400e' },
    'Perdido': { bg: '#fee2e2', text: '#b91c1c' },
  };
  return colors[status] || { bg: '#e5e7eb', text: '#4b5563' };
}

function getTimezoneOptions(currentTimezone) {
  const tzSet = new Set(TIMEZONE_OPTIONS.map((option) => option.tz));
  if (currentTimezone && !tzSet.has(currentTimezone)) {
    return [{ tz: currentTimezone, label: currentTimezone }, ...TIMEZONE_OPTIONS];
  }
  return TIMEZONE_OPTIONS;
}

export default function ClientProfile() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { toast, show: showToast } = useToast();
  const [client, setClient] = useState(null);
  const [draft, setDraft] = useState(null);
  const [appointments, setAppointments] = useState([]);
  const [payments, setPayments] = useState([]);
  const [waMessages, setWaMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState('info');
  const [statuses, setStatuses] = useState(DEFAULT_STATUSES);
  const [sources, setSources] = useState(DEFAULT_SOURCES);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [clientRes, apptsRes, paymentsRes, waRes, cfgRes] = await Promise.all([
        api.get(`/clients/${id}`),
        api.get(`/appointments?client_id=${id}&limit=100`).catch(() => ({ appointments: [] })),
        api.get(`/payments?client_id=${id}&limit=100`).catch(() => ({ payments: [] })),
        api.get(`/webhook/conversations?client_id=${id}&limit=50`).catch(() => ({ conversations: [] })),
        api.get('/config').catch(() => ({}))
      ]);
      const c = clientRes.client || clientRes;
      setClient(c);
      setDraft({ ...c });
      setAppointments(apptsRes.appointments || []);
      setPayments(paymentsRes.payments || []);
      setWaMessages(waRes.conversations || []);

      if (cfgRes.custom_statuses) {
        const s = typeof cfgRes.custom_statuses === 'string' ? JSON.parse(cfgRes.custom_statuses) : cfgRes.custom_statuses;
        if (s.length > 0) setStatuses(s);
      }
      if (cfgRes.custom_sources) {
        const s = typeof cfgRes.custom_sources === 'string' ? JSON.parse(cfgRes.custom_sources) : cfgRes.custom_sources;
        if (s.length > 0) setSources(s);
      }
    } catch (err) {
      showToast('Error cargando perfil: ' + err.message, 'error');
    } finally {
      setLoading(false);
    }
  }, [id, showToast]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const hasChanges = draft && client && JSON.stringify(draft) !== JSON.stringify(client);

  function updateField(field, value) {
    setDraft(prev => ({ ...prev, [field]: value }));
  }

  async function handleSave() {
    if (!draft || !client) return;
    setSaving(true);
    try {
      const fields = [
        'first_name', 'last_name', 'phone', 'age', 'city', 'country', 'timezone',
        'modality', 'frequency', 'source', 'fee', 'fee_currency', 'payment_method',
        'notes', 'diagnosis', 'status_override'
      ];
      for (const f of fields) {
        if (draft[f] !== client[f]) {
          await api.put(`/clients/${id}`, { [f]: draft[f] });
        }
      }
      setClient({ ...draft });
      showToast('Cambios guardados');
    } catch (err) {
      showToast('Error guardando: ' + err.message, 'error');
    } finally {
      setSaving(false);
    }
  }

  function handleCancel() {
    if (client) setDraft({ ...client });
  }

  if (loading) {
    return (
      <AdminLayout title="Perfil de cliente">
        <div className="p-8 text-center text-gray-400">Cargando perfil...</div>
      </AdminLayout>
    );
  }

  if (!client || !draft) {
    return (
      <AdminLayout title="Perfil de cliente">
        <div className="p-8 text-center">
          <div className="text-gray-400 mb-4">Cliente no encontrado</div>
          <button
            type="button"
            onClick={() => navigate('/admin/clients')}
            className="px-4 py-2 bg-gray-900 text-white rounded-lg text-sm font-medium hover:bg-gray-800"
          >
            Volver a clientes
          </button>
        </div>
      </AdminLayout>
    );
  }

  const fullName = `${draft.first_name || ''} ${draft.last_name || ''}`.trim();
  const stColor = statusColor(client.calculated_status);
  const rtColor = retentionColor(client.retention_status);

  // Build timeline
  const timeline = [
    ...appointments.map(a => ({
      type: 'appointment',
      date: a.date_time,
      title: `Cita ${a.status?.toLowerCase()}`,
      desc: `${formatDateBolivia(a.date_time)} · ${formatTimeBolivia(a.date_time)}`,
      status: a.status,
      id: `appt-${a.id}`,
    })),
    ...payments.map(p => ({
      type: 'payment',
      date: p.created_at,
      title: `Pago ${p.status?.toLowerCase()}`,
      desc: `${p.currency} ${p.amount}`,
      status: p.status,
      id: `pay-${p.id}`,
    })),
    ...waMessages.map(m => ({
      type: 'whatsapp',
      date: m.created_at,
      title: m.direction === 'inbound' ? 'Mensaje recibido' : 'Mensaje enviado',
      desc: m.content?.substring(0, 80) + (m.content?.length > 80 ? '...' : ''),
      status: m.direction,
      id: `wa-${m.id}`,
    })),
  ].sort((a, b) => new Date(b.date) - new Date(a.date));

  // Reusable inline field component
  function InlineField({ label, field, type = 'text', options = null, textarea = false, placeholder = '' }) {
    const value = draft[field];

    if (textarea) {
      return (
        <div className="py-2">
          <span className="text-xs text-gray-400 block mb-1.5 uppercase tracking-wider font-semibold">{label}</span>
          <textarea
            value={value || ''}
            onChange={e => updateField(field, e.target.value || null)}
            placeholder={placeholder}
            rows={3}
            className="w-full text-sm text-gray-900 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:border-[#4E769B] focus:ring-1 focus:ring-[#4E769B] resize-none"
          />
        </div>
      );
    }

    if (options) {
      return (
        <div className="flex justify-between items-center py-2 border-b border-gray-100">
          <span className="text-sm text-gray-500">{label}</span>
          <select
            value={value || ''}
            onChange={e => updateField(field, e.target.value || null)}
            className="text-sm font-medium text-gray-900 bg-gray-50 border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:border-[#4E769B] focus:ring-1 focus:ring-[#4E769B]"
          >
            {field === 'status_override' && <option value="">Auto ({client.calculated_status})</option>}
            {options.map(opt => (
              typeof opt === 'string'
                ? <option key={opt} value={opt}>{opt}</option>
                : <option key={opt.value || opt.name} value={opt.value || opt.name}>{opt.label || opt.name}</option>
            ))}
          </select>
        </div>
      );
    }

    return (
      <div className="flex justify-between items-center py-2 border-b border-gray-100">
        <span className="text-sm text-gray-500">{label}</span>
        <input
          type={type}
          value={value || ''}
          onChange={e => {
            const raw = e.target.value;
            if (type === 'number') {
              updateField(field, raw === '' ? null : parseFloat(raw));
            } else {
              updateField(field, raw || null);
            }
          }}
          placeholder={placeholder}
          className="text-sm font-medium text-gray-900 bg-gray-50 border border-gray-200 rounded-lg px-3 py-1.5 w-40 text-right focus:outline-none focus:border-[#4E769B] focus:ring-1 focus:ring-[#4E769B]"
        />
      </div>
    );
  }

  return (
    <AdminLayout title={fullName || 'Perfil de cliente'}>
      <Toast toast={toast} />

      {/* Header */}
      <div className="mb-6">
        <button
          type="button"
          onClick={() => navigate('/admin/clients')}
          className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800 mb-4"
        >
          <ArrowLeft size={16} /> Volver a clientes
        </button>

        <div className="flex items-start gap-4">
          <div className="w-14 h-14 rounded-full bg-[#4E769B] text-white flex items-center justify-center text-xl font-bold flex-shrink-0">
            {draft.first_name?.[0]}{draft.last_name?.[0]}
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="text-2xl font-bold text-gray-900">{fullName || 'Sin nombre'}</h1>
            <div className="flex flex-wrap items-center gap-3 mt-2">
              <a
                href={`https://wa.me/${draft.phone}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-sm text-blue-600 hover:underline"
              >
                <Phone size={14} /> {draft.phone || '—'}
              </a>
              {(draft.city || draft.country) && (
                <span className="inline-flex items-center gap-1 text-sm text-gray-500">
                  <MapPin size={14} /> {[draft.city, draft.country].filter(Boolean).join(', ')}
                </span>
              )}
              <span className="inline-flex items-center gap-1 text-sm text-gray-500">
                <Clock size={14} /> {draft.timezone || 'America/La_Paz'}
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-2 mt-3">
              <span
                className="inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold"
                style={{ backgroundColor: stColor.bg, color: stColor.text }}
              >
                {client.calculated_status}
              </span>
              <span
                className="inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold"
                style={{ backgroundColor: rtColor.bg, color: rtColor.text }}
              >
                {client.retention_status}
                {client.days_since_last_session != null && ` · ${client.days_since_last_session}d`}
              </span>
              {client.has_active_recurring > 0 && (
                <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold bg-blue-50 text-blue-700">
                  Recurrente
                </span>
              )}
              {draft.special_fee_enabled && (
                <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold bg-amber-50 text-amber-700">
                  QR Especial
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Context grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="text-xs text-gray-400 uppercase tracking-wider font-semibold mb-1">Edad</div>
          <div className="text-lg font-bold text-gray-900">{draft.age ? `${draft.age} años` : '—'}</div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="text-xs text-gray-400 uppercase tracking-wider font-semibold mb-1">Arancel</div>
          <div className="text-lg font-bold text-gray-900">{draft.fee_currency} {formatFeeDisplay(draft.fee, draft.fee_currency)}</div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="text-xs text-gray-400 uppercase tracking-wider font-semibold mb-1">Sesiones</div>
          <div className="text-lg font-bold text-gray-900">{client.completed_sessions || 0}</div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="text-xs text-gray-400 uppercase tracking-wider font-semibold mb-1">Fuente</div>
          <div className="text-lg font-bold text-gray-900">{draft.source || '—'}</div>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200 mb-6">
        <div className="flex gap-1 overflow-x-auto">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`inline-flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition whitespace-nowrap ${
                  isActive
                    ? 'border-[#4E769B] text-[#4E769B]'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                <Icon size={16} /> {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Tab content */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden mb-24">
        {activeTab === 'info' && (
          <div className="p-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <h3 className="text-sm font-semibold text-gray-900 mb-3 flex items-center gap-2">
                  <User size={16} /> Información personal
                </h3>
                <div className="space-y-0">
                  <InlineField label="Nombre" field="first_name" />
                  <InlineField label="Apellido" field="last_name" />
                  <InlineField label="Teléfono" field="phone" />
                  <InlineField label="Edad" field="age" type="number" />
                  <InlineField label="Ciudad" field="city" />
                  <InlineField label="País" field="country" />
                  <InlineField
                    label="Zona horaria"
                    field="timezone"
                    options={getTimezoneOptions(draft.timezone)}
                  />
                </div>
              </div>

              <div>
                <h3 className="text-sm font-semibold text-gray-900 mb-3 flex items-center gap-2">
                  <FileText size={16} /> Detalles clínicos y administrativos
                </h3>
                <div className="space-y-0">
                  <InlineField label="Modalidad" field="modality" options={MODALITIES} />
                  <InlineField label="Frecuencia" field="frequency" options={FREQUENCIES} />
                  <InlineField label="Fuente" field="source" options={sources} />
                  <div className="flex justify-between items-center py-2 border-b border-gray-100">
                    <span className="text-sm text-gray-500">Arancel</span>
                    <div className="flex items-center gap-2">
                      <select
                        value={draft.fee_currency || 'BOB'}
                        onChange={e => updateField('fee_currency', e.target.value)}
                        className="text-sm font-medium text-gray-900 bg-gray-50 border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:border-[#4E769B]"
                      >
                        {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
                      </select>
                      <input
                        type="number"
                        value={draft.fee || ''}
                        onChange={e => updateField('fee', e.target.value === '' ? null : parseFloat(e.target.value))}
                        className="text-sm font-medium text-gray-900 bg-gray-50 border border-gray-200 rounded-lg px-3 py-1.5 w-24 text-right focus:outline-none focus:border-[#4E769B] focus:ring-1 focus:ring-[#4E769B]"
                      />
                    </div>
                  </div>
                  <InlineField label="Método de pago" field="payment_method" options={PAYMENT_METHODS} />
                  <InlineField
                    label="Status"
                    field="status_override"
                    options={statuses.map(s => ({ name: s.name, label: s.name }))}
                  />
                  <InlineField
                    label="Diagnóstico"
                    field="diagnosis"
                    textarea
                    placeholder="Sin diagnóstico registrado"
                  />
                  <InlineField
                    label="Notas"
                    field="notes"
                    textarea
                    placeholder="Sin notas"
                  />
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'appointments' && (
          <div className="divide-y divide-gray-100">
            {appointments.length === 0 ? (
              <div className="p-8 text-center text-gray-400">No hay citas registradas</div>
            ) : (
              appointments.map((appt) => (
                <div key={appt.id} className="p-4 flex items-center justify-between hover:bg-gray-50">
                  <div className="flex items-center gap-3">
                    <div className={`w-2 h-2 rounded-full ${
                      appt.status === 'Completada' ? 'bg-green-500' :
                      appt.status === 'Cancelada' ? 'bg-red-500' :
                      appt.status === 'No-show' ? 'bg-gray-500' :
                      'bg-blue-500'
                    }`} />
                    <div>
                      <div className="text-sm font-medium text-gray-900">
                        {formatDateBolivia(appt.date_time)} · {formatTimeBolivia(appt.date_time)}
                      </div>
                      <div className="text-xs text-gray-500">{appt.status} · Sesión #{appt.session_number}{appt.is_first ? ' (primera)' : ''}</div>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => navigate(`/admin/appointments?search=${client.phone}`)}
                    className="text-gray-400 hover:text-gray-600"
                  >
                    <ChevronRight size={16} />
                  </button>
                </div>
              ))
            )}
          </div>
        )}

        {activeTab === 'payments' && (
          <div className="divide-y divide-gray-100">
            {payments.length === 0 ? (
              <div className="p-8 text-center text-gray-400">No hay pagos registrados</div>
            ) : (
              payments.map((payment) => (
                <div key={payment.id} className="p-4 flex items-center justify-between hover:bg-gray-50">
                  <div className="flex items-center gap-3">
                    <div className={`w-2 h-2 rounded-full ${
                      payment.status === 'Confirmado' ? 'bg-green-500' :
                      payment.status === 'Rechazado' ? 'bg-red-500' :
                      payment.status === 'Mismatch' ? 'bg-amber-500' :
                      'bg-gray-400'
                    }`} />
                    <div>
                      <div className="text-sm font-medium text-gray-900">
                        {payment.currency} {payment.amount}
                      </div>
                      <div className="text-xs text-gray-500">
                        {payment.status} · {formatDateBolivia(payment.created_at)}
                        {payment.ocr_extracted_amount && ` · OCR: ${payment.ocr_extracted_amount}`}
                      </div>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {activeTab === 'whatsapp' && (
          <div className="divide-y divide-gray-100">
            {waMessages.length === 0 ? (
              <div className="p-8 text-center text-gray-400">No hay mensajes de WhatsApp</div>
            ) : (
              waMessages.map((msg) => (
                <div key={msg.id} className={`p-4 ${msg.direction === 'inbound' ? 'bg-blue-50/50' : ''}`}>
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`text-xs font-semibold ${
                      msg.direction === 'inbound' ? 'text-blue-600' : 'text-gray-500'
                    }`}>
                      {msg.direction === 'inbound' ? 'Recibido' : 'Enviado'}
                    </span>
                    <span className="text-xs text-gray-400">{formatRelativeDay(msg.created_at)}</span>
                  </div>
                  <div className="text-sm text-gray-900 whitespace-pre-wrap">{msg.content}</div>
                </div>
              ))
            )}
          </div>
        )}

        {activeTab === 'timeline' && (
          <div className="p-6">
            {timeline.length === 0 ? (
              <div className="text-center text-gray-400 py-8">No hay actividad registrada</div>
            ) : (
              <div className="space-y-4">
                {timeline.map((item) => (
                  <div key={item.id} className="flex gap-4">
                    <div className="flex flex-col items-center">
                      <div className={`w-3 h-3 rounded-full ${
                        item.type === 'appointment' ? 'bg-blue-500' :
                        item.type === 'payment' ? 'bg-green-500' :
                        'bg-gray-400'
                      }`} />
                      <div className="w-px h-full bg-gray-200 mt-1" />
                    </div>
                    <div className="flex-1 pb-6">
                      <div className="text-xs text-gray-400 mb-1">{formatDateBolivia(item.date)} · {formatTimeBolivia(item.date)}</div>
                      <div className="text-sm font-semibold text-gray-900">{item.title}</div>
                      <div className="text-sm text-gray-600">{item.desc}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Floating save bar */}
      {hasChanges && (
        <div className="fixed bottom-0 left-0 right-0 z-40 p-4 bg-white/95 backdrop-blur border-t border-gray-200 shadow-[0_-4px_20px_rgba(0,0,0,0.08)]">
          <div className="max-w-5xl mx-auto flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm text-gray-600">
              <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
              Tienes cambios sin guardar
            </div>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={handleCancel}
                disabled={saving}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-gray-200 text-sm font-semibold text-gray-600 hover:bg-gray-50 transition"
              >
                <X size={16} /> Cancelar
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#4E769B] text-white text-sm font-semibold hover:bg-[#3d5f7d] transition shadow-lg shadow-[#4E769B]/20"
              >
                <Save size={16} /> {saving ? 'Guardando...' : 'Guardar cambios'}
              </button>
            </div>
          </div>
        </div>
      )}
    </AdminLayout>
  );
}
