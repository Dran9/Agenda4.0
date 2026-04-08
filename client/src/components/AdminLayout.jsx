import { useState, useEffect } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { LayoutDashboard, Users, CalendarDays, BarChart3, Settings, MessageSquare, DollarSign, LogOut, Menu, X, Command } from 'lucide-react';

const NAV_ITEMS = [
  { path: '/admin/quick-actions', label: 'Comandos', icon: Command },
  { path: '/admin/dashboard', label: 'Hoy', icon: LayoutDashboard },
  { path: '/admin/appointments', label: 'Agenda', icon: CalendarDays },
  { path: '/admin/clients', label: 'Clientes', icon: Users },
  { path: '/admin/whatsapp', label: 'Inbox', icon: MessageSquare },
  { path: '/admin/finance', label: 'Cobros', icon: DollarSign },
  { path: '/admin/analytics', label: 'Insights', icon: BarChart3 },
  { path: '/admin/config', label: 'Ajustes', icon: Settings },
];

export default function AdminLayout({ children, title, sidebarSubItems = [] }) {
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
    <div className="admin-contrast min-h-screen bg-white flex text-slate-900">
      {/* Sidebar */}
      <aside
        className={`
        fixed inset-y-0 left-0 z-30 w-64 bg-white/95 border-r border-slate-200 backdrop-blur-xl transform transition-transform
        lg:translate-x-0 lg:static lg:inset-0
        ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
      `}
        style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}
      >
        <div className="p-5 border-b border-slate-200">
          <div className="inline-flex rounded-full bg-[#CFE8E9] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.24em] text-[#4E769B]">Agenda Daniel MacLean</div>
          <h1 className="mt-2 font-semibold text-xl text-slate-950 tracking-tight">Admin Desk</h1>
        </div>

        <nav className="p-3 space-y-1.5">
          {NAV_ITEMS.map(item => {
            const Icon = item.icon;
            const active = location.pathname === item.path;
            const isSettings = item.path === '/admin/config';
            return (
              <div key={item.path}>
                <Link
                  to={item.path}
                  onClick={() => setSidebarOpen(false)}
                  className={`
                    flex items-center gap-3 px-4 py-3 rounded-2xl text-sm font-medium transition-colors
                    ${active ? 'bg-[#4E769B] text-white shadow-[0_14px_32px_rgba(78,118,155,0.32)]' : 'text-slate-600 hover:bg-[#CFE8E9] hover:text-slate-900'}
                  `}
                >
                  <Icon size={18} />
                  {item.label}
                </Link>

                {isSettings && sidebarSubItems.length > 0 && (
                  <div className="mt-2 ml-6 space-y-1 border-l border-slate-200 pl-3">
                    {sidebarSubItems.map(subItem => {
                      const subActive = active && subItem.active;
                      return (
                        <Link
                          key={subItem.to}
                          to={subItem.to}
                          onClick={() => setSidebarOpen(false)}
                          className={`block rounded-xl px-3 py-2 transition-colors ${
                            subActive
                              ? 'bg-[#CFE8E9] text-slate-900'
                              : 'text-slate-500 hover:bg-slate-50 hover:text-slate-900'
                          }`}
                        >
                          <div className="text-[15px] font-semibold tracking-tight">{subItem.label}</div>
                        </Link>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </nav>

        <div className="absolute bottom-0 left-0 right-0 p-3 border-t border-slate-200">
          <button
            type="button"
            onClick={handleLogout}
            className="flex items-center gap-3 px-4 py-3 rounded-2xl text-sm font-medium text-slate-600 hover:bg-[#CFE8E9] hover:text-slate-900 w-full"
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
        <header className="sticky top-0 z-10 bg-white/95 backdrop-blur-xl border-b border-slate-200">
          <div
            className="lg:hidden"
            style={{ height: 'max(env(safe-area-inset-top, 0px), 2.25rem)' }}
          />
          <div className="flex items-center gap-3 px-4 py-4 lg:px-6">
            <button
              type="button"
              onClick={() => setSidebarOpen(true)}
              className="lg:hidden inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-900 shadow-sm"
              aria-label="Abrir menú"
            >
              <Menu size={20} />
            </button>
            <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
          </div>
        </header>

        <main className="p-4 lg:p-6 bg-white">
          {children}
        </main>
      </div>
    </div>
  );
}
