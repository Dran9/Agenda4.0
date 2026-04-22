import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Phone, MapPin, Clock, Calendar, DollarSign, MessageSquare,
  User, Activity, FileText, ChevronRight
} from 'lucide-react';
import AdminLayout from '../../components/AdminLayout';
import { api } from '../../utils/api';
import { useToast, Toast } from '../../hooks/useToast';
import { formatDateBolivia, formatTimeBolivia, formatRelativeDay } from '../../utils/dates';

const TABS = [
  { id: 'info', label: 'Info general', icon: User },
  { id: 'appointments', label: 'Citas', icon: Calendar },
  { id: 'payments', label: 'Pagos', icon: DollarSign },
  { id: 'whatsapp', label: 'WhatsApp', icon: MessageSquare },
  { id: 'timeline', label: 'Timeline', icon: Activity },
];

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
    'Al día': { bg: '#d1fae5', text: '#047857' },
    'En pausa': { bg: '#fef3c7', text: '#b45309' },
    'En riesgo': { bg: '#fef3c7', text: '#92400e' },
    'Perdido': { bg: '#fee2e2', text: '#b91c1c' },
  };
  return colors[status] || { bg: '#e5e7eb', text: '#4b5563' };
}

export default function ClientProfile() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { toast, show: showToast } = useToast();
  const [client, setClient] = useState(null);
  const [appointments, setAppointments] = useState([]);
  const [payments, setPayments] = useState([]);
  const [waMessages, setWaMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('info');

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [clientRes, apptsRes, paymentsRes, waRes] = await Promise.all([
        api.get(`/clients/${id}`),
        api.get(`/appointments?client_id=${id}&limit=100`).catch(() => ({ appointments: [] })),
        api.get(`/payments?client_id=${id}&limit=100`).catch(() => ({ payments: [] })),
        api.get(`/webhook/conversations?limit=50`).catch(() => ({ conversations: [] })),
      ]);
      setClient(clientRes.client || clientRes);
      setAppointments(apptsRes.appointments || []);
      setPayments(paymentsRes.payments || []);
      setWaMessages((waRes.conversations || []).filter(m => m.client_id == id));
    } catch (err) {
      showToast('Error cargando perfil: ' + err.message, 'error');
    } finally {
      setLoading(false);
    }
  }, [id, showToast]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  if (loading) {
    return (
      <AdminLayout title="Perfil de cliente">
        <div className="p-8 text-center text-gray-400">Cargando perfil...</div>
      </AdminLayout>
    );
  }

  if (!client) {
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

  const fullName = `${client.first_name} ${client.last_name}`.trim();
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

  return (
    <AdminLayout title={fullName}>
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
            {client.first_name?.[0]}{client.last_name?.[0]}
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="text-2xl font-bold text-gray-900">{fullName}</h1>
            <div className="flex flex-wrap items-center gap-3 mt-2">
              <a
                href={`https://wa.me/${client.phone}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-sm text-blue-600 hover:underline"
              >
                <Phone size={14} /> {client.phone}
              </a>
              {(client.city || client.country) && (
                <span className="inline-flex items-center gap-1 text-sm text-gray-500">
                  <MapPin size={14} /> {[client.city, client.country].filter(Boolean).join(', ')}
                </span>
              )}
              <span className="inline-flex items-center gap-1 text-sm text-gray-500">
                <Clock size={14} /> {client.timezone || 'America/La_Paz'}
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
              {client.special_fee_enabled && (
                <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold bg-amber-50 text-amber-700">
                  QR Especial
                </span>
              )}
            </div>
          </div>

          <button
            type="button"
            onClick={() => navigate(`/admin/clients?edit=${id}`)}
            className="px-4 py-2 bg-gray-900 text-white rounded-lg text-sm font-medium hover:bg-gray-800 flex-shrink-0"
          >
            Editar
          </button>
        </div>
      </div>

      {/* Context grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="text-xs text-gray-400 uppercase tracking-wider font-semibold mb-1">Edad</div>
          <div className="text-lg font-bold text-gray-900">{client.age ? `${client.age} años` : '—'}</div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="text-xs text-gray-400 uppercase tracking-wider font-semibold mb-1">Arancel</div>
          <div className="text-lg font-bold text-gray-900">{client.fee_currency} {client.fee}</div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="text-xs text-gray-400 uppercase tracking-wider font-semibold mb-1">Sesiones</div>
          <div className="text-lg font-bold text-gray-900">{client.completed_sessions || 0}</div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="text-xs text-gray-400 uppercase tracking-wider font-semibold mb-1">Fuente</div>
          <div className="text-lg font-bold text-gray-900">{client.source || '—'}</div>
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
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {activeTab === 'info' && (
          <div className="p-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <h3 className="text-sm font-semibold text-gray-900 mb-3 flex items-center gap-2">
                  <User size={16} /> Información personal
                </h3>
                <div className="space-y-3">
                  <div className="flex justify-between py-2 border-b border-gray-100">
                    <span className="text-sm text-gray-500">Nombre</span>
                    <span className="text-sm font-medium text-gray-900">{client.first_name}</span>
                  </div>
                  <div className="flex justify-between py-2 border-b border-gray-100">
                    <span className="text-sm text-gray-500">Apellido</span>
                    <span className="text-sm font-medium text-gray-900">{client.last_name}</span>
                  </div>
                  <div className="flex justify-between py-2 border-b border-gray-100">
                    <span className="text-sm text-gray-500">Teléfono</span>
                    <a href={`https://wa.me/${client.phone}`} className="text-sm font-medium text-blue-600 hover:underline">{client.phone}</a>
                  </div>
                  <div className="flex justify-between py-2 border-b border-gray-100">
                    <span className="text-sm text-gray-500">Edad</span>
                    <span className="text-sm font-medium text-gray-900">{client.age || '—'}</span>
                  </div>
                  <div className="flex justify-between py-2 border-b border-gray-100">
                    <span className="text-sm text-gray-500">Ciudad</span>
                    <span className="text-sm font-medium text-gray-900">{client.city || '—'}</span>
                  </div>
                  <div className="flex justify-between py-2 border-b border-gray-100">
                    <span className="text-sm text-gray-500">País</span>
                    <span className="text-sm font-medium text-gray-900">{client.country || '—'}</span>
                  </div>
                  <div className="flex justify-between py-2 border-b border-gray-100">
                    <span className="text-sm text-gray-500">Zona horaria</span>
                    <span className="text-sm font-medium text-gray-900">{client.timezone}</span>
                  </div>
                </div>
              </div>

              <div>
                <h3 className="text-sm font-semibold text-gray-900 mb-3 flex items-center gap-2">
                  <FileText size={16} /> Detalles clínicos y administrativos
                </h3>
                <div className="space-y-3">
                  <div className="flex justify-between py-2 border-b border-gray-100">
                    <span className="text-sm text-gray-500">Modalidad</span>
                    <span className="text-sm font-medium text-gray-900">{client.modality || '—'}</span>
                  </div>
                  <div className="flex justify-between py-2 border-b border-gray-100">
                    <span className="text-sm text-gray-500">Frecuencia</span>
                    <span className="text-sm font-medium text-gray-900">{client.frequency || '—'}</span>
                  </div>
                  <div className="flex justify-between py-2 border-b border-gray-100">
                    <span className="text-sm text-gray-500">Fuente</span>
                    <span className="text-sm font-medium text-gray-900">{client.source || '—'}</span>
                  </div>
                  <div className="flex justify-between py-2 border-b border-gray-100">
                    <span className="text-sm text-gray-500">Referido por</span>
                    <span className="text-sm font-medium text-gray-900">{client.referred_by || '—'}</span>
                  </div>
                  <div className="flex justify-between py-2 border-b border-gray-100">
                    <span className="text-sm text-gray-500">Arancel</span>
                    <span className="text-sm font-medium text-gray-900">{client.fee_currency} {client.fee}</span>
                  </div>
                  <div className="flex justify-between py-2 border-b border-gray-100">
                    <span className="text-sm text-gray-500">Método de pago</span>
                    <span className="text-sm font-medium text-gray-900">{client.payment_method || '—'}</span>
                  </div>
                  <div className="py-2">
                    <span className="text-sm text-gray-500 block mb-1">Diagnóstico</span>
                    <span className="text-sm text-gray-900 whitespace-pre-wrap">{client.diagnosis || 'Sin diagnóstico registrado'}</span>
                  </div>
                  <div className="py-2">
                    <span className="text-sm text-gray-500 block mb-1">Notas</span>
                    <span className="text-sm text-gray-900 whitespace-pre-wrap">{client.notes || 'Sin notas'}</span>
                  </div>
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
    </AdminLayout>
  );
}
