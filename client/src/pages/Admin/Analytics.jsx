import { useState, useEffect } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from 'recharts';
import AdminLayout from '../../components/AdminLayout';
import { api } from '../../utils/api';

const COLORS = ['#1a1a1a', '#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899', '#14B8A6'];

const STATUS_COLORS = {
  Agendada: '#3B82F6',
  Confirmada: '#10B981',
  Completada: '#059669',
  Cancelada: '#EF4444',
  Reagendada: '#F59E0B',
  'No-show': '#9CA3AF',
};

export default function Analytics() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/analytics')
      .then(setData)
      .catch(err => console.error(err))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <AdminLayout title="Analytics"><div className="text-gray-400">Cargando datos...</div></AdminLayout>;
  }

  if (!data) {
    return <AdminLayout title="Analytics"><div className="text-gray-400">Error cargando analytics</div></AdminLayout>;
  }

  const t = data.totals;
  const csd = data.client_status_distribution || {};
  const recurring = data.recurring || {};
  const recurringMonthly = Number(recurring.projected_monthly_recurring || 0);
  const recurringChurnRate = Number(recurring.churn_rate || 0);

  return (
    <AdminLayout title="Analytics">
      <div className="space-y-6">
        {/* KPI Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <KPICard label="Total clientes" value={t.total_clients} />
          <KPICard label="Nuevos (30d)" value={t.new_clients_30d} accent />
          <KPICard label="Citas totales" value={t.total_appointments} />
          <KPICard label="Completadas" value={t.total_completed} color="text-green-600" />
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <KPICard label="Canceladas" value={t.total_cancelled} color="text-red-500" />
          <KPICard label="No-show" value={t.total_noshow} color="text-gray-500" />
          <KPICard label="Reagendadas" value={t.total_rescheduled} color="text-yellow-600" />
          <KPICard
            label="Tasa completadas"
            value={t.total_appointments > 0 ? Math.round(t.total_completed / t.total_appointments * 100) + '%' : '-'}
            color="text-green-600"
          />
        </div>

        <Card title="Recurrencia y retención" subtitle="Base recurrente activa, pausas y churn reciente">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <KPICard label="Recurrentes activos" value={recurring.active || 0} color="text-blue-600" />
            <KPICard label="Pausados" value={recurring.paused || 0} color="text-yellow-600" />
            <KPICard
              label="Churn (90d)"
              value={`${recurring.churned_90d || 0} · ${Math.round(recurringChurnRate * 100)}%`}
              color={recurringChurnRate > 0.15 ? 'text-red-600' : 'text-gray-900'}
            />
            <KPICard label="MRR proyectado" value={`Bs ${recurringMonthly.toLocaleString('es-BO', { maximumFractionDigits: 0 })}`} color="text-sky-600" />
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            <MiniStat label="Total historico" value={recurring.total || 0} color="#1D4ED8" />
            <MiniStat label="Finalizados" value={recurring.ended || 0} color="#6B7280" />
            <MiniStat label="Base churn" value={(recurring.active || 0) + (recurring.churned_90d || 0)} color="#0F766E" />
          </div>
        </Card>

        {/* Sessions by Week */}
        {data.sessions_by_week.length > 0 && (
          <Card title="Sesiones por semana" subtitle="Últimas 12 semanas">
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={data.sessions_by_week} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="week_label" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} />
                <Tooltip />
                <Bar dataKey="completed" name="Completadas" fill="#10B981" radius={[4, 4, 0, 0]} />
                <Bar dataKey="cancelled" name="Canceladas" fill="#EF4444" radius={[4, 4, 0, 0]} />
                <Bar dataKey="noshow" name="No-show" fill="#D1D5DB" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </Card>
        )}

        <div className="grid md:grid-cols-2 gap-6">
          {/* Sessions by Status */}
          {data.sessions_by_status.length > 0 && (
            <Card title="Citas por status">
              <ResponsiveContainer width="100%" height={250}>
                <PieChart>
                  <Pie
                    data={data.sessions_by_status}
                    dataKey="count"
                    nameKey="status"
                    cx="50%" cy="50%"
                    outerRadius={90}
                    label={({ status, count }) => `${status} (${count})`}
                    labelLine={false}
                  >
                    {data.sessions_by_status.map((entry, i) => (
                      <Cell key={i} fill={STATUS_COLORS[entry.status] || COLORS[i % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </Card>
          )}

          {/* Clients by City */}
          {data.clients_by_city.length > 0 && (
            <Card title="Clientes por ciudad">
              <ResponsiveContainer width="100%" height={250}>
                <PieChart>
                  <Pie
                    data={data.clients_by_city}
                    dataKey="count"
                    nameKey="city"
                    cx="50%" cy="50%"
                    outerRadius={90}
                    label={({ city, count }) => `${city} (${count})`}
                    labelLine={false}
                  >
                    {data.clients_by_city.map((entry, i) => (
                      <Cell key={i} fill={COLORS[i % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </Card>
          )}
        </div>

        <div className="grid md:grid-cols-2 gap-6">
          {/* Popular Hours */}
          {data.popular_hours.length > 0 && (
            <Card title="Horarios más demandados">
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={data.popular_hours} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="hour" tick={{ fontSize: 12 }} tickFormatter={h => `${h}:00`} />
                  <YAxis tick={{ fontSize: 12 }} />
                  <Tooltip labelFormatter={h => `${h}:00`} />
                  <Bar dataKey="count" name="Citas" fill="#1a1a1a" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </Card>
          )}

          {/* Clients by Source */}
          {data.clients_by_source.length > 0 && (
            <Card title="Fuente de clientes">
              <ResponsiveContainer width="100%" height={250}>
                <PieChart>
                  <Pie
                    data={data.clients_by_source}
                    dataKey="count"
                    nameKey="source"
                    cx="50%" cy="50%"
                    outerRadius={90}
                    label={({ source, count }) => `${source} (${count})`}
                    labelLine={false}
                  >
                    {data.clients_by_source.map((entry, i) => (
                      <Cell key={i} fill={COLORS[i % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </Card>
          )}
        </div>

        {/* Client Status Distribution */}
        <Card title="Estado actual de clientes">
          <div className="grid grid-cols-5 gap-4">
            <MiniStat label="Nuevos" value={csd.nuevos || 0} color="#3B82F6" />
            <MiniStat label="Activos" value={csd.activos || 0} color="#10B981" />
            <MiniStat label="Recurrentes" value={csd.recurrentes || 0} color="#059669" />
            <MiniStat label="En pausa" value={csd.en_pausa || 0} color="#F59E0B" />
            <MiniStat label="Inactivos" value={csd.inactivos || 0} color="#9CA3AF" />
          </div>
        </Card>

        {/* Recent Activity */}
        {data.recent_activity.length > 0 && (
          <Card title="Actividad reciente">
            <div className="space-y-2">
              {data.recent_activity.map((a, i) => (
                <div key={i} className="flex items-center justify-between text-sm py-1.5 border-b border-gray-50 last:border-0">
                  <div>
                    <span className="font-medium">{a.first_name} {a.last_name}</span>
                    <span className="text-gray-400 ml-2 text-xs">
                      {new Date(a.date_time).toLocaleDateString('es-BO', { day: 'numeric', month: 'short' })}
                      {' '}
                      {new Date(a.date_time).toLocaleTimeString('es-BO', { hour: '2-digit', minute: '2-digit', timeZone: 'America/La_Paz' })}
                    </span>
                  </div>
                  <span
                    className="text-xs px-2 py-0.5 rounded-full font-medium"
                    style={{ backgroundColor: (STATUS_COLORS[a.status] || '#9CA3AF') + '20', color: STATUS_COLORS[a.status] || '#9CA3AF' }}
                  >
                    {a.status}
                  </span>
                </div>
              ))}
            </div>
          </Card>
        )}
      </div>
    </AdminLayout>
  );
}

function Card({ title, subtitle, children }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
      <h3 className="font-semibold text-sm mb-0.5">{title}</h3>
      {subtitle && <p className="text-xs text-gray-400 mb-3">{subtitle}</p>}
      {!subtitle && <div className="mb-3" />}
      {children}
    </div>
  );
}

function KPICard({ label, value, color, accent }) {
  return (
    <div className={`rounded-xl border p-4 ${accent ? 'bg-gray-900 border-gray-900' : 'bg-white border-gray-100 shadow-sm'}`}>
      <div className={`text-xs mb-1 ${accent ? 'text-gray-400' : 'text-gray-500'}`}>{label}</div>
      <div className={`text-2xl font-bold ${accent ? 'text-white' : color || 'text-gray-900'}`}>{value}</div>
    </div>
  );
}

function MiniStat({ label, value, color }) {
  return (
    <div className="text-center">
      <div className="text-2xl font-bold" style={{ color }}>{value}</div>
      <div className="text-xs text-gray-500 mt-1">{label}</div>
    </div>
  );
}
