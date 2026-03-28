import { useState } from 'react';
import { ChevronLeft } from 'lucide-react';

export default function ConfirmScreen({ state, dispatch, onSubmitOnboarding }) {
  const [form, setForm] = useState({
    first_name: '',
    last_name: '',
    age: '',
    city: 'Cochabamba',
    country: 'Bolivia',
    source: 'Otro',
  });

  function handleChange(e) {
    setForm(f => ({ ...f, [e.target.name]: e.target.value }));
  }

  function handleSubmit(e) {
    e.preventDefault();
    if (!form.first_name.trim() || !form.last_name.trim()) return;
    onSubmitOnboarding({ ...form, age: form.age ? parseInt(form.age) : undefined });
  }

  return (
    <div style={{ width: '100%' }}>
      <button
        type="button"
        onClick={() => dispatch({ type: 'GO_BACK' })}
        style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 14, color: 'var(--gris-medio)', background: 'none', border: 'none', cursor: 'pointer', marginBottom: 16, padding: 0 }}
      >
        <ChevronLeft size={16} />
        Volver
      </button>

      <h2 style={{ fontSize: 20, fontWeight: 600, marginBottom: 4 }}>Completa tus datos</h2>
      <p style={{ fontSize: 14, color: 'var(--gris-medio)', marginBottom: 20 }}>Es tu primera vez. Necesitamos algunos datos para agendar.</p>

      <form onSubmit={handleSubmit}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
          <div>
            <div className="field-label" style={{ fontSize: 12 }}>Nombre</div>
            <input name="first_name" value={form.first_name} onChange={handleChange} required className="input-field" autoFocus />
          </div>
          <div>
            <div className="field-label" style={{ fontSize: 12 }}>Apellido</div>
            <input name="last_name" value={form.last_name} onChange={handleChange} required className="input-field" />
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
          <div>
            <div className="field-label" style={{ fontSize: 12 }}>Edad</div>
            <input name="age" type="number" value={form.age} onChange={handleChange} min="1" max="120" className="input-field" />
          </div>
          <div>
            <div className="field-label" style={{ fontSize: 12 }}>Ciudad</div>
            <select name="city" value={form.city} onChange={handleChange} className="input-field" style={{ appearance: 'auto' }}>
              <option value="Cochabamba">Cochabamba</option>
              <option value="Santa Cruz">Santa Cruz</option>
              <option value="La Paz">La Paz</option>
              <option value="Sucre">Sucre</option>
              <option value="Otro">Otro</option>
            </select>
          </div>
        </div>

        <div style={{ marginBottom: 16 }}>
          <div className="field-label" style={{ fontSize: 12 }}>¿Cómo nos encontraste?</div>
          <select name="source" value={form.source} onChange={handleChange} className="input-field" style={{ appearance: 'auto' }}>
            <option value="Instagram">Instagram</option>
            <option value="Referido">Referido</option>
            <option value="Google">Google</option>
            <option value="Sitio web">Sitio web</option>
            <option value="Otro">Otro</option>
          </select>
        </div>

        {state.error && (
          <div style={{ marginBottom: 12, padding: 12, background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 12, fontSize: 14, color: 'var(--terracota)' }}>
            {state.error}
          </div>
        )}

        <button
          type="submit"
          disabled={!form.first_name.trim() || !form.last_name.trim() || state.loading}
          className="btn-primary"
        >
          {state.loading ? 'Agendando...' : 'Agendar cita'}
        </button>
      </form>
    </div>
  );
}
