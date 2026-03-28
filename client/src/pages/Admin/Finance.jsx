import { useState, useEffect } from 'react';
import { Target, TrendingUp, ChevronLeft, ChevronRight, Eye } from 'lucide-react';
import AdminLayout from '../../components/AdminLayout';
import { api } from '../../utils/api';
import { useToast, Toast } from '../../hooks/useToast';

const MONTHS = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

function formatCurrency(n) {
  return `Bs ${Number(n || 0).toLocaleString('es-BO', { minimumFractionDigits: 0 })}`;
}

function OcrPopover({ payment }) {
  const [open, setOpen] = useState(false);
  if (!payment.ocr_extracted_amount && !payment.ocr_extracted_ref) return null;
  return (
    <div className="relative inline-block">
      <button type="button" onClick={() => setOpen(!open)} className="text-gray-400 hover:text-gray-600">
        <Eye size={13} />
      </button>
      {open && (
        <div className="absolute z-20 bottom-6 left-0 bg-white border border-gray-200 rounded-lg shadow-lg p-3 text-xs min-w-[180px]">
          <div className="font-semibold text-gray-700 mb-1.5">Datos OCR</div>
          {payment.ocr_extracted_amount && <div className="mb-1"><span className="text-gray-500">Monto: </span><span className="font-medium">Bs {payment.ocr_extracted_amount}</span></div>}
          {payment.ocr_extracted_ref && <div className="mb-1"><span className="text-gray-500">Ref: </span><span className="font-mono">{payment.ocr_extracted_ref}</span></div>}
          <button type="button" onClick={() => setOpen(false)} className="mt-1 text-gray-400 hover:text-gray-600 text-[10px]">Cerrar</button>
        </div>
      )}
    </div>
  );
}

export default function Finance() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [goal, setGoal] = useState('');
  const [editingGoal, setEditingGoal] = useState(false);
  const { toast, show: showToast } = useToast();

  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);

  useEffect(() => {
    loadData();
  }, [year, month]);

  async function loadData() {
    setLoading(true);
    try {
      const d = await api.get(`/payments/summary?year=${year}&month=${month}`);
      setData(d);
      if (d.monthly_goal) setGoal(d.monthly_goal);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  async function saveGoal() {
    try {
      await api.put('/payments/goal', { goal: parseFloat(goal) || null });
      showToast('Meta guardada');
      setEditingGoal(false);
      loadData();
    } catch (err) {
      showToast('Error: ' + err.message, 'error');
    }
  }

  function prevMonth() {
    if (month === 1) { setMonth(12); setYear(y => y - 1); }
    else setMonth(m => m - 1);
  }
  function nextMonth() {
    if (month === 12) { setMonth(1); setYear(y => y + 1); }
    else setMonth(m => m + 1);
  }

  const current = data?.current || {};
  const goalAmount = data?.monthly_goal ? parseFloat(data.monthly_goal) : null;
  const confirmed = parseFloat(current.income_confirmed || 0);
  const pending = parseFloat(current.income_pending || 0);
  const totalSessions = parseInt(current.total_sessions || 0);
  const paidSessions = parseInt(current.paid_sessions || 0);
  const pendingSessions = parseInt(current.pending_sessions || 0);

  // Goal calculations
  const goalProgress = goalAmount ? Math.min((confirmed / goalAmount) * 100, 100) : 0;
  const goalRemaining = goalAmount ? Math.max(goalAmount - confirmed, 0) : 0;
  // Estimate average fee from confirmed payments
  const avgFee = paidSessions > 0 ? confirmed / paidSessions : 250;
  const sessionsNeeded = goalRemaining > 0 ? Math.ceil(goalRemaining / avgFee) : 0;

  // Days remaining in month
  const daysInMonth = new Date(year, month, 0).getDate();
  const today = new Date();
  const isCurrentMonth = year === today.getFullYear() && month === today.getMonth() + 1;
  const daysRemaining = isCurrentMonth ? daysInMonth - today.getDate() : daysInMonth;

  return (
    <AdminLayout title="Finanzas">
      <Toast toast={toast} />

      {/* Month selector */}
      <div className="flex items-center justify-between mb-5">
        <button type="button" onClick={prevMonth} className="p-2 hover:bg-gray-100 rounded-lg"><ChevronLeft size={18} /></button>
        <h2 className="text-lg font-semibold">{MONTHS[month - 1]} {year}</h2>
        <button type="button" onClick={nextMonth} className="p-2 hover:bg-gray-100 rounded-lg"><ChevronRight size={18} /></button>
      </div>

      {loading ? (
        <div className="text-center py-12 text-gray-400">Cargando...</div>
      ) : (
        <>
          {/* Goal card */}
          <div className="bg-white rounded-xl border border-gray-200 p-5 mb-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Target size={18} className="text-gray-500" />
                <span className="font-semibold text-gray-800">Meta del mes</span>
              </div>
              {!editingGoal ? (
                <button type="button" onClick={() => setEditingGoal(true)} className="text-xs text-blue-600 hover:underline">
                  {goalAmount ? 'Editar' : 'Definir meta'}
                </button>
              ) : (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-500">Bs</span>
                  <input
                    type="number"
                    value={goal}
                    onChange={e => setGoal(e.target.value)}
                    className="w-24 px-2 py-1 border border-gray-200 rounded text-sm"
                    placeholder="5000"
                  />
                  <button type="button" onClick={saveGoal} className="text-xs bg-gray-900 text-white px-3 py-1 rounded-lg">Guardar</button>
                  <button type="button" onClick={() => setEditingGoal(false)} className="text-xs text-gray-400">Cancelar</button>
                </div>
              )}
            </div>

            {goalAmount ? (
              <>
                {/* Progress bar */}
                <div className="w-full bg-gray-100 rounded-full h-4 mb-3 overflow-hidden">
                  <div
                    className="h-4 rounded-full transition-all duration-500"
                    style={{
                      width: `${goalProgress}%`,
                      backgroundColor: goalProgress >= 100 ? '#22c55e' : goalProgress >= 60 ? '#3b82f6' : '#f59e0b',
                    }}
                  />
                </div>
                <div className="flex justify-between text-sm mb-2">
                  <span className="text-gray-600">{formatCurrency(confirmed)} de {formatCurrency(goalAmount)}</span>
                  <span className="font-semibold" style={{ color: goalProgress >= 100 ? '#22c55e' : '#374151' }}>
                    {Math.round(goalProgress)}%
                  </span>
                </div>
                {goalProgress < 100 && (
                  <div className="text-xs text-gray-500">
                    Faltan {formatCurrency(goalRemaining)} — aproximadamente <span className="font-semibold">{sessionsNeeded} sesiones</span> para llegar
                    {isCurrentMonth && <span> ({daysRemaining} días restantes)</span>}
                  </div>
                )}
                {goalProgress >= 100 && (
                  <div className="text-xs text-green-600 font-medium">Meta alcanzada</div>
                )}
              </>
            ) : (
              <div className="text-sm text-gray-400">Define una meta mensual para ver tu progreso</div>
            )}
          </div>

          {/* Summary cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <div className="text-xs text-gray-500">Ingreso confirmado</div>
              <div className="text-xl font-bold text-green-700 mt-1">{formatCurrency(confirmed)}</div>
            </div>
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <div className="text-xs text-gray-500">Pendiente de cobro</div>
              <div className="text-xl font-bold text-amber-600 mt-1">{formatCurrency(pending)}</div>
            </div>
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <div className="text-xs text-gray-500">Sesiones pagadas</div>
              <div className="text-xl font-bold mt-1">{paidSessions} / {totalSessions}</div>
            </div>
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <div className="text-xs text-gray-500">Promedio por sesión</div>
              <div className="text-xl font-bold mt-1">{paidSessions > 0 ? formatCurrency(avgFee) : '--'}</div>
            </div>
          </div>

          {/* Monthly history */}
          {data?.history?.length > 1 && (
            <div className="bg-white rounded-xl border border-gray-200 p-5 mb-4">
              <div className="flex items-center gap-2 mb-3">
                <TrendingUp size={16} className="text-gray-500" />
                <span className="text-sm font-semibold text-gray-700">Historial mensual</span>
              </div>
              <div className="flex gap-2 overflow-x-auto pb-1">
                {data.history.map(h => (
                  <div key={`${h.year}-${h.month}`} className="flex-shrink-0 text-center px-3 py-2 rounded-lg bg-gray-50 min-w-[80px]">
                    <div className="text-[10px] text-gray-400">{MONTHS[h.month - 1].substring(0, 3)}</div>
                    <div className="text-sm font-bold mt-0.5">{formatCurrency(h.income)}</div>
                    <div className="text-[10px] text-gray-400">{h.sessions} sesiones</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Payments detail table */}
          <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
            <div className="p-4 border-b border-gray-100">
              <h3 className="font-semibold text-sm">Detalle de pagos — {MONTHS[month - 1]}</h3>
            </div>
            {data?.payments?.length === 0 ? (
              <div className="p-8 text-center text-gray-400 text-sm">Sin pagos registrados este mes</div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-gray-500 border-b border-gray-100 bg-gray-50">
                    <th className="text-left p-3 font-medium">Fecha</th>
                    <th className="text-left p-3 font-medium">Cliente</th>
                    <th className="text-left p-3 font-medium">Monto</th>
                    <th className="text-left p-3 font-medium">Status</th>
                    <th className="text-left p-3 font-medium">OCR</th>
                  </tr>
                </thead>
                <tbody>
                  {data?.payments?.map(p => (
                    <tr key={p.id} className="border-b border-gray-50 hover:bg-gray-50">
                      <td className="p-3 text-xs text-gray-600">
                        {p.date_time ? new Date(p.date_time).toLocaleDateString('es-BO', { day: '2-digit', month: 'short', timeZone: 'America/La_Paz' }) : '-'}
                      </td>
                      <td className="p-3">{p.first_name} {p.last_name || ''}</td>
                      <td className="p-3 font-medium">{formatCurrency(p.amount)}</td>
                      <td className="p-3">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                          p.status === 'Confirmado' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                        }`}>
                          {p.status === 'Confirmado' ? 'Pagado' : 'Pendiente'}
                        </span>
                      </td>
                      <td className="p-3">
                        <OcrPopover payment={p} />
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t border-gray-200 bg-gray-50 font-semibold text-sm">
                    <td className="p-3" colSpan={2}>Total</td>
                    <td className="p-3 text-green-700">
                      {formatCurrency(data?.payments?.filter(p => p.status === 'Confirmado').reduce((s, p) => s + parseFloat(p.amount), 0))}
                    </td>
                    <td className="p-3" colSpan={2}>
                      <span className="font-normal text-xs text-gray-500">{data?.payments?.length} pago(s)</span>
                    </td>
                  </tr>
                </tfoot>
              </table>
            )}
          </div>
        </>
      )}
    </AdminLayout>
  );
}
