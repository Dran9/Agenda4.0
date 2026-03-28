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
    onSubmitOnboarding({
      ...form,
      age: form.age ? parseInt(form.age) : undefined,
    });
  }

  return (
    <div>
      <div className="text-[10px] font-mono text-gray-300 mb-2">Step 3</div>
      <button
        type="button"
        onClick={() => dispatch({ type: 'GO_BACK' })}
        className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-4"
      >
        <ChevronLeft size={16} />
        Volver
      </button>

      <h2 className="text-lg font-semibold mb-1">Completa tus datos</h2>
      <p className="text-sm text-gray-500 mb-4">Es tu primera vez. Necesitamos algunos datos para agendar.</p>

      <form onSubmit={handleSubmit} className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Nombre</label>
            <input
              name="first_name"
              value={form.first_name}
              onChange={handleChange}
              required
              className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-base focus:outline-none focus:ring-2 focus:ring-gray-300"
              autoFocus
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Apellido</label>
            <input
              name="last_name"
              value={form.last_name}
              onChange={handleChange}
              required
              className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-base focus:outline-none focus:ring-2 focus:ring-gray-300"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Edad</label>
            <input
              name="age"
              type="number"
              value={form.age}
              onChange={handleChange}
              min="1"
              max="120"
              className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-base focus:outline-none focus:ring-2 focus:ring-gray-300"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Ciudad</label>
            <select
              name="city"
              value={form.city}
              onChange={handleChange}
              className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-base bg-white focus:outline-none focus:ring-2 focus:ring-gray-300"
            >
              <option value="Cochabamba">Cochabamba</option>
              <option value="Santa Cruz">Santa Cruz</option>
              <option value="La Paz">La Paz</option>
              <option value="Sucre">Sucre</option>
              <option value="Otro">Otro</option>
            </select>
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">¿Cómo nos encontraste?</label>
          <select
            name="source"
            value={form.source}
            onChange={handleChange}
            className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-base bg-white focus:outline-none focus:ring-2 focus:ring-gray-300"
          >
            <option value="Instagram">Instagram</option>
            <option value="Referido">Referido</option>
            <option value="Google">Google</option>
            <option value="Sitio web">Sitio web</option>
            <option value="Otro">Otro</option>
          </select>
        </div>

        {state.error && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
            {state.error}
          </div>
        )}

        <button
          type="submit"
          disabled={!form.first_name.trim() || !form.last_name.trim() || state.loading}
          className="w-full py-3 bg-gray-900 text-white rounded-lg font-medium disabled:opacity-40 disabled:cursor-not-allowed hover:bg-gray-800 transition-colors"
        >
          {state.loading ? 'Agendando...' : 'Agendar cita'}
        </button>
      </form>
    </div>
  );
}
