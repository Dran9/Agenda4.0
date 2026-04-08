import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import ThemeModeButton from '../../components/ThemeModeButton';
import { useUiTheme } from '../../hooks/useUiTheme';
import { api } from '../../utils/api';

export default function Login() {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const { themePreference, isDark, cycleTheme } = useUiTheme();

  useEffect(() => {
    const token = localStorage.getItem('auth_token');
    if (token) {
      navigate('/admin/quick-actions', { replace: true });
    }
  }, [navigate]);

  async function handleSubmit(e) {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const data = await api.post('/auth/login', { password });
      localStorage.setItem('auth_token', data.token);
      navigate('/admin/quick-actions', { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  const themeClasses = isDark
    ? {
        root: 'min-h-screen flex items-center justify-center bg-[radial-gradient(circle_at_top,_rgba(30,96,134,0.26),_transparent_32%),radial-gradient(circle_at_82%_18%,_rgba(212,168,87,0.15),_transparent_18%),linear-gradient(180deg,_#05090e,_#091019_44%,_#070d13_100%)] px-4',
        badge: 'inline-flex rounded-full border border-[#d6b16b]/30 bg-[#d6b16b]/12 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.24em] text-[#f2d39a]',
        heading: 'mt-4 text-3xl font-bold text-white',
        card: 'rounded-[1.8rem] border border-white/10 bg-[linear-gradient(180deg,rgba(15,21,29,0.96),rgba(8,12,18,0.96))] p-6 shadow-[0_28px_80px_rgba(0,0,0,0.38)] backdrop-blur-xl',
        label: 'mb-2 block text-sm font-medium text-slate-300',
        input: 'w-full rounded-xl border border-white/10 bg-white/6 px-3 py-3 text-base text-white outline-none transition placeholder:text-slate-500 focus:border-[#7fb5d6] focus:ring-2 focus:ring-[#7fb5d6]/20',
        error: 'mt-2 text-sm text-red-300',
        submit: 'mt-4 w-full rounded-xl bg-[linear-gradient(135deg,#d4a857,#7a5f2d)] py-3 text-[#071017] font-medium transition hover:brightness-105 disabled:opacity-40',
        toggle: 'inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/6 px-3 py-2 text-slate-200 transition hover:bg-white/10 hover:text-white',
      }
    : {
        root: 'min-h-screen flex items-center justify-center bg-[radial-gradient(circle_at_top,_rgba(78,118,155,0.14),_transparent_30%),linear-gradient(180deg,_#f8f6f1,_#efe9de_100%)] px-4',
        badge: 'inline-flex rounded-full bg-[#0f172a] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.24em] text-white/85',
        heading: 'mt-4 text-3xl font-bold text-slate-950',
        card: 'rounded-[1.8rem] border border-white/80 bg-white/90 p-6 shadow-[0_24px_60px_rgba(15,23,42,0.10)] backdrop-blur-xl',
        label: 'mb-2 block text-sm font-medium text-slate-700',
        input: 'w-full rounded-xl border border-slate-200 bg-white px-3 py-3 text-base text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-[#4E769B] focus:ring-2 focus:ring-[#4E769B]/15',
        error: 'mt-2 text-sm text-red-600',
        submit: 'mt-4 w-full rounded-xl bg-slate-900 py-3 font-medium text-white transition hover:bg-slate-800 disabled:opacity-40',
        toggle: 'inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white/90 px-3 py-2 text-slate-700 transition hover:bg-slate-50 hover:text-slate-950',
      };

  return (
    <div className={themeClasses.root}>
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <div className="mb-5 flex justify-center">
            <ThemeModeButton
              themePreference={themePreference}
              onCycle={cycleTheme}
              className={themeClasses.toggle}
              labelClassName="text-xs font-semibold uppercase tracking-[0.14em]"
            />
          </div>
          <div className={themeClasses.badge}>Admin</div>
          <h1 className={themeClasses.heading}>{isDark ? 'Ingreso nocturno' : 'Ingreso admin'}</h1>
        </div>
        <form onSubmit={handleSubmit} className={themeClasses.card}>
          <label className={themeClasses.label}>Contraseña</label>
          <input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            className={themeClasses.input}
            autoFocus
          />
          {error && <div className={themeClasses.error}>{error}</div>}
          <button
            type="submit"
            disabled={!password || loading}
            className={themeClasses.submit}
          >
            {loading ? 'Ingresando...' : 'Ingresar'}
          </button>
        </form>
      </div>
    </div>
  );
}
