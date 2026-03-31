import { useState, useEffect, useRef } from 'react';
import { MessageSquare, ArrowDownLeft, ArrowUpRight, Send, RefreshCw, Filter, ChevronLeft, ChevronRight } from 'lucide-react';
import AdminLayout from '../../components/AdminLayout';
import { api } from '../../utils/api';

// Component that loads an image with auth headers
function AuthImage({ fileKey, alt, className, onClick }) {
  const [src, setSrc] = useState(null);
  const loaded = useRef(false);
  useEffect(() => {
    if (!fileKey || loaded.current) return;
    loaded.current = true;
    const token = localStorage.getItem('auth_token');
    fetch(`/api/webhook/file/${fileKey}`, {
      headers: { 'Authorization': `Bearer ${token}` },
    })
      .then(r => { if (!r.ok) throw new Error(); return r.blob(); })
      .then(blob => setSrc(URL.createObjectURL(blob)))
      .catch(() => {});
  }, [fileKey]);
  if (!src) return null;
  return <img src={src} alt={alt} className={className} onClick={onClick} />;
}

const TYPE_LABELS = {
  text: 'Texto',
  button_reply: 'Botón',
  template: 'Template',
  auto_reply: 'Auto-respuesta',
  image: 'Imagen',
  document: 'Documento',
};

const TYPE_COLORS = {
  text: 'bg-gray-100 text-gray-700',
  button_reply: 'bg-blue-100 text-blue-700',
  template: 'bg-purple-100 text-purple-700',
  auto_reply: 'bg-green-100 text-green-700',
  image: 'bg-amber-100 text-amber-700',
  document: 'bg-orange-100 text-orange-700',
};

const LOG_TYPE_LABELS = {
  reminder_sent: 'Recordatorio',
  button_reply: 'Respuesta botón',
  message_sent: 'Mensaje enviado',
  booking: 'Booking',
  reschedule: 'Reagendamiento',
  cancel: 'Cancelación',
  client_new: 'Cliente nuevo',
  status_change: 'Cambio estado',
};

const LOG_STATUS_COLORS = {
  enviado: 'bg-green-100 text-green-700',
  recibido: 'bg-blue-100 text-blue-700',
  error: 'bg-red-100 text-red-700',
  procesado: 'bg-gray-100 text-gray-700',
};

function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return d.toLocaleDateString('es-BO', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
    hour12: false, timeZone: 'America/La_Paz',
  });
}

export default function WhatsApp() {
  const [tab, setTab] = useState('conversations');
  const [conversations, setConversations] = useState([]);
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [filterDirection, setFilterDirection] = useState('');
  const [filterType, setFilterType] = useState('');
  const [filterLogType, setFilterLogType] = useState('');
  const [triggerResult, setTriggerResult] = useState(null);
  const limit = 30;

  useEffect(() => {
    setPage(1);
  }, [tab, filterDirection, filterType, filterLogType]);

  useEffect(() => {
    loadData();
  }, [tab, page, filterDirection, filterType, filterLogType]);

  async function loadData() {
    setLoading(true);
    try {
      if (tab === 'conversations') {
        const params = new URLSearchParams({ page, limit });
        if (filterDirection) params.set('direction', filterDirection);
        if (filterType) params.set('type', filterType);
        const data = await api.get(`/webhook/conversations?${params}`);
        setConversations(data.conversations);
        setTotal(data.total);
      } else {
        const params = new URLSearchParams({ page, limit });
        if (filterLogType) params.set('type', filterLogType);
        const data = await api.get(`/webhook/log?${params}`);
        setLogs(data.logs);
        setTotal(data.total);
      }
    } catch (err) {
      console.error('Error loading WhatsApp data:', err);
    }
    setLoading(false);
  }

  async function triggerReminder(date) {
    setTriggerResult(null);
    try {
      const data = await api.get(`/admin/test-reminder?date=${date}`);
      setTriggerResult({ date, ...data });
    } catch (err) {
      setTriggerResult({ date, error: err.message });
    }
  }

  const totalPages = Math.ceil(total / limit);

  return (
    <AdminLayout title="WhatsApp">
      {/* Trigger reminders */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 mb-4">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-2">
            <Send size={16} className="text-gray-500" />
            <span className="text-sm font-medium text-gray-700">Enviar pendientes</span>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={() => triggerReminder('today')} className="btn-sm bg-gray-100 hover:bg-gray-200 text-gray-700 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors">
              Hoy
            </button>
            <button type="button" onClick={() => triggerReminder('tomorrow')} className="btn-sm bg-gray-900 hover:bg-gray-800 text-white px-3 py-1.5 rounded-lg text-sm font-medium transition-colors">
              Mañana
            </button>
          </div>
        </div>
        {triggerResult && (
          <div className={`mt-3 text-sm px-3 py-2 rounded-lg ${triggerResult.error ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700'}`}>
            {triggerResult.error
              ? `Error: ${triggerResult.error}`
              : `${triggerResult.date === 'today' ? 'Hoy' : 'Mañana'}: ${triggerResult.sent} enviados, ${triggerResult.skipped} omitidos por dedupe, ${triggerResult.total} eventos en GCal`
            }
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-4 bg-gray-100 rounded-lg p-1 w-fit">
        <button
          type="button"
          onClick={() => setTab('conversations')}
          className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${tab === 'conversations' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
        >
          Mensajes
        </button>
        <button
          type="button"
          onClick={() => setTab('log')}
          className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${tab === 'log' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
        >
          Activity Log
        </button>
      </div>

      {/* Filters + refresh */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <Filter size={14} className="text-gray-400" />
        {tab === 'conversations' ? (
          <>
            <select value={filterDirection} onChange={e => setFilterDirection(e.target.value)} className="text-sm border border-gray-200 rounded-lg px-2 py-1.5">
              <option value="">Todas</option>
              <option value="inbound">Recibidos</option>
              <option value="outbound">Enviados</option>
            </select>
            <select value={filterType} onChange={e => setFilterType(e.target.value)} className="text-sm border border-gray-200 rounded-lg px-2 py-1.5">
              <option value="">Todo tipo</option>
              <option value="text">Texto</option>
              <option value="button_reply">Botón</option>
              <option value="template">Template</option>
              <option value="auto_reply">Auto-respuesta</option>
            </select>
          </>
        ) : (
          <select value={filterLogType} onChange={e => setFilterLogType(e.target.value)} className="text-sm border border-gray-200 rounded-lg px-2 py-1.5">
            <option value="">Todo tipo</option>
            <option value="reminder_sent">Recordatorio</option>
            <option value="button_reply">Respuesta botón</option>
            <option value="booking">Booking</option>
            <option value="reschedule">Reagendamiento</option>
            <option value="cancel">Cancelación</option>
          </select>
        )}
        <button type="button" onClick={loadData} className="ml-auto p-1.5 rounded-lg hover:bg-gray-100 transition-colors" title="Refrescar">
          <RefreshCw size={16} className={`text-gray-500 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Content */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {loading ? (
          <div className="text-center py-12 text-gray-400 text-sm">Cargando...</div>
        ) : tab === 'conversations' ? (
          conversations.length === 0 ? (
            <div className="text-center py-12 text-gray-400 text-sm">No hay mensajes</div>
          ) : (
            <div className="divide-y divide-gray-100">
              {conversations.map(msg => (
                <div key={msg.id} className="px-4 py-3 hover:bg-gray-50 transition-colors">
                  <div className="flex items-start gap-3">
                    <div className={`mt-0.5 p-1.5 rounded-full ${msg.direction === 'inbound' ? 'bg-blue-50' : 'bg-green-50'}`}>
                      {msg.direction === 'inbound'
                        ? <ArrowDownLeft size={14} className="text-blue-600" />
                        : <ArrowUpRight size={14} className="text-green-600" />
                      }
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium text-gray-900">
                          {msg.first_name ? `${msg.first_name} ${msg.last_name || ''}`.trim() : msg.client_phone}
                        </span>
                        {msg.first_name && (
                          <span className="text-xs text-gray-400">{msg.client_phone}</span>
                        )}
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${TYPE_COLORS[msg.message_type] || 'bg-gray-100 text-gray-600'}`}>
                          {TYPE_LABELS[msg.message_type] || msg.message_type}
                        </span>
                        {msg.button_payload && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 font-mono">
                            {msg.button_payload}
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-gray-600 mt-0.5 break-words">{msg.content}</p>
                      {(msg.message_type === 'image' || msg.message_type === 'document') && msg.content?.includes('guardado:') && (
                        <>
                          <AuthImage
                            fileKey={msg.content.match(/guardado: ([^)]+)/)?.[1]}
                            alt="Comprobante"
                            className="mt-2 max-w-[200px] rounded-lg border border-gray-200 cursor-pointer hover:opacity-80"
                            onClick={e => window.open(e.target.src, '_blank')}
                          />
                          {(() => {
                            const meta = typeof msg.metadata === 'string' ? (() => { try { return JSON.parse(msg.metadata); } catch { return null; } })() : msg.metadata;
                            if (!meta || !meta.ocr_amount) return null;
                            return (
                              <div className="mt-2 bg-gray-50 rounded-lg px-3 py-2 text-xs space-y-0.5 border border-gray-200 max-w-[300px]">
                                <div className="text-[10px] font-medium text-gray-400 uppercase mb-1">Datos reconocidos (OCR)</div>
                                {meta.ocr_name && <div><span className="text-gray-400">Remitente:</span> <span className="text-gray-700 font-medium">{meta.ocr_name}</span></div>}
                                {meta.ocr_amount && <div><span className="text-gray-400">Monto:</span> <span className="text-gray-700 font-medium">Bs {meta.ocr_amount}</span></div>}
                                {meta.ocr_date && <div><span className="text-gray-400">Fecha:</span> <span className="text-gray-700">{meta.ocr_date}</span></div>}
                                {meta.ocr_dest_name && <div><span className="text-gray-400">Destinatario:</span> <span className={`font-medium ${meta.ocr_dest_verified ? 'text-green-700' : 'text-red-600'}`}>{meta.ocr_dest_name} {meta.ocr_dest_verified ? '' : '(NO verificado)'}</span></div>}
                                {!meta.ocr_dest_name && meta.ocr_dest_verified !== undefined && <div><span className="text-gray-400">Destinatario:</span> <span className={meta.ocr_dest_verified ? 'text-green-700' : 'text-red-600'}>{meta.ocr_dest_verified ? 'Verificado' : 'No encontrado'}</span></div>}
                                {meta.ocr_bank && <div><span className="text-gray-400">Banco:</span> <span className="text-gray-700">{meta.ocr_bank}</span></div>}
                                {meta.ocr_reference && <div><span className="text-gray-400">Ref:</span> <span className="text-gray-700 font-mono">{meta.ocr_reference}</span></div>}
                              </div>
                            );
                          })()}
                        </>
                      )}
                      <span className="text-[11px] text-gray-400 mt-1 block">{formatDate(msg.created_at)}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )
        ) : (
          logs.length === 0 ? (
            <div className="text-center py-12 text-gray-400 text-sm">No hay registros</div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 text-left text-xs text-gray-500 uppercase">
                  <th className="px-4 py-2.5">Tipo</th>
                  <th className="px-4 py-2.5">Teléfono</th>
                  <th className="px-4 py-2.5">Estado</th>
                  <th className="px-4 py-2.5">Evento</th>
                  <th className="px-4 py-2.5">Fecha</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {logs.map(log => (
                  <tr key={log.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-2.5">
                      <span className="text-xs px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-700 font-medium">
                        {LOG_TYPE_LABELS[log.type] || log.type}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 font-mono text-xs text-gray-600">{log.client_phone || '-'}</td>
                    <td className="px-4 py-2.5">
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${LOG_STATUS_COLORS[log.status] || 'bg-gray-100 text-gray-600'}`}>
                        {log.status}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-xs text-gray-500 max-w-[200px] truncate" title={log.event}>{log.event}</td>
                    <td className="px-4 py-2.5 text-xs text-gray-400">{formatDate(log.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-4">
          <span className="text-xs text-gray-500">{total} registros</span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page === 1}
              className="p-1.5 rounded-lg hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronLeft size={16} />
            </button>
            <span className="text-sm text-gray-600 px-2">{page} / {totalPages}</span>
            <button
              type="button"
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="p-1.5 rounded-lg hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      )}
    </AdminLayout>
  );
}
