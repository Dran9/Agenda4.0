import { useState, useEffect, useCallback, useMemo, useReducer } from 'react';
import Calendar from '../components/Calendar';
import { api } from '../utils/api';
import {
  TIMEZONE_GROUPS, DEFAULT_TZ, convertLaPazTimeToTz, getCurrentTimeInTz, detectTimezoneFromIP, TZ_TO_PHONE_CODE,
} from '../utils/timezones';
import {
  ArrowRight, ArrowLeft, ChevronDown, Calendar as CalendarIcon,
  Clock, CalendarClock, CalendarCheck, Check, Sun, Sunset,
  Coffee, Globe, Search, RefreshCw, Heart, MessageSquareHeart, ShieldAlert, Info, MousePointerClick, Smartphone, SmilePlus,
} from 'lucide-react';

const COUNTRY_CODES = [
  { code: '+591', flag: '\u{1F1E7}\u{1F1F4}', name: 'Bolivia', digits: 8 },
  { code: '+54', flag: '\u{1F1E6}\u{1F1F7}', name: 'Argentina', digits: 10 },
  { code: '+56', flag: '\u{1F1E8}\u{1F1F1}', name: 'Chile', digits: 9 },
  { code: '+57', flag: '\u{1F1E8}\u{1F1F4}', name: 'Colombia', digits: 10 },
  { code: '+51', flag: '\u{1F1F5}\u{1F1EA}', name: 'Perú', digits: 9 },
  { code: '+593', flag: '\u{1F1EA}\u{1F1E8}', name: 'Ecuador', digits: 9 },
  { code: '+52', flag: '\u{1F1F2}\u{1F1FD}', name: 'México', digits: 10 },
  { code: '+34', flag: '\u{1F1EA}\u{1F1F8}', name: 'España', digits: 9 },
  { code: '+1', flag: '\u{1F1FA}\u{1F1F8}', name: 'USA', digits: 10 },
  { code: '+55', flag: '\u{1F1E7}\u{1F1F7}', name: 'Brasil', digits: 11 },
  { code: '+595', flag: '\u{1F1F5}\u{1F1FE}', name: 'Paraguay', digits: 9 },
  { code: '+598', flag: '\u{1F1FA}\u{1F1FE}', name: 'Uruguay', digits: 8 },
  { code: '+58', flag: '\u{1F1FB}\u{1F1EA}', name: 'Venezuela', digits: 10 },
  { code: '+33', flag: '\u{1F1EB}\u{1F1F7}', name: 'Francia', digits: 9 },
  { code: '+49', flag: '\u{1F1E9}\u{1F1EA}', name: 'Alemania', digits: 11 },
  { code: '+39', flag: '\u{1F1EE}\u{1F1F9}', name: 'Italia', digits: 10 },
  { code: '+44', flag: '\u{1F1EC}\u{1F1E7}', name: 'Reino Unido', digits: 10 },
];

const CITIES = ['Cochabamba', 'Santa Cruz', 'La Paz', 'Sucre', 'Otro'];
const SOURCES = ['Referencia de amigos', 'Redes sociales', 'Otro'];

const DAY_NAMES_ES = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const MONTH_NAMES_ES = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];

function formatDateES(dateStr) {
  const d = new Date(dateStr + 'T12:00:00');
  const day = DAY_NAMES_ES[d.getDay()];
  const num = d.getDate();
  const month = MONTH_NAMES_ES[d.getMonth()];
  const year = d.getFullYear();
  return `${day.charAt(0).toUpperCase() + day.slice(1)}, ${num} de ${month} de ${year}`;
}

function Logo({ width = 90 }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'center' }} className={width >= 120 ? 'logo' : 'logo-small'}>
      <img src="/logo.svg" alt="Daniel MacLean" style={{ width, height: 'auto' }} />
    </div>
  );
}

function ProgressDots({ current, total = 4, done = false }) {
  return (
    <div className="progress-dots">
      {Array.from({ length: total }, (_, i) => (
        <div key={i} className={`progress-dot ${done ? 'done' : i < current ? 'active' : ''}`} />
      ))}
    </div>
  );
}

function Layout({ children, devMode }) {
  return (
    <div className="booking-container" style={{ paddingBottom: 32 }}>
      {devMode && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, background: 'var(--dorado)', textAlign: 'center', padding: '4px 0', fontSize: 14, fontWeight: 600, color: 'var(--negro)', zIndex: 100 }}>
          MODO DESARROLLO — Sin límite de intentos
        </div>
      )}
      {children}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// REDUCER
// ═══════════════════════════════════════════════════════════════════
const initialFlowState = {
  screen: 1, loading: false, error: '',
  clientId: null, clientName: '',
  activeAppointment: null,
  showOnboarding: false, isReturning: false,
  rescheduleMode: false, oldAppointment: null, wasRescheduled: false,
  bookedAppointment: null,
};

function flowReducer(state, action) {
  switch (action.type) {
    case 'PICK_SLOT':
      return { ...state, screen: state.rescheduleMode ? 7 : 2, error: '' };
    case 'PHONE_CHECK_START':
      return { ...state, loading: true, error: '' };
    case 'PHONE_HAS_APPOINTMENT':
      return { ...state, loading: false, screen: 6, activeAppointment: action.appointment, clientId: action.clientId, clientName: action.clientName };
    case 'PHONE_RETURNING':
      return { ...state, loading: false, screen: 3, isReturning: true, clientName: action.clientName, clientId: action.clientId };
    case 'PHONE_NEW':
      return { ...state, loading: false, screen: 3, showOnboarding: true };
    case 'PHONE_ERROR':
      return { ...state, loading: false, error: action.error };
    case 'BOOK_START':
      return { ...state, loading: true, error: '' };
    case 'BOOK_SUCCESS':
      return { ...state, loading: false, screen: 5, bookedAppointment: action.appointment, clientName: action.clientName || state.clientName };
    case 'BOOK_NEEDS_ONBOARDING':
      return { ...state, loading: false, showOnboarding: true };
    case 'BOOK_HAS_APPOINTMENT':
      return { ...state, loading: false, screen: 6, activeAppointment: action.appointment, clientId: action.clientId, clientName: action.clientName || state.clientName };
    case 'BOOK_ERROR':
      return { ...state, loading: false, error: action.error };
    case 'ENTER_RESCHEDULE':
      return { ...state, screen: 1, rescheduleMode: true, oldAppointment: action.oldAppointment, error: '' };
    case 'RESCHEDULE_START':
      return { ...state, loading: true, error: '' };
    case 'RESCHEDULE_SUCCESS':
      return { ...state, loading: false, screen: 5, wasRescheduled: true, bookedAppointment: action.appointment, rescheduleMode: false, oldAppointment: null, activeAppointment: null };
    case 'RESCHEDULE_ERROR':
      return { ...state, loading: false, error: action.error };
    case 'KEEP_APPOINTMENT':
      return { ...state, screen: 5, bookedAppointment: action.appointment };
    case 'GO_BACK':
      return { ...state, screen: action.screen, error: '' };
    case 'CLEAR_ERROR':
      return { ...state, error: '' };
    default:
      return state;
  }
}

// Parse URL params once
const pageParams = new URLSearchParams(window.location.search);

export default function BookingFlow() {
  const devMode = pageParams.get('devmode') === '1';
  const urlPhone = pageParams.get('t') || '';
  const urlCode = pageParams.get('code') || '';

  const [flow, dispatch] = useReducer(flowReducer, initialFlowState);
  const [config, setConfig] = useState(null);

  // Timezone
  const [selectedTz, setSelectedTz] = useState(DEFAULT_TZ);
  const [showTzDropdown, setShowTzDropdown] = useState(false);
  const [tzSearch, setTzSearch] = useState('');

  // Phone (prefix derived from timezone selector — no separate country picker)
  const [phoneNumber, setPhoneNumber] = useState('');
  const [isInternational, setIsInternational] = useState(false);

  // Onboarding
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [age, setAge] = useState('');
  const [city, setCity] = useState('Cochabamba');
  const [country, setCountry] = useState('Bolivia');
  const [source, setSource] = useState('');

  // Calendar/slots
  const [selectedDate, setSelectedDate] = useState(null);
  const [slots, setSlots] = useState([]);
  const [selectedSlot, setSelectedSlot] = useState(null);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [slotsCache, setSlotsCache] = useState(new Map());
  const [prefetchDone, setPrefetchDone] = useState(false);

  // Derive phone prefix from timezone selection (unified — no second country picker)
  const countryCode = useMemo(() => {
    const tzCode = TZ_TO_PHONE_CODE[selectedTz?.tz];
    if (tzCode) return '+' + tzCode;
    return '+591'; // default Bolivia
  }, [selectedTz]);
  const currentCountry = COUNTRY_CODES.find(c => c.code === countryCode) || COUNTRY_CODES[0];
  const phoneDigits = phoneNumber.replace(/\D/g, '');
  const expectedDigits = currentCountry.digits;
  const phoneComplete = phoneDigits.length === expectedDigits;

  // Load config
  useEffect(() => { api.get('/config/public').then(setConfig).catch(() => {}); }, []);

  // Auto-detect timezone by IP (country code derived from timezone selector)
  useEffect(() => {
    fetch('https://ipapi.co/json/')
      .then(r => r.json())
      .then(data => {
        const detectedTz = detectTimezoneFromIP(data);
        if (detectedTz) setSelectedTz(detectedTz);
      })
      .catch(() => {});
  }, []);

  // Pre-fetch 7 weekdays of slots
  useEffect(() => {
    if (!config) return;
    const today = new Date();
    const dates = [];
    const d = new Date(today);
    while (dates.length < 7) {
      dates.push(d.toISOString().split('T')[0]);
      // Advance to next weekday (Mon-Fri)
      do { d.setDate(d.getDate() + 1); } while (d.getDay() === 0 || d.getDay() === 6);
    }
    Promise.all(
      dates.map(date =>
        api.get(`/slots?date=${date}`)
          .then(data => ({ date, slots: data.slots || [] }))
          .catch(() => ({ date, slots: [] }))
      )
    ).then(results => {
      const cache = new Map();
      results.forEach(r => cache.set(r.date, r.slots));
      setSlotsCache(cache);
      setPrefetchDone(true);
      setSelectedDate(dates[0]);
      setSlots(cache.get(dates[0]) || []);
    });
  }, [config]);

  useEffect(() => { setIsInternational(countryCode !== '+591'); }, [countryCode]);

  useEffect(() => {
    if (!showTzDropdown) return;
    const handler = () => setShowTzDropdown(false);
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, [showTzDropdown]);

  const daysWithSlots = useMemo(() => {
    const set = new Set();
    for (const [date, dateSlots] of slotsCache) {
      if (dateSlots.length > 0) set.add(date);
    }
    return set;
  }, [slotsCache]);

  const fetchSlots = useCallback(async (date) => {
    setSlotsLoading(true);
    setSelectedSlot(null);
    try {
      if (slotsCache.has(date)) { setSlots(slotsCache.get(date)); return; }
      const data = await api.get(`/slots?date=${date}`);
      const fetchedSlots = data.slots || [];
      setSlots(fetchedSlots);
      setSlotsCache(prev => new Map(prev).set(date, fetchedSlots));
    } catch { setSlots([]); }
    finally { setSlotsLoading(false); }
  }, [slotsCache]);

  function handleDateSelect(date) { setSelectedDate(date); fetchSlots(date); }

  function displayTime(time) {
    if (!selectedDate || !selectedTz) return time;
    return convertLaPazTimeToTz(time, selectedDate, selectedTz.tz);
  }

  // API calls
  async function handlePhoneSubmit() {
    dispatch({ type: 'PHONE_CHECK_START' });
    try {
      const phone = countryCode.replace('+', '') + phoneDigits;
      const body = { phone, date_time: `${selectedDate}T${selectedSlot}` };
      if (urlCode) body.code = urlCode;
      const data = await api.post('/book', body);
      if (data.status === 'needs_onboarding') dispatch({ type: 'PHONE_NEW' });
      else if (data.status === 'booked') dispatch({ type: 'BOOK_SUCCESS', appointment: { date: selectedDate, time: selectedSlot }, clientName: data.client_name });
      else if (data.status === 'has_appointment') dispatch({ type: 'PHONE_HAS_APPOINTMENT', appointment: data.appointment, clientId: data.client_id, clientName: data.client_name });
    } catch (err) { dispatch({ type: 'PHONE_ERROR', error: err.message }); }
  }

  async function handleBook(onboarding = null) {
    dispatch({ type: 'BOOK_START' });
    try {
      const phone = countryCode.replace('+', '') + phoneDigits;
      const body = { phone, date_time: `${selectedDate}T${selectedSlot}` };
      if (onboarding) body.onboarding = onboarding;
      if (urlCode) body.code = urlCode;
      const data = await api.post('/book', body);
      if (data.status === 'needs_onboarding') dispatch({ type: 'BOOK_NEEDS_ONBOARDING' });
      else if (data.status === 'has_appointment') dispatch({ type: 'BOOK_HAS_APPOINTMENT', appointment: data.appointment, clientId: data.client_id, clientName: data.client_name });
      else if (data.status === 'booked') dispatch({ type: 'BOOK_SUCCESS', appointment: { date: selectedDate, time: selectedSlot }, clientName: onboarding?.first_name || flow.clientName });
    } catch (err) { dispatch({ type: 'BOOK_ERROR', error: err.message }); }
  }

  async function handleReschedule() {
    dispatch({ type: 'RESCHEDULE_START' });
    try {
      const appt = flow.oldAppointment || flow.activeAppointment;
      if (!appt) throw new Error('No se encontró la cita original');
      await api.post('/reschedule', { client_id: flow.clientId, old_appointment_id: appt.id, date_time: `${selectedDate}T${selectedSlot}` });
      dispatch({ type: 'RESCHEDULE_SUCCESS', appointment: { date: selectedDate, time: selectedSlot } });
    } catch (err) { dispatch({ type: 'RESCHEDULE_ERROR', error: err.message }); }
  }

  // ─── Timezone Selector ──────────────────────────────────────────
  function TimezoneSelector() {
    const filtered = tzSearch.trim()
      ? TIMEZONE_GROUPS.map(g => ({ ...g, zones: g.zones.filter(z => z.label.toLowerCase().includes(tzSearch.toLowerCase())) })).filter(g => g.zones.length > 0)
      : TIMEZONE_GROUPS;
    return (
      <div style={{ width: '100%', marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'center' }}>
          <button type="button" className="timezone-selector" onClick={e => { e.stopPropagation(); setShowTzDropdown(!showTzDropdown); }}>
            <span>{selectedTz.flag} {selectedTz.label} ({getCurrentTimeInTz(selectedTz.tz)})</span>
            <ChevronDown size={12} />
          </button>
        </div>
        <p style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5, fontSize: 16, fontWeight: 600, color: '#B34E35', textAlign: 'center', marginTop: 6 }}>
          <MousePointerClick size={15} color="#B34E35" />
          Confirma tu país
        </p>
        {showTzDropdown && (
          <div className="timezone-dropdown" onClick={e => e.stopPropagation()}>
            <div style={{ position: 'relative' }}>
              <Search size={14} color="var(--gris-medio)" style={{ position: 'absolute', left: 14, top: 14 }} />
              <input className="timezone-search" style={{ paddingLeft: 36 }} placeholder="Buscar país..." value={tzSearch} onChange={e => setTzSearch(e.target.value)} autoFocus />
            </div>
            <div className="timezone-list">
              {filtered.map(group => (
                <div key={group.label}>
                  <div className="timezone-group-label">{group.label}</div>
                  {group.zones.map(z => (
                    <div key={z.tz + z.label} className={`timezone-item ${selectedTz.tz === z.tz && selectedTz.label === z.label ? 'active' : ''}`}
                      onClick={() => { setSelectedTz(z); setShowTzDropdown(false); setTzSearch(''); }}>
                      <span>{z.flag}</span>
                      <span style={{ flex: 1 }}>{z.label}</span>
                      <span style={{ color: 'var(--gris-medio)', fontSize: 14 }}>{getCurrentTimeInTz(z.tz)}</span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  // ═══════════════════════════════════════════════════════════════
  // SCREEN 1: Calendar + Slots
  // ═══════════════════════════════════════════════════════════════
  if (flow.screen === 1) {
    const morningSlots = slots.filter(s => s.block === 'morning');
    const afternoonSlots = slots.filter(s => s.block === 'afternoon');

    function handleSlotClick(time) {
      setSelectedSlot(time);
      dispatch({ type: 'PICK_SLOT' });
    }

    return (
      <Layout devMode={devMode}>
        <Logo width={120} />
        <h1 style={{ fontSize: 30, fontWeight: 600, textAlign: 'center', color: 'var(--negro)', marginBottom: 16, lineHeight: 1.15 }}>
          {flow.rescheduleMode ? 'Elige tu nueva hora' : 'Encuentra el mejor momento para tu sesión'}
        </h1>
        {flow.rescheduleMode && (
          <p style={{ fontSize: 18, fontWeight: 600, color: 'var(--gris-medio)', textAlign: 'center', marginBottom: 12 }}>
            Selecciona una fecha y hora para reagendar
          </p>
        )}

        <div className="card" style={{ marginBottom: 16 }}>
          <Calendar
            onSelectDate={handleDateSelect} selectedDate={selectedDate}
            availableDays={config?.available_days || []} windowDays={config?.window_days || 10}
            daysWithSlots={daysWithSlots}
          />
        </div>

        {selectedDate && (
          <div className="card">
            <TimezoneSelector />
            <h2 style={{ fontSize: 19, fontWeight: 600, color: 'var(--negro)', marginBottom: 16 }}>
              {formatDateES(selectedDate)}
            </h2>

            {(slotsLoading || (!prefetchDone && slots.length === 0)) ? (
              <p style={{ textAlign: 'center', color: 'var(--gris-medio)', padding: '24px 0', fontSize: 18 }}>Consultando disponibilidad...</p>
            ) : slots.length === 0 ? (
              <p style={{ textAlign: 'center', color: 'var(--gris-medio)', padding: '24px 0', fontSize: 18 }}>No hay horarios disponibles este día</p>
            ) : (
              <>
                {morningSlots.length > 0 && (
                  <div style={{ marginBottom: afternoonSlots.length > 0 ? 18 : 16 }}>
                    <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 10 }}>
                      <Sun size={22} color="#1B2B43" />
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
                      {morningSlots.map(s => (
                        <button key={s.time} type="button" onClick={() => handleSlotClick(s.time)} className="slot-btn">
                          {displayTime(s.time)}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {afternoonSlots.length > 0 && (
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 10 }}>
                      <Sunset size={22} color="#1B2B43" />
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
                      {afternoonSlots.map(s => (
                        <button key={s.time} type="button" onClick={() => handleSlotClick(s.time)} className="slot-btn">
                          {displayTime(s.time)}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}
        <ProgressDots current={1} />
      </Layout>
    );
  }

  // ═══════════════════════════════════════════════════════════════
  // SCREEN 2: Phone Input
  // ═══════════════════════════════════════════════════════════════
  if (flow.screen === 2) {
    return (
      <Layout devMode={devMode}>
        <Logo width={90} />
        <div className="summary-card">
          <div className="summary-card-icon"><CalendarIcon size={20} color="white" /></div>
          <div>
            <div className="summary-card-text">{formatDateES(selectedDate)}</div>
            <div className="summary-card-sub">{displayTime(selectedSlot)} hs</div>
          </div>
        </div>
        <h1 style={{ fontSize: 30, fontWeight: 600, textAlign: 'center', color: 'var(--negro)', marginBottom: 20 }}>Ingresa tu número de WhatsApp</h1>
        <div className="card">
          <form onSubmit={e => { e.preventDefault(); if (phoneComplete) handlePhoneSubmit(); }}>
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 16 }}>
              <div style={{ width: 48, height: 48, borderRadius: '50%', background: '#CFE8E9', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <span style={{ fontSize: 22, fontWeight: 700, color: '#4E769B', lineHeight: 1 }}>#</span>
              </div>
            </div>
            <div className="phone-unified-field">
              <span style={{
                fontWeight: 600, fontSize: 24,
                color: '#A4A4A6', letterSpacing: '0.1em',
                userSelect: 'none', whiteSpace: 'nowrap', flexShrink: 0,
              }}>
                {countryCode}
              </span>
              <input type="tel" value={phoneNumber}
                onChange={e => { const val = e.target.value.replace(/\D/g, ''); if (val.length <= expectedDigits) setPhoneNumber(val); }}
                placeholder="71234567" className="phone-unified-input" autoFocus maxLength={expectedDigits} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, marginTop: 6 }}>
              <span style={{ fontSize: 17, color: 'var(--gris-medio)' }}>{currentCountry.name}</span>
              <span className="phone-digit-hint" style={{ fontSize: 17, color: phoneComplete ? 'var(--turquesa)' : phoneDigits.length > 0 ? 'var(--gris-medio)' : 'transparent' }}>
                {phoneDigits.length}/{expectedDigits} dígitos
              </span>
            </div>
            {flow.error && <p style={{ color: 'var(--terracota)', fontSize: 16, marginBottom: 12 }}>{flow.error}</p>}
            <button type="submit" disabled={!phoneComplete || flow.loading} className="btn-primary" style={{ marginBottom: 12 }}>
              {flow.loading ? 'Verificando...' : 'Continuar'}{!flow.loading && <ArrowRight size={18} />}
            </button>
            <button type="button" onClick={() => dispatch({ type: 'GO_BACK', screen: 1 })} className="btn-secondary">
              <ArrowLeft size={18} />Elegir otra hora
            </button>
          </form>
        </div>
        <ProgressDots current={2} />
      </Layout>
    );
  }

  // ═══════════════════════════════════════════════════════════════
  // SCREEN 3: Confirmation + Onboarding
  // ═══════════════════════════════════════════════════════════════
  if (flow.screen === 3) {
    const minAge = config?.min_age || 23;
    const maxAge = config?.max_age || 75;
    const ageNum = Number(age);
    const ageOutOfRange = age !== '' && (ageNum < minAge || ageNum > maxAge);

    function handleConfirm() {
      if (flow.showOnboarding) {
        handleBook({ first_name: firstName, last_name: lastName, age: ageNum, city: isInternational ? 'Otro' : city, country: isInternational ? country : 'Bolivia', source });
      } else {
        handleBook();
      }
    }

    return (
      <Layout devMode={devMode}>
        <Logo width={90} />
        <h1 style={{ fontSize: 26, fontWeight: 600, textAlign: 'center', color: 'var(--negro)', marginBottom: 12, lineHeight: 1.2 }}>
          {flow.showOnboarding ? '¡Hola! Para darte un mejor servicio, déjanos hacerte unas preguntas.' : flow.isReturning ? `${flow.clientName}, qué bueno verte de nuevo` : 'Confirma tu sesión'}
        </h1>
        {flow.showOnboarding && (
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 16 }}>
            <div style={{ width: 48, height: 48, borderRadius: '50%', background: '#CFE8E9', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <SmilePlus size={22} color="#4E769B" />
            </div>
          </div>
        )}
        {!flow.showOnboarding && (
          <p style={{ fontSize: 18, color: flow.isReturning ? 'var(--turquesa)' : 'var(--terracota)', textAlign: 'center', marginBottom: 24 }}>
            Revisa los detalles antes de confirmar
          </p>
        )}
        <div className="card" style={{ marginBottom: 20 }}>
          <div className="detail-row" style={{ paddingTop: 0 }}>
            <div className="detail-icon"><CalendarIcon size={18} color="var(--gris-medio)" /></div>
            <div><div className="detail-label">Fecha</div><div className="detail-value">{formatDateES(selectedDate)}</div></div>
          </div>
          <div className="detail-row" style={{ paddingBottom: flow.showOnboarding ? 16 : 0 }}>
            <div className="detail-icon"><Clock size={18} color="var(--gris-medio)" /></div>
            <div>
              <div className="detail-label">Hora</div><div className="detail-value">{displayTime(selectedSlot)} hs</div>
              {selectedTz.tz !== 'America/La_Paz' && <div style={{ fontSize: 14, color: 'var(--gris-medio)', marginTop: 2 }}>Zona: {selectedTz.flag} {selectedTz.label}</div>}
            </div>
          </div>
          <div className={`onboarding-slide ${flow.showOnboarding ? 'open' : ''}`}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, marginBottom: 16 }}>
              <Info size={12} color="var(--terracota)" />
              <span style={{ fontSize: 16, color: 'var(--terracota)' }}>Todos los campos son obligatorios</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div><span className="field-label">NOMBRE <span style={{color:'#B34E35'}}>*</span></span><input value={firstName} onChange={e => setFirstName(e.target.value)} className="input-field" placeholder="Un solo nombre" /></div>
              <div><span className="field-label">APELLIDO <span style={{color:'#B34E35'}}>*</span></span><input value={lastName} onChange={e => setLastName(e.target.value)} className="input-field" placeholder="Un solo apellido" /></div>
              <div>
                <span className="field-label">EDAD <span style={{color:'#B34E35'}}>*</span></span>
                <input type="number" value={age} onChange={e => setAge(e.target.value)} min={minAge} max={maxAge} className="input-field" style={{ width: 120 }} placeholder={`${minAge}`} />
                {ageOutOfRange
                  ? <p style={{ fontSize: 16, color: 'var(--terracota)', marginTop: 6, fontWeight: 600 }}>Solo atiendo pacientes entre {minAge} y {maxAge} años</p>
                  : <p style={{ fontSize: 14, color: 'var(--gris-medio)', marginTop: 6 }}>Entre {minAge} y {maxAge} años</p>}
              </div>
              {isInternational ? (
                <div><span className="field-label">PAÍS <span style={{color:'#B34E35'}}>*</span></span><input value={country} onChange={e => setCountry(e.target.value)} className="input-field" placeholder="Tu país" /></div>
              ) : (
                <div>
                  <span className="field-label">CIUDAD <span style={{color:'#B34E35'}}>*</span></span>
                  <div style={{ position: 'relative' }}>
                    <select value={city} onChange={e => setCity(e.target.value)} className="input-field" style={{ appearance: 'none', paddingRight: 40 }}>
                      {CITIES.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                    <ChevronDown size={16} color="var(--gris-medio)" style={{ position: 'absolute', right: 14, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }} />
                  </div>
                </div>
              )}
              <div>
                <span className="field-label" style={{ marginBottom: 10 }}>¿CÓMO SUPISTE DE DANIEL? <span style={{color:'#B34E35'}}>*</span></span>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {SOURCES.map(s => (
                    <label key={s} className="radio-option">
                      <div className={`radio-circle ${source === s ? 'active' : ''}`}>{source === s && <div className="radio-circle-inner" />}</div>
                      <span style={{ fontSize: 18, fontWeight: 500 }}>{s}</span>
                      <input type="radio" name="source" value={s} checked={source === s} onChange={e => setSource(e.target.value)} style={{ position: 'absolute', opacity: 0, pointerEvents: 'none' }} />
                    </label>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
        {flow.error && <p style={{ color: 'var(--terracota)', fontSize: 16, textAlign: 'center', marginBottom: 12 }}>{flow.error}</p>}
        <button type="button" onClick={handleConfirm} disabled={flow.loading || (flow.showOnboarding && (!firstName || !lastName || !age || !source || ageOutOfRange))} className="btn-primary" style={{ marginBottom: 12 }}>
          <Check size={18} />{flow.loading ? 'Confirmando...' : 'Confirmar cita'}
        </button>
        <button type="button" onClick={() => dispatch({ type: 'GO_BACK', screen: 2 })} className="btn-secondary"><ArrowLeft size={18} />Volver</button>
        <ProgressDots current={3} />
      </Layout>
    );
  }

  // ═══════════════════════════════════════════════════════════════
  // SCREEN 5: Success
  // ═══════════════════════════════════════════════════════════════
  if (flow.screen === 5) {
    const displayName = flow.clientName || firstName || '';
    return (
      <Layout devMode={devMode}>
        <Logo width={90} />
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 20 }}>
          <div className="animate-checkmark" style={{ width: 72, height: 72, borderRadius: '50%', background: 'var(--cian-light)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Check size={32} color="var(--petroleo)" />
          </div>
        </div>
        <h1 style={{ fontSize: 28, fontWeight: 600, textAlign: 'center', color: 'var(--negro)', marginBottom: 6 }}>
          {flow.wasRescheduled
            ? (displayName ? `Perfecto ${displayName}, tu cita ha sido reagendada` : 'Tu cita ha sido reagendada')
            : (displayName ? `${displayName}, tu cita está confirmada` : 'Tu cita está confirmada')}
        </h1>
        <p style={{ fontSize: 22, fontWeight: 600, color: 'var(--turquesa)', textAlign: 'center', marginBottom: 24, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
          <Heart size={20} color="var(--turquesa)" fill="var(--turquesa)" strokeWidth={2.5} /> Gracias por tu confianza
        </p>
        {flow.bookedAppointment && (
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="detail-row" style={{ paddingTop: 0 }}>
              <div className="detail-icon"><CalendarIcon size={18} color="var(--gris-medio)" /></div>
              <div><div className="detail-label">Fecha</div><div className="detail-value">{formatDateES(flow.bookedAppointment.date)}</div></div>
            </div>
            <div className="detail-row" style={{ paddingBottom: 0 }}>
              <div className="detail-icon"><Clock size={18} color="var(--gris-medio)" /></div>
              <div><div className="detail-label">Hora</div><div className="detail-value">{displayTime(flow.bookedAppointment.time)} hs</div></div>
            </div>
          </div>
        )}
        <div className="notice-box" style={{ marginBottom: 24 }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
            <MessageSquareHeart size={22} color="#1A1A17" />
            <p style={{ fontSize: 17, fontWeight: 500, color: 'var(--grafito)', lineHeight: 1.5, textAlign: 'center', margin: 0 }}>Te llegará un recordatorio el día antes de tu cita.</p>
          </div>
          <div style={{ borderTop: '1px solid rgba(0,0,0,0.06)', marginTop: 12, paddingTop: 12 }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
              <ShieldAlert size={22} color="#1A1A17" />
              <p style={{ fontSize: 17, fontWeight: 500, color: 'var(--grafito)', lineHeight: 1.5, textAlign: 'center', margin: 0 }}>
                Toda cancelación o cambio debe realizarse con mínimo <strong>6 horas</strong> de anticipación, caso contrario, se cobrará el <strong>50%</strong> del monto de la sesión.
              </p>
            </div>
          </div>
        </div>
        <ProgressDots current={4} done={true} />
      </Layout>
    );
  }

  // ═══════════════════════════════════════════════════════════════
  // SCREEN 6: Already Has Appointment
  // ═══════════════════════════════════════════════════════════════
  if (flow.screen === 6 && flow.activeAppointment) {
    const apptDT = flow.activeAppointment.date_time || '';
    const apptDateObj = new Date(apptDT);
    const apptDate = apptDT ? apptDateObj.toLocaleDateString('sv-SE', { timeZone: 'America/La_Paz' }) : '';
    const apptTime = apptDT ? apptDateObj.toLocaleTimeString('es-BO', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/La_Paz' }) : '';

    return (
      <Layout devMode={devMode}>
        <Logo width={90} />
        <h1 style={{ fontSize: 26, fontWeight: 600, textAlign: 'center', color: 'var(--negro)', marginBottom: 6 }}>
          {flow.clientName ? `${flow.clientName}, ya tienes una cita` : 'Ya tienes una cita'}
        </h1>
        <p style={{ fontSize: 18, color: 'var(--gris-medio)', textAlign: 'center', marginBottom: 20 }}>Tu cita actual es:</p>
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="detail-row" style={{ paddingTop: 0, borderTop: 'none' }}>
            <div className="detail-icon"><CalendarIcon size={18} color="var(--gris-medio)" /></div>
            <div>
              <div className="detail-label" style={{ fontSize: 16, color: '#737375' }}>Cita actual</div>
              <div className="detail-value">{formatDateES(apptDate)}</div>
              <div style={{ fontSize: 20, fontWeight: 600, color: 'var(--azul-acero)', marginTop: 2 }}>{apptTime} hs</div>
            </div>
          </div>
        </div>
        <p style={{ fontSize: 18, color: 'var(--gris-medio)', textAlign: 'center', marginBottom: 12 }}>Acabas de elegir:</p>
        <div className="card" style={{ marginBottom: 24, border: '1.5px solid var(--azul-acero)', background: '#FDF0AD' }}>
          <div className="detail-row" style={{ paddingTop: 0, borderTop: 'none' }}>
            <div className="detail-icon" style={{ background: 'var(--cian-light)' }}><CalendarClock size={18} color="var(--petroleo)" /></div>
            <div>
              <div className="detail-label" style={{ fontSize: 16, color: '#737375' }}>Nueva fecha</div>
              <div className="detail-value">{formatDateES(selectedDate)}</div>
              <div style={{ fontSize: 20, fontWeight: 600, color: 'var(--petroleo)', marginTop: 2 }}>{displayTime(selectedSlot)} hs</div>
            </div>
          </div>
        </div>
        <p style={{ fontSize: 22, fontWeight: 500, textAlign: 'center', color: 'var(--negro)', marginBottom: 16 }}>¿Qué deseas hacer?</p>
        {flow.error && <p style={{ color: 'var(--terracota)', fontSize: 16, textAlign: 'center', marginBottom: 12 }}>{flow.error}</p>}
        <button type="button" onClick={handleReschedule} disabled={flow.loading} className="btn-primary" style={{ marginBottom: 12 }}>
          <RefreshCw size={18} />{flow.loading ? 'Reagendando...' : 'Cambiar a esta hora'}
        </button>
        <button type="button" onClick={() => dispatch({ type: 'KEEP_APPOINTMENT', appointment: { date: apptDate, time: apptTime } })} className="btn-secondary">
          <CalendarCheck size={18} />Conservar mi cita actual
        </button>
      </Layout>
    );
  }

  // ═══════════════════════════════════════════════════════════════
  // SCREEN 7: Confirm Reschedule
  // ═══════════════════════════════════════════════════════════════
  if (flow.screen === 7) {
    const appt = flow.oldAppointment || flow.activeAppointment;
    if (!appt) {
      return (
        <Layout devMode={devMode}>
          <Logo width={90} />
          <p style={{ textAlign: 'center', color: 'var(--terracota)', paddingTop: 48, fontSize: 18 }}>No se encontró la cita. Por favor intenta de nuevo.</p>
          <button type="button" onClick={() => dispatch({ type: 'GO_BACK', screen: 1 })} className="btn-primary" style={{ marginTop: 16 }}>Volver al calendario</button>
        </Layout>
      );
    }
    const apptDT = appt.date_time || '';
    const apptDateObj = new Date(apptDT);
    const apptDate = apptDT ? apptDateObj.toLocaleDateString('sv-SE', { timeZone: 'America/La_Paz' }) : '';
    const apptTime = apptDT ? apptDateObj.toLocaleTimeString('es-BO', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/La_Paz' }) : '';

    return (
      <Layout devMode={devMode}>
        <Logo width={90} />
        <h1 style={{ fontSize: 28, fontWeight: 600, textAlign: 'center', color: 'var(--negro)', marginBottom: 6 }}>Confirmar reagendamiento</h1>
        <p style={{ fontSize: 18, color: 'var(--gris-medio)', textAlign: 'center', marginBottom: 20 }}>Tu cita será movida a la nueva fecha</p>
        <div className="card" style={{ marginBottom: 20 }}>
          <div style={{ marginBottom: 12 }}>
            <span style={{ fontSize: 15, fontWeight: 500, textTransform: 'uppercase', letterSpacing: 1.5, color: 'var(--gris-medio)' }}>Cita actual</span>
            <p style={{ fontSize: 18, color: 'var(--gris-claro)', textDecoration: 'line-through', marginTop: 4 }}>{formatDateES(apptDate)} &middot; {apptTime} hs</p>
          </div>
          <div style={{ borderTop: '1px solid var(--platino)', paddingTop: 12 }}>
            <span style={{ fontSize: 15, fontWeight: 500, textTransform: 'uppercase', letterSpacing: 1.5, color: 'var(--petroleo)' }}>Nueva cita</span>
            <p style={{ fontSize: 20, fontWeight: 600, color: 'var(--negro)', marginTop: 4 }}>{formatDateES(selectedDate)} &middot; {displayTime(selectedSlot)} hs</p>
          </div>
        </div>
        {flow.error && <p style={{ color: 'var(--terracota)', fontSize: 16, textAlign: 'center', marginBottom: 12 }}>{flow.error}</p>}
        <button type="button" onClick={handleReschedule} disabled={flow.loading} className="btn-primary" style={{ marginBottom: 12 }}>
          <RefreshCw size={18} />{flow.loading ? 'Reagendando...' : 'Confirmar reagendamiento'}
        </button>
        <button type="button" onClick={() => dispatch({ type: 'GO_BACK', screen: 1 })} className="btn-secondary"><ArrowLeft size={18} />Elegir otra hora</button>
      </Layout>
    );
  }

  return (
    <Layout devMode={devMode}>
      <p style={{ textAlign: 'center', color: 'var(--gris-medio)', paddingTop: 48, fontSize: 18 }}>Cargando...</p>
    </Layout>
  );
}
