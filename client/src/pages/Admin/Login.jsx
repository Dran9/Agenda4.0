import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../utils/api';

export default function Login() {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

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

  return (
    <div className="min-h-screen flex items-center justify-center bg-[radial-gradient(circle_at_top,_rgba(30,96,134,0.26),_transparent_32%),radial-gradient(circle_at_82%_18%,_rgba(212,168,87,0.15),_transparent_18%),linear-gradient(180deg,_#05090e,_#091019_44%,_#070d13_100%)] px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <div className="inline-flex rounded-full border border-[#d6b16b]/30 bg-[#d6b16b]/12 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.24em] text-[#f2d39a]">
            Admin
          </div>
          <h1 className="mt-4 text-3xl font-bold text-white">Ingreso nocturno</h1>
        </div>
        <form onSubmit={handleSubmit} className="rounded-[1.8rem] border border-white/10 bg-[linear-gradient(180deg,rgba(15,21,29,0.96),rgba(8,12,18,0.96))] p-6 shadow-[0_28px_80px_rgba(0,0,0,0.38)] backdrop-blur-xl">
          <label className="mb-2 block text-sm font-medium text-slate-300">Contraseña</label>
          <input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            className="w-full rounded-xl border border-white/10 bg-white/6 px-3 py-3 text-base text-white outline-none transition placeholder:text-slate-500 focus:border-[#7fb5d6] focus:ring-2 focus:ring-[#7fb5d6]/20"
            autoFocus
          />
          {error && <div className="mt-2 text-sm text-red-300">{error}</div>}
          <button
            type="submit"
            disabled={!password || loading}
            className="mt-4 w-full rounded-xl bg-[linear-gradient(135deg,#d4a857,#7a5f2d)] py-3 text-[#071017] font-medium transition hover:brightness-105 disabled:opacity-40"
          >
            {loading ? 'Ingresando...' : 'Ingresar'}
          </button>
        </form>
      </div>
    </div>
  );
}
