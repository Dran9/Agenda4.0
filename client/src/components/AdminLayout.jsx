import { useState, useEffect } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { LayoutDashboard, Users, CalendarDays, BarChart3, Settings, MessageSquare, DollarSign, LogOut, Menu, X } from 'lucide-react';

const NAV_ITEMS = [
  { path: '/admin', label: 'Dashboard', icon: LayoutDashboard },
  { path: '/admin/clients', label: 'Clientes', icon: Users },
  { path: '/admin/appointments', label: 'Citas', icon: CalendarDays },
  { path: '/admin/analytics', label: 'Analytics', icon: BarChart3 },
  { path: '/admin/config', label: 'Configuración', icon: Settings },
  { path: '/admin/whatsapp', label: 'WhatsApp', icon: MessageSquare },
  { path: '/admin/finance', label: 'Finanzas', icon: DollarSign },
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
    <div className="min-h-screen bg-sky-100 flex">
      {/* Sidebar */}
      <aside className={`
        fixed inset-y-0 left-0 z-30 w-60 bg-sky-50 border-r border-sky-200 transform transition-transform
        lg:translate-x-0 lg:static lg:inset-0
        ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
      `}>
        <div className="p-4 border-b border-sky-200">
          <h1 className="font-bold text-lg text-sky-950">Agenda 4.0</h1>
        </div>

        <nav className="p-2 space-y-0.5">
          {NAV_ITEMS.map(item => {
            const Icon = item.icon;
            const active = location.pathname === item.path;
            return (
              <Link
                key={item.path}
                to={item.path}
                onClick={() => setSidebarOpen(false)}
                className={`
                  flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors
                  ${active ? 'bg-sky-200 text-sky-950' : 'text-slate-700 hover:bg-sky-100 hover:text-sky-950'}
                `}
              >
                <Icon size={18} />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="absolute bottom-0 left-0 right-0 p-2 border-t border-sky-200">
          <button
            type="button"
            onClick={handleLogout}
            className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-slate-600 hover:bg-sky-100 hover:text-sky-900 w-full"
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
        <header className="bg-sky-50/95 border-b border-sky-200 px-4 py-3 flex items-center gap-3 lg:px-6">
          <button
            type="button"
            onClick={() => setSidebarOpen(true)}
            className="lg:hidden p-1"
          >
            <Menu size={20} />
          </button>
          <h2 className="text-lg font-semibold">{title}</h2>
        </header>

        <main className="p-4 lg:p-6">
          {children}
        </main>
      </div>
    </div>
  );
}
