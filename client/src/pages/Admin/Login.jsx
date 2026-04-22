import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../utils/api';

export default function Login() {
  const [pin, setPin] = useState('');
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
    if (pin.length !== 6) return;
    setLoading(true);
    setError('');
    try {
      const data = await api.post('/auth/login', { pin });
      localStorage.setItem('auth_token', data.token);
      navigate('/admin/quick-actions', { replace: true });
    } catch (err) {
      setError(err.message);
      setPin('');
    } finally {
      setLoading(false);
    }
  }

  function handleKeyClick(digit) {
    if (loading || pin.length >= 6) return;
    setPin((prev) => prev + digit);
    setError('');
  }

  function handleBackspace() {
    setPin((prev) => prev.slice(0, -1));
    setError('');
  }

  // Auto-submit when 6 digits entered
  useEffect(() => {
    if (pin.length === 6 && !loading) {
      const form = document.getElementById('pin-form');
      if (form) form.requestSubmit();
    }
  }, [pin, loading]);

  const pinDots = Array.from({ length: 6 }, (_, i) => (
    <div
      key={i}
      className={`h-4 w-4 rounded-full border-2 transition-all ${
        i < pin.length
          ? 'border-[#4E769B] bg-[#4E769B]'
          : 'border-slate-300 bg-transparent'
      }`}
    />
  ));

  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'backspace'];

  return (
    <div className="min-h-screen flex items-center justify-center bg-[radial-gradient(circle_at_top,_rgba(78,118,155,0.14),_transparent_30%),linear-gradient(180deg,_#f8f6f1,_#efe9de_100%)] px-4">
      <div className="w-full max-w-xs">
        <div className="mb-8 text-center">
          <div className="inline-flex rounded-full bg-[#0f172a] px-4 py-1.5 text-[11px] font-semibold uppercase tracking-[0.24em] text-white/85">
            Admin
          </div>
          <h1 className="mt-4 text-2xl font-bold text-slate-950">
            Ingreso
          </h1>
        </div>

        <form id="pin-form" onSubmit={handleSubmit} className="space-y-6">
          {/* PIN Display */}
          <div className="flex justify-center gap-3 py-4">
            {pinDots}
          </div>

          {error && (
            <div className="text-center text-sm text-red-600">
              {error}
            </div>
          )}

          {/* Numeric Keypad */}
          <div className="grid grid-cols-3 gap-3">
            {keys.map((key, idx) => {
              if (key === '') {
                return <div key={idx} />;
              }
              if (key === 'backspace') {
                return (
                  <button
                    key={idx}
                    type="button"
                    onClick={handleBackspace}
                    disabled={pin.length === 0 || loading}
                    className="flex h-16 items-center justify-center rounded-2xl bg-slate-100 text-slate-600 transition active:bg-slate-200 disabled:opacity-30"
                  >
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21 4H8l-7 8 7 8h13a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2z" />
                      <line x1="18" y1="9" x2="12" y2="15" />
                      <line x1="12" y1="9" x2="18" y2="15" />
                    </svg>
                  </button>
                );
              }
              return (
                <button
                  key={idx}
                  type="button"
                  onClick={() => handleKeyClick(key)}
                  disabled={loading}
                  className="flex h-16 items-center justify-center rounded-2xl bg-white text-2xl font-semibold text-slate-900 shadow-sm transition active:bg-slate-100 active:scale-[0.96] disabled:opacity-50"
                >
                  {key}
                </button>
              );
            })}
          </div>

          {/* Hidden submit for accessibility */}
          <button type="submit" className="sr-only">
            Ingresar
          </button>
        </form>
      </div>
    </div>
  );
}
