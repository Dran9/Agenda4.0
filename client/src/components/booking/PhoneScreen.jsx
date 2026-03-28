import { useState, useEffect, useRef } from 'react';
import { ChevronLeft } from 'lucide-react';

const COUNTRY_CODES = ['591', '54', '56', '51', '57', '52', '34', '1'];

// Parse a full phone number into { countryCode, local }
function parsePrefill(full) {
  if (!full) return null;
  const digits = full.replace(/\D/g, '');
  // Try matching longest country codes first
  for (const cc of [...COUNTRY_CODES].sort((a, b) => b.length - a.length)) {
    if (digits.startsWith(cc)) {
      return { countryCode: cc, local: digits.slice(cc.length) };
    }
  }
  // No match — assume Bolivia
  return { countryCode: '591', local: digits };
}

export default function PhoneScreen({ state, dispatch, onSubmitPhone, prefillPhone }) {
  const prefill = parsePrefill(prefillPhone);
  const [phone, setPhone] = useState(prefill?.local || state.phone || '');
  const [countryCode, setCountryCode] = useState(prefill?.countryCode || '591');
  const autoSubmitted = useRef(false);

  const fullPhone = countryCode + phone;
  const digitCount = phone.replace(/\D/g, '').length;

  // Auto-submit if phone was pre-filled with enough digits
  useEffect(() => {
    if (prefill && prefill.local.length >= 7 && !autoSubmitted.current && !state.loading) {
      autoSubmitted.current = true;
      onSubmitPhone(prefill.countryCode + prefill.local);
    }
  }, []);

  function handleSubmit(e) {
    e.preventDefault();
    if (digitCount < 7) return;
    onSubmitPhone(fullPhone);
  }

  // If auto-submitting, show a loading state
  if (prefill && prefill.local.length >= 7 && state.loading) {
    return (
      <div>
        <div className="text-xs font-mono text-gray-400 mb-2">Step 2</div>
        <div className="text-center py-12">
          <div className="text-gray-400 text-sm">Verificando tu número...</div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="text-xs font-mono text-gray-400 mb-2">Step 2</div>
      <button
        type="button"
        onClick={() => dispatch({ type: 'GO_BACK' })}
        className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-4"
      >
        <ChevronLeft size={16} />
        Volver al calendario
      </button>

      <div className="mb-2 text-sm text-gray-500">
        Horario seleccionado: <span className="font-medium text-gray-900">{state.selectedDate} a las {state.selectedSlot?.time}</span>
      </div>

      <form onSubmit={handleSubmit} className="mt-6">
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Tu número de teléfono
        </label>

        <div className="flex gap-2">
          <select
            value={countryCode}
            onChange={e => setCountryCode(e.target.value)}
            className="w-24 px-2 py-2.5 border border-gray-200 rounded-lg text-sm bg-white"
          >
            <option value="591">+591</option>
            <option value="54">+54</option>
            <option value="56">+56</option>
            <option value="51">+51</option>
            <option value="57">+57</option>
            <option value="52">+52</option>
            <option value="34">+34</option>
            <option value="1">+1</option>
          </select>

          <input
            type="tel"
            value={phone}
            onChange={e => setPhone(e.target.value.replace(/\D/g, ''))}
            placeholder="72034151"
            className="flex-1 px-3 py-2.5 border border-gray-200 rounded-lg text-base focus:outline-none focus:ring-2 focus:ring-gray-300"
            autoFocus
          />
        </div>

        <div className="text-xs text-gray-400 mt-1">{digitCount}/8 dígitos</div>

        {state.error && (
          <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
            {state.error}
          </div>
        )}

        <button
          type="submit"
          disabled={digitCount < 7 || state.loading}
          className="w-full mt-4 py-3 bg-gray-900 text-white rounded-lg font-medium disabled:opacity-40 disabled:cursor-not-allowed hover:bg-gray-800 transition-colors"
        >
          {state.loading ? 'Verificando...' : 'Continuar'}
        </button>
      </form>
    </div>
  );
}
