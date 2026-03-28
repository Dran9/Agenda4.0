import { useState, useEffect, useRef } from 'react';
import { ChevronLeft, ChevronDown } from 'lucide-react';

const COUNTRY_CODES = [
  { code: '591', flag: '🇧🇴', name: 'Bolivia', digits: 8 },
  { code: '54', flag: '🇦🇷', name: 'Argentina', digits: 10 },
  { code: '56', flag: '🇨🇱', name: 'Chile', digits: 9 },
  { code: '57', flag: '🇨🇴', name: 'Colombia', digits: 10 },
  { code: '51', flag: '🇵🇪', name: 'Perú', digits: 9 },
  { code: '593', flag: '🇪🇨', name: 'Ecuador', digits: 9 },
  { code: '52', flag: '🇲🇽', name: 'México', digits: 10 },
  { code: '34', flag: '🇪🇸', name: 'España', digits: 9 },
  { code: '1', flag: '🇺🇸', name: 'USA', digits: 10 },
  { code: '55', flag: '🇧🇷', name: 'Brasil', digits: 11 },
  { code: '595', flag: '🇵🇾', name: 'Paraguay', digits: 9 },
  { code: '598', flag: '🇺🇾', name: 'Uruguay', digits: 8 },
  { code: '58', flag: '🇻🇪', name: 'Venezuela', digits: 10 },
  { code: '33', flag: '🇫🇷', name: 'Francia', digits: 9 },
  { code: '49', flag: '🇩🇪', name: 'Alemania', digits: 11 },
  { code: '39', flag: '🇮🇹', name: 'Italia', digits: 10 },
  { code: '44', flag: '🇬🇧', name: 'Reino Unido', digits: 10 },
  { code: '46', flag: '🇸🇪', name: 'Suecia', digits: 9 },
  { code: '47', flag: '🇳🇴', name: 'Noruega', digits: 8 },
  { code: '45', flag: '🇩🇰', name: 'Dinamarca', digits: 8 },
  { code: '41', flag: '🇨🇭', name: 'Suiza', digits: 9 },
  { code: '31', flag: '🇳🇱', name: 'Países Bajos', digits: 9 },
  { code: '351', flag: '🇵🇹', name: 'Portugal', digits: 9 },
  { code: '48', flag: '🇵🇱', name: 'Polonia', digits: 9 },
  { code: '43', flag: '🇦🇹', name: 'Austria', digits: 10 },
  { code: '32', flag: '🇧🇪', name: 'Bélgica', digits: 9 },
  { code: '358', flag: '🇫🇮', name: 'Finlandia', digits: 9 },
  { code: '353', flag: '🇮🇪', name: 'Irlanda', digits: 9 },
  { code: '381', flag: '🇷🇸', name: 'Serbia', digits: 9 },
];

// Parse a full phone number into { countryCode, local }
function parsePrefill(full) {
  if (!full) return null;
  const digits = full.replace(/\D/g, '');
  for (const cc of [...COUNTRY_CODES].sort((a, b) => b.code.length - a.code.length)) {
    if (digits.startsWith(cc.code)) {
      return { countryCode: cc.code, local: digits.slice(cc.code.length) };
    }
  }
  return { countryCode: '591', local: digits };
}

export default function PhoneScreen({ state, dispatch, onSubmitPhone, prefillPhone, detectedCountryCode }) {
  const prefill = parsePrefill(prefillPhone);
  const initialCC = prefill?.countryCode || detectedCountryCode || '591';
  const [phone, setPhone] = useState(prefill?.local || state.phone || '');
  const [countryCode, setCountryCode] = useState(initialCC);
  const [showDropdown, setShowDropdown] = useState(false);
  const autoSubmitted = useRef(false);
  const userChangedCountry = useRef(false);

  // Sync country code when timezone changes (unless user manually picked a country)
  useEffect(() => {
    if (!userChangedCountry.current && detectedCountryCode && !prefillPhone) {
      setCountryCode(detectedCountryCode);
      setPhone('');
    }
  }, [detectedCountryCode]);

  const currentCountry = COUNTRY_CODES.find(c => c.code === countryCode) || COUNTRY_CODES[0];
  const expectedDigits = currentCountry.digits;
  const digitCount = phone.replace(/\D/g, '').length;
  const phoneComplete = digitCount === expectedDigits;
  const fullPhone = countryCode + phone;

  // Auto-submit if phone was pre-filled with enough digits
  useEffect(() => {
    if (prefill && prefill.local.length >= 7 && !autoSubmitted.current && !state.loading) {
      autoSubmitted.current = true;
      onSubmitPhone(prefill.countryCode + prefill.local);
    }
  }, []);

  function handlePhoneChange(e) {
    const val = e.target.value.replace(/\D/g, '');
    if (val.length <= expectedDigits) setPhone(val);
  }

  function handleSubmit(e) {
    e.preventDefault();
    if (!phoneComplete) return;
    onSubmitPhone(fullPhone);
  }

  // If auto-submitting, show loading
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
          {/* Country selector */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setShowDropdown(!showDropdown)}
              className="flex items-center gap-1 px-2 py-2.5 border border-gray-200 rounded-lg text-sm bg-white min-w-[90px]"
            >
              <span>{currentCountry.flag}</span>
              <span>+{currentCountry.code}</span>
              <ChevronDown size={12} className="text-gray-400" />
            </button>

            {showDropdown && (
              <div className="absolute top-full mt-1 left-0 bg-white border border-gray-200 rounded-lg shadow-lg z-50 w-56 max-h-60 overflow-y-auto">
                {COUNTRY_CODES.map(cc => (
                  <button
                    key={cc.code}
                    type="button"
                    onClick={() => { userChangedCountry.current = true; setCountryCode(cc.code); setShowDropdown(false); setPhone(''); }}
                    className={`w-full text-left px-3 py-2 text-sm flex items-center gap-2 hover:bg-gray-50 ${
                      cc.code === countryCode ? 'bg-gray-100 font-medium' : ''
                    }`}
                  >
                    <span>{cc.flag}</span>
                    <span>+{cc.code}</span>
                    <span className="text-gray-400 ml-auto text-xs">{cc.name}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <input
            type="tel"
            value={phone}
            onChange={handlePhoneChange}
            placeholder={currentCountry.code === '591' ? '72034151' : ''}
            maxLength={expectedDigits}
            className="flex-1 px-3 py-2.5 border border-gray-200 rounded-lg text-base focus:outline-none focus:ring-2 focus:ring-gray-300"
            autoFocus
          />
        </div>

        <div className={`text-xs mt-1 transition-colors ${
          phoneComplete ? 'text-green-600 font-medium' : digitCount > 0 ? 'text-gray-400' : 'text-transparent'
        }`}>
          {digitCount}/{expectedDigits} dígitos
        </div>

        {state.error && (
          <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
            {state.error}
          </div>
        )}

        <button
          type="submit"
          disabled={!phoneComplete || state.loading}
          className="w-full mt-4 py-3 bg-gray-900 text-white rounded-lg font-medium disabled:opacity-40 disabled:cursor-not-allowed hover:bg-gray-800 transition-colors"
        >
          {state.loading ? 'Verificando...' : 'Continuar'}
        </button>
      </form>
    </div>
  );
}
