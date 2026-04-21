import { useState, useEffect, useCallback } from 'react';
import { Target, TrendingUp, ChevronLeft, ChevronRight, Eye } from 'lucide-react';
import AdminLayout from '../../components/AdminLayout';
import { api } from '../../utils/api';
import { buildGoalSessionMix } from '../../utils/goalMix';
import { useToast, Toast } from '../../hooks/useToast';
import useAdminEvents from '../../hooks/useAdminEvents';

const MONTHS = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

function formatCurrencyBob(n) {
  return `Bs ${Number(n || 0).toLocaleString('es-BO', { minimumFractionDigits: 0 })}`;
}

function formatCurrencyUsd(n) {
  return `USD ${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatAmountByCurrency(amount, currency) {
  const normalizedCurrency = String(currency || 'BOB').toUpperCase();
  if (normalizedCurrency === 'USD') return formatCurrencyUsd(amount);
  return formatCurrencyBob(amount);
}

function SessionMixCard({ item }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
      <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">Sesiones de</div>
      <div className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">{formatCurrencyBob(item.fee)}</div>
      <div className="mt-3 text-3xl font-bold text-slate-950">{item.sessions}</div>
      <div className="mt-1 text-sm text-slate-500">para cubrir {formatCurrencyBob(item.targetAmount)} del faltante</div>
    </div>
  );
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

  const refreshData = useCallback(() => loadData(), [year, month]);
  useEffect(() => { loadData(); }, [year, month]);

  // Real-time updates via SSE
  useAdminEvents(['payment:change'], refreshData);

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
  const confirmedBob = parseFloat(current.income_confirmed_bob ?? current.income_confirmed ?? 0);
  const confirmedUsd = parseFloat(current.income_confirmed_usd || 0);
  const pendingBob = parseFloat(current.income_pending_bob ?? current.income_pending ?? 0);
  const pendingUsd = parseFloat(current.income_pending_usd || 0);
  const totalSessions = parseInt(current.total_sessions || 0);
  const paidSessions = parseInt(current.paid_sessions || 0);
  const pendingSessions = parseInt(current.pending_sessions || 0);

  // Goal calculations
  const goalProgress = goalAmount ? Math.min((confirmedBob / goalAmount) * 100, 100) : 0;
  const goalRemaining = goalAmount ? Math.max(goalAmount - confirmedBob, 0) : 0;
  // Estimate average fee from confirmed payments
  const avgFee = paidSessions > 0 ? confirmedBob / paidSessions : 250;
  const sessionsNeeded = goalRemaining > 0 ? Math.ceil(goalRemaining / avgFee) : 0;
  const sessionMix = buildGoalSessionMix(goalRemaining, data?.pricing);

  // Days remaining in month
  const daysInMonth = new Date(year, month, 0).getDate();
  const today = new Date();
  const isCurrentMonth = year === today.getFullYear() && month === today.getMonth() + 1;
  const daysRemaining = isCurrentMonth ? daysInMonth - today.getDate() : daysInMonth;
  const confirmedTotals = (data?.payments || [])
    .filter((payment) => payment.status === 'Confirmado')
    .reduce((acc, payment) => {
      const currency = String(payment.effective_currency || 'BOB').toUpperCase();
      const amount = Number(payment.effective_amount ?? payment.client_fee ?? payment.amount ?? 0);
      if (currency === 'USD') acc.usd += amount;
      else acc.bob += amount;
      return acc;
    }, { bob: 0, usd: 0 });

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
                  <span className="text-gray-600">{formatCurrencyBob(confirmedBob)} de {formatCurrencyBob(goalAmount)}</span>
                  <span className="font-semibold" style={{ color: goalProgress >= 100 ? '#22c55e' : '#374151' }}>
                    {Math.round(goalProgress)}%
                  </span>
                </div>
                {goalProgress < 100 && (
                  <div className="text-xs text-gray-500">
                    Faltan {formatCurrencyBob(goalRemaining)} — aproximadamente <span className="font-semibold">{sessionsNeeded} sesiones</span> para llegar
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

          {goalAmount && goalRemaining > 0 && sessionMix.length > 0 && (
            <div className="bg-white rounded-xl border border-gray-200 p-5 mb-4">
              <div className="flex items-center justify-between gap-3 mb-4">
                <div>
                  <div className="font-semibold text-gray-800">Mezcla sugerida para llegar</div>
                  <div className="text-sm text-gray-500">Reparte el faltante usando 70% tarifa base, 25% capital y 5% especial.</div>
                </div>
                <div className="text-sm text-gray-500">{formatCurrencyBob(goalRemaining)} por cerrar</div>
              </div>
              <div className="grid gap-3 md:grid-cols-3">
                {sessionMix.map((item) => (
                  <SessionMixCard key={item.key} item={item} />
                ))}
              </div>
            </div>
          )}

          {/* Summary cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <div className="text-xs text-gray-500">Confirmado BOB</div>
              <div className="text-xl font-bold text-green-700 mt-1">{formatCurrencyBob(confirmedBob)}</div>
            </div>
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <div className="text-xs text-gray-500">Confirmado USD</div>
              <div className="text-xl font-bold text-green-700 mt-1">{formatCurrencyUsd(confirmedUsd)}</div>
            </div>
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <div className="text-xs text-gray-500">Pendiente BOB</div>
              <div className="text-xl font-bold text-amber-600 mt-1">{formatCurrencyBob(pendingBob)}</div>
            </div>
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <div className="text-xs text-gray-500">Pendiente USD</div>
              <div className="text-xl font-bold text-amber-600 mt-1">{formatCurrencyUsd(pendingUsd)}</div>
            </div>
          </div>

          <div className="mb-4 grid grid-cols-2 gap-3 text-sm text-gray-500">
            <div className="rounded-lg border border-gray-200 bg-white px-3 py-2">
              Sesiones pagadas: <span className="font-semibold text-gray-800">{paidSessions} / {totalSessions}</span>
            </div>
            <div className="rounded-lg border border-gray-200 bg-white px-3 py-2">
              Promedio sesión (BOB): <span className="font-semibold text-gray-800">{paidSessions > 0 ? formatCurrencyBob(avgFee) : '--'}</span>
              <span className="ml-2 text-xs text-gray-400">Pendientes: {pendingSessions}</span>
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
                    <div className="text-sm font-bold mt-0.5">{formatCurrencyBob(h.income)}</div>
                    {Number(h.income_usd || 0) > 0 ? (
                      <div className="text-[10px] text-gray-500">{formatCurrencyUsd(h.income_usd)}</div>
                    ) : null}
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
                      <td className="p-3 font-medium">
                        {formatAmountByCurrency(
                          p.effective_amount ?? p.client_fee ?? p.amount,
                          p.effective_currency || p.client_fee_currency || p.currency || 'BOB'
                        )}
                      </td>
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
                      <div>{formatCurrencyBob(confirmedTotals.bob)}</div>
                      <div className="text-xs font-medium text-emerald-700">{formatCurrencyUsd(confirmedTotals.usd)}</div>
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
