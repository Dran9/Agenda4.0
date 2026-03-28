import { useState, useEffect, useRef } from 'react';
import { ChevronLeft, ChevronDown } from 'lucide-react';

const COUNTRY_CODES = [
  { code: '591', flag: '\u{1F1E7}\u{1F1F4}', name: 'Bolivia', digits: 8 },
  { code: '54', flag: '\u{1F1E6}\u{1F1F7}', name: 'Argentina', digits: 10 },
  { code: '56', flag: '\u{1F1E8}\u{1F1F1}', name: 'Chile', digits: 9 },
  { code: '57', flag: '\u{1F1E8}\u{1F1F4}', name: 'Colombia', digits: 10 },
  { code: '51', flag: '\u{1F1F5}\u{1F1EA}', name: 'Perú', digits: 9 },
  { code: '593', flag: '\u{1F1EA}\u{1F1E8}', name: 'Ecuador', digits: 9 },
  { code: '52', flag: '\u{1F1F2}\u{1F1FD}', name: 'México', digits: 10 },
  { code: '34', flag: '\u{1F1EA}\u{1F1F8}', name: 'España', digits: 9 },
  { code: '1', flag: '\u{1F1FA}\u{1F1F8}', name: 'USA', digits: 10 },
  { code: '55', flag: '\u{1F1E7}\u{1F1F7}', name: 'Brasil', digits: 11 },
  { code: '595', flag: '\u{1F1F5}\u{1F1FE}', name: 'Paraguay', digits: 9 },
  { code: '598', flag: '\u{1F1FA}\u{1F1FE}', name: 'Uruguay', digits: 8 },
  { code: '58', flag: '\u{1F1FB}\u{1F1EA}', name: 'Venezuela', digits: 10 },
  { code: '33', flag: '\u{1F1EB}\u{1F1F7}', name: 'Francia', digits: 9 },
  { code: '49', flag: '\u{1F1E9}\u{1F1EA}', name: 'Alemania', digits: 11 },
  { code: '39', flag: '\u{1F1EE}\u{1F1F9}', name: 'Italia', digits: 10 },
  { code: '44', flag: '\u{1F1EC}\u{1F1E7}', name: 'Reino Unido', digits: 10 },
  { code: '46', flag: '\u{1F1F8}\u{1F1EA}', name: 'Suecia', digits: 9 },
  { code: '47', flag: '\u{1F1F3}\u{1F1F4}', name: 'Noruega', digits: 8 },
  { code: '45', flag: '\u{1F1E9}\u{1F1F0}', name: 'Dinamarca', digits: 8 },
  { code: '41', flag: '\u{1F1E8}\u{1F1ED}', name: 'Suiza', digits: 9 },
  { code: '31', flag: '\u{1F1F3}\u{1F1F1}', name: 'Países Bajos', digits: 9 },
  { code: '351', flag: '\u{1F1F5}\u{1F1F9}', name: 'Portugal', digits: 9 },
  { code: '48', flag: '\u{1F1F5}\u{1F1F1}', name: 'Polonia', digits: 9 },
  { code: '43', flag: '\u{1F1E6}\u{1F1F9}', name: 'Austria', digits: 10 },
  { code: '32', flag: '\u{1F1E7}\u{1F1EA}', name: 'Bélgica', digits: 9 },
  { code: '358', flag: '\u{1F1EB}\u{1F1EE}', name: 'Finlandia', digits: 9 },
  { code: '353', flag: '\u{1F1EE}\u{1F1EA}', name: 'Irlanda', digits: 9 },
  { code: '381', flag: '\u{1F1F7}\u{1F1F8}', name: 'Serbia', digits: 9 },
];

function parsePrefill(full) {
  if (!full) return null;
  const digits = full.replace(/\D/g, '');
  for (const cc of [...COUNTRY_CODES].sort((a, b) => b.code.length - a.code.length)) {
    if (digits.startsWith(cc.code)) return { countryCode: cc.code, local: digits.slice(cc.code.length) };
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

  if (prefill && prefill.local.length >= 7 && state.loading) {
    return (
      <div style={{ width: '100%' }}>
        <div style={{ textAlign: 'center', padding: '48px 0', color: 'var(--gris-medio)', fontSize: 14 }}>
          Verificando tu número...
        </div>
      </div>
    );
  }

  return (
    <div style={{ width: '100%' }}>
      <button
        type="button"
        onClick={() => dispatch({ type: 'GO_BACK' })}
        style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 14, color: 'var(--gris-medio)', background: 'none', border: 'none', cursor: 'pointer', marginBottom: 16, padding: 0 }}
      >
        <ChevronLeft size={16} />
        Volver al calendario
      </button>

      <div className="summary-card">
        <div className="summary-card-icon">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--azul-acero)" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
        </div>
        <div>
          <div className="summary-card-text">{state.selectedDate}</div>
          <div className="summary-card-sub">{state.selectedSlot?.time}</div>
        </div>
      </div>

      <form onSubmit={handleSubmit}>
        <div className="field-label">Tu número de teléfono</div>

        <div style={{ display: 'flex', gap: 8 }}>
          <div style={{ position: 'relative' }}>
            <button
              type="button"
              onClick={() => setShowDropdown(!showDropdown)}
              className="country-selector"
            >
              <span>{currentCountry.flag}</span>
              <span>+{currentCountry.code}</span>
              <ChevronDown size={12} style={{ color: 'var(--gris-medio)' }} />
            </button>

            {showDropdown && (
              <div className="country-dropdown">
                {COUNTRY_CODES.map(cc => (
                  <button
                    key={cc.code} type="button"
                    onClick={() => { userChangedCountry.current = true; setCountryCode(cc.code); setShowDropdown(false); setPhone(''); }}
                    className="country-dropdown-item"
                    style={{ background: cc.code === countryCode ? 'var(--blanco-gris)' : 'transparent', fontWeight: cc.code === countryCode ? 600 : 400 }}
                  >
                    <span>{cc.flag}</span>
                    <span>+{cc.code}</span>
                    <span style={{ color: 'var(--gris-medio)', marginLeft: 'auto', fontSize: 13 }}>{cc.name}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <input
            type="tel" value={phone} onChange={handlePhoneChange}
            placeholder={currentCountry.code === '591' ? '72034151' : ''}
            maxLength={expectedDigits}
            className="input-field"
            style={{ flex: 1 }}
            autoFocus
          />
        </div>

        <div className="phone-digit-hint" style={{ color: phoneComplete ? 'var(--turquesa)' : digitCount > 0 ? 'var(--gris-medio)' : 'transparent', fontWeight: phoneComplete ? 600 : 400 }}>
          {digitCount}/{expectedDigits} dígitos
        </div>

        {state.error && (
          <div style={{ marginTop: 12, padding: 12, background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 12, fontSize: 14, color: 'var(--terracota)' }}>
            {state.error}
          </div>
        )}

        <button
          type="submit"
          disabled={!phoneComplete || state.loading}
          className="btn-primary"
          style={{ marginTop: 16 }}
        >
          {state.loading ? 'Verificando...' : 'Continuar'}
        </button>
      </form>
    </div>
  );
}
