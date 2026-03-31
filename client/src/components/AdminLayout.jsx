import { useState, useEffect } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { LayoutDashboard, Users, CalendarDays, BarChart3, Settings, MessageSquare, DollarSign, LogOut, Menu, X } from 'lucide-react';

const NAV_ITEMS = [
  { path: '/admin', label: 'Hoy', icon: LayoutDashboard },
  { path: '/admin/appointments', label: 'Agenda', icon: CalendarDays },
  { path: '/admin/clients', label: 'Clientes', icon: Users },
  { path: '/admin/whatsapp', label: 'Inbox', icon: MessageSquare },
  { path: '/admin/finance', label: 'Cobros', icon: DollarSign },
  { path: '/admin/analytics', label: 'Insights', icon: BarChart3 },
  { path: '/admin/config', label: 'Ajustes', icon: Settings },
];

export default function AdminLayout({ children, title }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Check auth
  useEffect(() => {
    const token = localStorage.getItem('auth_token');
    if (!token) navigate('/admin/login');
  }, [navigate]);

  function handleLogout() {
    localStorage.removeItem('auth_token');
    navigate('/admin/login');
  }

  return (
    <div className="min-h-screen bg-[#f4efe7] flex text-slate-900">
      {/* Sidebar */}
      <aside className={`
        fixed inset-y-0 left-0 z-30 w-64 bg-[#f8f3ec]/95 border-r border-black/5 backdrop-blur-xl transform transition-transform
        lg:translate-x-0 lg:static lg:inset-0
        ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
      `}>
        <div className="p-5 border-b border-black/5">
          <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[#b3643d]">Agenda 4.0</div>
          <h1 className="mt-2 font-semibold text-xl text-slate-950 tracking-tight">Admin Desk</h1>
        </div>

        <nav className="p-3 space-y-1.5">
          {NAV_ITEMS.map(item => {
            const Icon = item.icon;
            const active = location.pathname === item.path;
            return (
              <Link
                key={item.path}
                to={item.path}
                onClick={() => setSidebarOpen(false)}
                className={`
                  flex items-center gap-3 px-4 py-3 rounded-2xl text-sm font-medium transition-colors
                  ${active ? 'bg-[#1f2937] text-white shadow-[0_16px_36px_rgba(15,23,42,0.18)]' : 'text-slate-600 hover:bg-white/75 hover:text-slate-900'}
                `}
              >
                <Icon size={18} />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="absolute bottom-0 left-0 right-0 p-3 border-t border-black/5">
          <button
            type="button"
            onClick={handleLogout}
            className="flex items-center gap-3 px-4 py-3 rounded-2xl text-sm font-medium text-slate-600 hover:bg-white/75 hover:text-slate-900 w-full"
          >
            <LogOut size={18} />
            Cerrar sesión
          </button>
        </div>
      </aside>

      {/* Overlay for mobile */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-20 bg-black/30 lg:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      {/* Main content */}
      <div className="flex-1 min-w-0">
        <header className="bg-[#f8f3ec]/75 backdrop-blur-xl border-b border-black/5 px-4 py-4 flex items-center gap-3 lg:px-6">
          <button
            type="button"
            onClick={() => setSidebarOpen(true)}
            className="lg:hidden p-1"
          >
            <Menu size={20} />
          </button>
          <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
        </header>

        <main className="p-4 lg:p-6">
          {children}
        </main>
      </div>
    </div>
  );
}
