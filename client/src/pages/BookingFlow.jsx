import { useState, useEffect, useCallback, useMemo, useReducer } from 'react';
import Calendar from '../components/Calendar';
import { api } from '../utils/api';
import {
  TIMEZONE_GROUPS, DEFAULT_TZ, convertLaPazTimeToTz, getCurrentTimeInTz, detectTimezoneFromIP, getTimezoneCountry,
} from '../utils/timezones';
import {
  ArrowRight, ArrowLeft, ChevronDown, Calendar as CalendarIcon,
  Clock, CalendarClock, CalendarCheck, Check, Sun, Sunset,
  Coffee, Globe, Search, RefreshCw, Heart, MessageSquareHeart, ShieldAlert, Info, Smartphone, SmilePlus,
  CalendarArrowUp, CircleArrowRight, CircleCheck, Clock4,
} from 'lucide-react';

const COUNTRY_CODES = [
  { code: '+591', flag: '\u{1F1E7}\u{1F1F4}', name: 'Bolivia', minDigits: 8, maxDigits: 8 },
  { code: '+54', flag: '\u{1F1E6}\u{1F1F7}', name: 'Argentina', minDigits: 10, maxDigits: 11 },
  { code: '+56', flag: '\u{1F1E8}\u{1F1F1}', name: 'Chile', minDigits: 9, maxDigits: 9 },
  { code: '+57', flag: '\u{1F1E8}\u{1F1F4}', name: 'Colombia', minDigits: 10, maxDigits: 10 },
  { code: '+51', flag: '\u{1F1F5}\u{1F1EA}', name: 'Perú', minDigits: 9, maxDigits: 9 },
  { code: '+593', flag: '\u{1F1EA}\u{1F1E8}', name: 'Ecuador', minDigits: 9, maxDigits: 9 },
  { code: '+52', flag: '\u{1F1F2}\u{1F1FD}', name: 'México', minDigits: 10, maxDigits: 10 },
  { code: '+34', flag: '\u{1F1EA}\u{1F1F8}', name: 'España', minDigits: 9, maxDigits: 9 },
  { code: '+1', flag: '\u{1F1FA}\u{1F1F8}', name: 'USA', minDigits: 10, maxDigits: 10 },
  { code: '+55', flag: '\u{1F1E7}\u{1F1F7}', name: 'Brasil', minDigits: 10, maxDigits: 11 },
  { code: '+595', flag: '\u{1F1F5}\u{1F1FE}', name: 'Paraguay', minDigits: 9, maxDigits: 9 },
  { code: '+598', flag: '\u{1F1FA}\u{1F1FE}', name: 'Uruguay', minDigits: 8, maxDigits: 8 },
  { code: '+58', flag: '\u{1F1FB}\u{1F1EA}', name: 'Venezuela', minDigits: 10, maxDigits: 10 },
  { code: '+33', flag: '\u{1F1EB}\u{1F1F7}', name: 'Francia', minDigits: 9, maxDigits: 9 },
  { code: '+49', flag: '\u{1F1E9}\u{1F1EA}', name: 'Alemania', minDigits: 10, maxDigits: 11 },
  { code: '+39', flag: '\u{1F1EE}\u{1F1F9}', name: 'Italia', minDigits: 9, maxDigits: 10 },
  { code: '+44', flag: '\u{1F1EC}\u{1F1E7}', name: 'Reino Unido', minDigits: 10, maxDigits: 10 },
];

const CITIES = ['Cochabamba', 'Santa Cruz', 'La Paz', 'Sucre', 'Otro'];
const SOURCES = ['Referencia de amigos', 'Redes sociales', 'Otro'];
const DAY_NAMES_ES = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const MONTH_NAMES_ES = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
const PHONE_PREFIX_OPTIONS = COUNTRY_CODES
  .map((country) => ({ ...country, digitsOnly: country.code.replace(/\D/g, '') }))
  .sort((a, b) => b.digitsOnly.length - a.digitsOnly.length);

function formatDateES(dateStr) {
  const d = new Date(dateStr + 'T12:00:00');
  const day = DAY_NAMES_ES[d.getDay()];
  const num = d.getDate();
  const month = MONTH_NAMES_ES[d.getMonth()];
  const year = d.getFullYear();
  return `${day.charAt(0).toUpperCase() + day.slice(1)}, ${num} de ${month} de ${year}`;
}

function formatShortDateES(dateStr) {
  const d = new Date(dateStr + 'T12:00:00');
  const num = d.getDate();
  const month = MONTH_NAMES_ES[d.getMonth()];
  const year = d.getFullYear();
  return `${num} ${month.charAt(0).toUpperCase() + month.slice(1, 3)} ${year}`;
}

function parsePrefilledPhone(rawValue) {
  const digits = String(rawValue || '').replace(/\D/g, '');
  if (!digits) return null;

  for (const option of PHONE_PREFIX_OPTIONS) {
    if (!digits.startsWith(option.digitsOnly)) continue;
    const localDigits = digits.slice(option.digitsOnly.length);
    if (localDigits.length >= option.minDigits && localDigits.length <= option.maxDigits) {
      return {
        localDigits,
        phoneCode: option.code,
      };
    }
  }

  return {
    localDigits: digits,
    phoneCode: null,
  };
}

function getDeviceType() {
  if (typeof navigator === 'undefined') return 'desktop';

  const uaData = navigator.userAgentData;
  const userAgent = navigator.userAgent || '';
  const platform = uaData?.platform || navigator.platform || '';
  const deviceText = `${platform} ${userAgent}`;

  if (uaData?.mobile) return 'mobile';
  if (/iPad|Tablet|PlayBook|Silk|Kindle|Android(?!.*Mobile)/i.test(deviceText)) return 'tablet';
  if (/Mobi|iPhone|iPod|Android.*Mobile|Windows Phone/i.test(deviceText)) return 'mobile';
  return 'desktop';
}

function getUserAgentString() {
  if (typeof navigator === 'undefined') return '';
  return navigator.userAgent || '';
}

function Logo({ width = 90 }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'center' }} className={width >= 120 ? 'logo' : 'logo-small'}>
      <img src="/logo.svg" alt="Daniel MacLean" style={{ width, height: 'auto' }} />
    </div>
  );
}

function DateTimePill({ date, timeLabel, timezoneLabel }) {
  if (!date || !timeLabel) return null;

  return (
    <div style={{ paddingTop: 4, paddingBottom: 18 }}>
      <div className="booking-datetime-pill">
        <div className="booking-datetime-pill-section">
          <CalendarIcon size={23} color="#4E6275" strokeWidth={1.95} />
          <span className="booking-datetime-pill-text">{formatShortDateES(date)}</span>
        </div>
        <div className="booking-datetime-pill-divider" />
        <div className="booking-datetime-pill-section">
          <Clock size={23} color="#4E6275" strokeWidth={1.95} />
          <span className="booking-datetime-pill-text">{timeLabel} hs</span>
        </div>
      </div>
      {timezoneLabel && (
        <div className="booking-datetime-pill-note">
          Zona: {timezoneLabel}
        </div>
      )}
    </div>
  );
}

function ProgressDots({ current, total = 4, done = false }) {
  return (
    <div className="progress-dots">
      {Array.from({ length: total }, (_, i) => (
        <div
          key={i}
          className={`progress-dot ${i + 1 === current ? 'active' : ''} ${done && i + 1 === total ? 'done' : ''}`}
        />
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
  rescheduleToken: '',
  bookedAppointment: null,
};

function flowReducer(state, action) {
  switch (action.type) {
    case 'PICK_SLOT':
      return { ...state, screen: state.rescheduleMode ? 7 : 2, error: '' };
    case 'PHONE_CHECK_START':
      return { ...state, loading: true, error: '' };
    case 'PHONE_HAS_APPOINTMENT':
      return {
        ...state,
        loading: false,
        screen: 6,
        activeAppointment: action.appointment,
        clientId: action.clientId,
        clientName: action.clientName,
        rescheduleToken: action.rescheduleToken || '',
      };
    case 'PHONE_RETURNING':
      return { ...state, loading: false, screen: 3, isReturning: true, clientName: action.clientName, clientId: action.clientId, rescheduleToken: '' };
    case 'PHONE_NEW':
      return { ...state, loading: false, screen: 3, showOnboarding: true, rescheduleToken: '' };
    case 'PHONE_ERROR':
      return { ...state, loading: false, error: action.error };
    case 'BOOK_START':
      return { ...state, loading: true, error: '' };
    case 'BOOK_SUCCESS':
      return { ...state, loading: false, screen: 5, bookedAppointment: action.appointment, clientName: action.clientName || state.clientName, rescheduleToken: '' };
    case 'BOOK_NEEDS_ONBOARDING':
      return { ...state, loading: false, showOnboarding: true };
    case 'BOOK_HAS_APPOINTMENT':
      return {
        ...state,
        loading: false,
        screen: 6,
        activeAppointment: action.appointment,
        clientId: action.clientId,
        clientName: action.clientName || state.clientName,
        rescheduleToken: action.rescheduleToken || state.rescheduleToken,
      };
    case 'BOOK_ERROR':
      return { ...state, loading: false, error: action.error };
    case 'ENTER_RESCHEDULE':
      return { ...state, screen: 1, rescheduleMode: true, oldAppointment: action.oldAppointment, error: '' };
    case 'RESCHEDULE_START':
      return { ...state, loading: true, error: '' };
    case 'RESCHEDULE_SUCCESS':
      return {
        ...state,
        loading: false,
        screen: 5,
        wasRescheduled: true,
        bookedAppointment: action.appointment,
        rescheduleMode: false,
        oldAppointment: null,
        activeAppointment: null,
        rescheduleToken: '',
      };
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
const FORCE_SCREEN1_TIMEZONE_SELECTOR = false;

export default function BookingFlow() {
  const devMode = pageParams.get('devmode') === '1';
  const previewMode = pageParams.get('mock') || '';
  const urlRParam = pageParams.get('r') || '';
  const urlReschedule = !!urlRParam;
  const urlReschedulePhone = urlRParam.replace(/\D/g, '').length >= 8 ? urlRParam : '';
  const urlPhone = pageParams.get('t') || urlReschedulePhone;
  const urlFeeMode = pageParams.get('f') || '';
  const urlCode = pageParams.get('code') || '';
  // Debug hook for QA: devmode keeps the screen-1 timezone confirmation UI visible.
  const forceShowTimezoneSelector = FORCE_SCREEN1_TIMEZONE_SELECTOR || devMode;
  const parsedPrefilledPhone = useMemo(() => parsePrefilledPhone(urlPhone), [urlPhone]);

  const [flow, dispatch] = useReducer(flowReducer, initialFlowState);
  const [config, setConfig] = useState(null);

  // Timezone
  const [selectedTz, setSelectedTz] = useState(DEFAULT_TZ);
  const [showTzDropdown, setShowTzDropdown] = useState(false);
  const [tzSearch, setTzSearch] = useState('');
  const [hasUserSelectedTz, setHasUserSelectedTz] = useState(false);

  // Phone country/prefix
  const [selectedPhoneCountry, setSelectedPhoneCountry] = useState(COUNTRY_CODES[0]);
  const [showPhoneCountryDropdown, setShowPhoneCountryDropdown] = useState(false);
  const [phoneNumber, setPhoneNumber] = useState('');

  // IP context
  const [ipLocation, setIpLocation] = useState(null);

  // Onboarding
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [age, setAge] = useState('');
  const [city, setCity] = useState('Cochabamba');
  const [source, setSource] = useState('');

  // Calendar/slots
  const [selectedDate, setSelectedDate] = useState(null);
  const [slots, setSlots] = useState([]);
  const [selectedSlot, setSelectedSlot] = useState(null);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [slotsCache, setSlotsCache] = useState(new Map());
  const [prefetchDone, setPrefetchDone] = useState(false);

  useEffect(() => {
    if (!devMode || previewMode !== 'onboarding' || selectedDate) return;
    setSelectedDate(pageParams.get('date') || '2026-04-01');
    setSelectedSlot(pageParams.get('time') || '09:00');
    dispatch({ type: 'PHONE_NEW' });
  }, [devMode, previewMode, selectedDate]);

  const locationCountry = useMemo(() => getTimezoneCountry(selectedTz?.tz), [selectedTz?.tz]);
  const countryCode = selectedPhoneCountry.code;
  const phoneDigits = phoneNumber.replace(/\D/g, '');
  const minDigits = selectedPhoneCountry.minDigits;
  const maxDigits = selectedPhoneCountry.maxDigits;
  const phoneComplete = phoneDigits.length >= minDigits && phoneDigits.length <= maxDigits;
  const expectedDigitsLabel = minDigits === maxDigits ? `${maxDigits}` : `${minDigits}-${maxDigits}`;
  const isBoliviaLocation = locationCountry.code === 'BO';
  const isBoliviaPhone = selectedPhoneCountry.code === '+591';
  const isBoliviaFeeFlow = isBoliviaLocation && isBoliviaPhone;
  const showIpCountryWarning = !!ipLocation?.countryCode && ipLocation.countryCode !== 'BO';
  const showScreen1TimezoneConfirmation = forceShowTimezoneSelector || showIpCountryWarning;
  const deviceType = useMemo(() => getDeviceType(), []);
  const userAgent = useMemo(() => getUserAgentString(), []);
  const bookingContext = useMemo(() => ({
    timezone: selectedTz?.tz || DEFAULT_TZ.tz,
    ip_country_code: ipLocation?.countryCode || null,
    ip_country_name: ipLocation?.countryName || null,
    location_country_code: locationCountry.code,
    location_country_name: locationCountry.name,
    location_confirmed_manually: hasUserSelectedTz,
    device_type: deviceType,
    user_agent: userAgent || null,
  }), [
    deviceType,
    hasUserSelectedTz,
    ipLocation?.countryCode,
    ipLocation?.countryName,
    locationCountry.code,
    locationCountry.name,
    selectedTz?.tz,
    userAgent,
  ]);

  // Pre-fill phone from URL param (?t= or ?r=)
  useEffect(() => {
    if (!parsedPrefilledPhone) return;
    if (parsedPrefilledPhone.localDigits) setPhoneNumber(parsedPrefilledPhone.localDigits);
    if (parsedPrefilledPhone.phoneCode) {
      const matchedCountry = COUNTRY_CODES.find(country => country.code === parsedPrefilledPhone.phoneCode);
      if (matchedCountry) setSelectedPhoneCountry(matchedCountry);
    }
  }, [parsedPrefilledPhone]);

  // Load config
  useEffect(() => { api.get('/config/public').then(setConfig).catch(() => {}); }, []);

  // Auto-detect timezone by IP for hour display and retain detected country for booking context.
  useEffect(() => {
    let cancelled = false;

    const runLookup = () => {
      fetch('https://ipapi.co/json/')
        .then(r => r.json())
        .then(data => {
          if (cancelled) return;
          setIpLocation({
            countryCode: String(data?.country_code || '').toUpperCase() || null,
            countryName: data?.country_name || null,
          });
          const detectedTz = detectTimezoneFromIP(data);
          if (detectedTz && !hasUserSelectedTz) setSelectedTz(detectedTz);
        })
        .catch(() => {});
    };

    let idleId = null;
    let timeoutId = null;

    if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
      idleId = window.requestIdleCallback(runLookup, { timeout: 1500 });
    } else {
      timeoutId = window.setTimeout(runLookup, 800);
    }

    return () => {
      cancelled = true;
      if (idleId != null && typeof window !== 'undefined' && 'cancelIdleCallback' in window) {
        window.cancelIdleCallback(idleId);
      }
      if (timeoutId != null) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [hasUserSelectedTz, parsedPrefilledPhone]);

  // Pre-fetch current month's available dates
  const DAY_MAP = { 0: 'domingo', 1: 'lunes', 2: 'martes', 3: 'miercoles', 4: 'jueves', 5: 'viernes', 6: 'sabado' };

  const getDatesForMonth = useCallback((year, month, cfg) => {
    const dates = [];
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const maxDate = new Date(today);
    maxDate.setDate(maxDate.getDate() + (cfg.window_days || 10));
    const availDays = cfg.available_days || [];
    for (let d = 1; d <= daysInMonth; d++) {
      const date = new Date(year, month, d);
      if (date >= today && date <= maxDate && availDays.includes(DAY_MAP[date.getDay()])) {
        dates.push(`${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
      }
    }
    return dates;
  }, []);

  const prefetchDates = useCallback((dates) => {
    const toFetch = dates.filter(d => !slotsCache.has(d));
    if (toFetch.length === 0) return;
    Promise.all(
      toFetch.map(date =>
        api.get(`/slots?date=${date}`)
          .then(data => ({ date, slots: data.slots || [] }))
          .catch(() => ({ date, slots: [] }))
      )
    ).then(results => {
      setSlotsCache(prev => {
        const next = new Map(prev);
        results.forEach(r => next.set(r.date, r.slots));
        return next;
      });
    });
  }, [slotsCache]);

  useEffect(() => {
    if (!config) return;
    const today = new Date();
    const dates = getDatesForMonth(today.getFullYear(), today.getMonth(), config);
    const nextMonth = new Date(today.getFullYear(), today.getMonth() + 1, 1);
    const nextDates = getDatesForMonth(nextMonth.getFullYear(), nextMonth.getMonth(), config);
    const allDates = [...dates, ...nextDates];
    const initialDate = selectedDate || allDates[0];
    if (!initialDate) {
      setPrefetchDone(true);
      return;
    }

    let cancelled = false;
    const initialMonthDates = dates.includes(initialDate) ? dates : nextDates;
    const remainingDates = initialMonthDates.filter(date => date !== initialDate);

    setSelectedDate(prev => prev || initialDate);
    setSlotsLoading(true);

    api.get(`/slots?date=${initialDate}`)
      .then((data) => {
        if (cancelled) return;
        const initialSlots = data.slots || [];
        setSlots(initialSlots);
        setSlotsCache(prev => {
          const next = new Map(prev);
          next.set(initialDate, initialSlots);
          return next;
        });
      })
      .catch(() => {
        if (cancelled) return;
        setSlots([]);
        setSlotsCache(prev => {
          const next = new Map(prev);
          next.set(initialDate, []);
          return next;
        });
      })
      .finally(() => {
        if (cancelled) return;
        setSlotsLoading(false);
        setPrefetchDone(true);
        if (remainingDates.length > 0) {
          Promise.all(
            remainingDates.map(date =>
              api.get(`/slots?date=${date}`)
                .then(data => ({ date, slots: data.slots || [] }))
                .catch(() => ({ date, slots: [] }))
            )
          ).then(results => {
            if (cancelled) return;
            setSlotsCache(prev => {
              const next = new Map(prev);
              results.forEach(r => next.set(r.date, r.slots));
              return next;
            });
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [config, getDatesForMonth]);

  const handleMonthChange = useCallback((year, month) => {
    if (!config) return;
    const dates = getDatesForMonth(year, month, config);
    prefetchDates(dates);
  }, [config, getDatesForMonth, prefetchDates]);

  useEffect(() => {
    if (phoneDigits.length > maxDigits) {
      setPhoneNumber(phoneDigits.slice(0, maxDigits));
    }
  }, [maxDigits, phoneDigits]);

  useEffect(() => {
    if (!showTzDropdown) return;
    const handler = () => setShowTzDropdown(false);
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, [showTzDropdown]);

  useEffect(() => {
    if (!showPhoneCountryDropdown) return;
    const handler = () => setShowPhoneCountryDropdown(false);
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, [showPhoneCountryDropdown]);

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

  function buildBookingPayload(dateTime, onboarding = null) {
    const phone = countryCode.replace('+', '') + phoneDigits;
    const body = {
      phone,
      date_time: dateTime,
      timezone: bookingContext.timezone,
      ip_country_code: bookingContext.ip_country_code,
      ip_country_name: bookingContext.ip_country_name,
      location_country_code: bookingContext.location_country_code,
      location_country_name: bookingContext.location_country_name,
      location_confirmed_manually: bookingContext.location_confirmed_manually,
      device_type: bookingContext.device_type,
      user_agent: bookingContext.user_agent,
    };

    if (onboarding) body.onboarding = onboarding;
    if (urlFeeMode) body.fee_mode = urlFeeMode;
    if (urlCode) body.code = urlCode;

    return body;
  }

  // API calls
  async function handlePhoneSubmit() {
    dispatch({ type: 'PHONE_CHECK_START' });
    try {
      const body = buildBookingPayload(`${selectedDate}T${selectedSlot}`);
      const data = await api.post('/book', body);
      if (data.status === 'needs_onboarding') dispatch({ type: 'PHONE_NEW' });
      else if (data.status === 'booked') dispatch({ type: 'BOOK_SUCCESS', appointment: { date: selectedDate, time: selectedSlot } });
      else if (data.status === 'has_appointment') dispatch({
        type: 'PHONE_HAS_APPOINTMENT',
        appointment: data.appointment,
        rescheduleToken: data.reschedule_token,
      });
    } catch (err) { dispatch({ type: 'PHONE_ERROR', error: err.message }); }
  }

  async function handleBook(onboarding = null) {
    dispatch({ type: 'BOOK_START' });
    try {
      const body = buildBookingPayload(`${selectedDate}T${selectedSlot}`, onboarding);
      const data = await api.post('/book', body);
      if (data.status === 'needs_onboarding') dispatch({ type: 'BOOK_NEEDS_ONBOARDING' });
      else if (data.status === 'has_appointment') dispatch({
        type: 'BOOK_HAS_APPOINTMENT',
        appointment: data.appointment,
        rescheduleToken: data.reschedule_token,
      });
      else if (data.status === 'booked') dispatch({ type: 'BOOK_SUCCESS', appointment: { date: selectedDate, time: selectedSlot }, clientName: onboarding?.first_name || flow.clientName });
    } catch (err) { dispatch({ type: 'BOOK_ERROR', error: err.message }); }
  }

  async function handleReschedule() {
    dispatch({ type: 'RESCHEDULE_START' });
    try {
      const appt = flow.oldAppointment || flow.activeAppointment;
      if (!appt) throw new Error('No se encontró la cita original');
      if (!flow.rescheduleToken) throw new Error('La autorización para reagendar expiró. Vuelve a verificar tu teléfono.');
      await api.post('/reschedule', {
        ...buildBookingPayload(`${selectedDate}T${selectedSlot}`),
        old_appointment_id: appt.id,
        reschedule_token: flow.rescheduleToken,
      });
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
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 10 }}>
          <div style={{ display: 'inline-flex', alignItems: 'flex-start', gap: 10, maxWidth: 'min(100%, 340px)' }}>
            <Globe size={20} color="#B34E35" style={{ flexShrink: 0, marginTop: 3 }} />
            <span style={{ fontSize: 20, fontWeight: 600, color: '#3C3939', lineHeight: 1.2, textAlign: 'left' }}>
              ¿Desde qué país estás reservando?
            </span>
          </div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'center' }}>
          <button type="button" className="timezone-selector" onClick={e => { e.stopPropagation(); setShowTzDropdown(!showTzDropdown); }}>
            <span>{selectedTz.flag} {selectedTz.label} ({getCurrentTimeInTz(selectedTz.tz)})</span>
            <ChevronDown size={12} />
          </button>
        </div>
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
                      onClick={() => { setHasUserSelectedTz(true); setSelectedTz(z); setShowTzDropdown(false); setTzSearch(''); }}>
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

  function PhoneCountrySelector() {
    return (
      <div style={{ position: 'relative', marginBottom: 14 }}>
        <span className="field-label" style={{ marginBottom: 10 }}>PREFIJO DE TU WHATSAPP</span>
        <button
          type="button"
          className="country-selector"
          style={{ width: '100%', justifyContent: 'space-between', height: 58, paddingInline: 16 }}
          onClick={(e) => {
            e.stopPropagation();
            setShowPhoneCountryDropdown(!showPhoneCountryDropdown);
          }}
        >
          <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span>{selectedPhoneCountry.flag}</span>
            <span>{selectedPhoneCountry.name}</span>
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#6F6F73', fontWeight: 600 }}>
            {selectedPhoneCountry.code}
            <ChevronDown size={14} />
          </span>
        </button>
        {showPhoneCountryDropdown && (
          <div className="country-dropdown" style={{ width: '100%' }} onClick={e => e.stopPropagation()}>
            {COUNTRY_CODES.map(country => (
              <div
                key={country.code}
                className="country-dropdown-item"
                onClick={() => {
                  setSelectedPhoneCountry(country);
                  setShowPhoneCountryDropdown(false);
                }}
              >
                <span>{country.flag}</span>
                <span style={{ flex: 1 }}>{country.name}</span>
                <span style={{ color: 'var(--gris-medio)', fontWeight: 600 }}>{country.code}</span>
              </div>
            ))}
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
      // If ?r= mode with pre-filled phone, auto-submit phone (skip Screen 2)
      if (urlReschedule && phoneComplete && !flow.rescheduleMode) {
        // We need to set the slot first, then auto-submit
        // Use a small timeout to let state update
        setTimeout(() => autoSubmitPhone(time), 50);
        return;
      }
      dispatch({ type: 'PICK_SLOT' });
    }

    async function autoSubmitPhone(time) {
      dispatch({ type: 'PHONE_CHECK_START' });
      try {
        const body = buildBookingPayload(`${selectedDate}T${time}`);
        const data = await api.post('/book', body);
        if (data.status === 'needs_onboarding') dispatch({ type: 'PHONE_NEW' });
        else if (data.status === 'booked') dispatch({ type: 'BOOK_SUCCESS', appointment: { date: selectedDate, time } });
        else if (data.status === 'has_appointment') dispatch({
          type: 'PHONE_HAS_APPOINTMENT',
          appointment: data.appointment,
          rescheduleToken: data.reschedule_token,
        });
      } catch (err) { dispatch({ type: 'PHONE_ERROR', error: err.message }); }
    }

    return (
      <Layout devMode={devMode}>
        <Logo width={120} />
        <h1 style={{ fontSize: 30, fontWeight: 600, textAlign: 'center', color: 'var(--negro)', marginBottom: 16, lineHeight: 1.15 }}>
          {flow.rescheduleMode ? 'Elige tu nueva hora' : 'Encuentra el mejor momento para tu sesión'}
        </h1>
        {(flow.rescheduleMode || urlReschedule) && (
          <div style={{ background: 'var(--dorado)', textAlign: 'center', padding: '10px 16px', borderRadius: 12, marginBottom: 12, fontSize: 18, fontWeight: 600, color: 'var(--negro)' }}>
            {flow.clientName
              ? `${flow.clientName} vamos a reprogramar tu cita`
              : 'Vamos a reprogramar tu cita'}
          </div>
        )}

        <div className="card" style={{ marginBottom: 16 }}>
          <Calendar
            onSelectDate={handleDateSelect} selectedDate={selectedDate}
            availableDays={config?.available_days || []} windowDays={config?.window_days || 10}
            daysWithSlots={daysWithSlots}
            onMonthChange={handleMonthChange}
          />
        </div>

        {selectedDate && (
          <div className="card">
            {showScreen1TimezoneConfirmation && <TimezoneSelector />}
            <h2 style={{ fontSize: 24, fontWeight: 600, color: 'var(--negro)', marginBottom: 16, textAlign: 'center' }}>
              {formatDateES(selectedDate)}
            </h2>

            {(slotsLoading || (!prefetchDone && slots.length === 0)) ? (
              <p style={{ textAlign: 'center', color: 'var(--gris-medio)', padding: '24px 0', fontSize: 18 }}>Consultando disponibilidad...</p>
            ) : slots.length === 0 ? (
              <p style={{ textAlign: 'center', color: '#B34E35', padding: '24px 0', fontSize: 18, fontWeight: 600 }}>No hay horarios disponibles este día</p>
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
        {flow.loading && (
          <div style={{ textAlign: 'center', padding: '16px 0', fontSize: 16, color: 'var(--gris-medio)' }}>
            Verificando...
          </div>
        )}
        {flow.error && (
          <p style={{ color: 'var(--terracota)', fontSize: 16, textAlign: 'center', marginTop: 8 }}>{flow.error}</p>
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
              <img src="/whatsapp-outline.svg" alt="" aria-hidden="true" style={{ width: 42, height: 42, display: 'block' }} />
            </div>
            <PhoneCountrySelector />
            <div className="phone-unified-field">
              <span style={{
                fontWeight: 600, fontSize: 24,
                color: '#A4A4A6', letterSpacing: '0.1em',
                userSelect: 'none', whiteSpace: 'nowrap', flexShrink: 0,
              }}>
                {countryCode}
              </span>
              <input type="tel" value={phoneNumber}
                onChange={e => {
                  const val = e.target.value.replace(/\D/g, '');
                  if (!val) { setPhoneNumber(''); return; }
                  if (val.length > maxDigits) return;
                  setPhoneNumber(val);
                }}
                placeholder="71234567" className="phone-unified-input" autoFocus maxLength={maxDigits} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, marginTop: 6 }}>
              <span style={{ fontSize: 17, color: 'var(--gris-medio)' }}>{selectedPhoneCountry.name}</span>
              <span className="phone-digit-hint" style={{ fontSize: 17, color: phoneComplete ? 'var(--turquesa)' : phoneDigits.length > 0 ? 'var(--gris-medio)' : 'transparent' }}>
                {phoneDigits.length > 0 ? `${phoneDigits.length}/${expectedDigitsLabel} digitos` : ''}
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
        handleBook({
          first_name: firstName,
          last_name: lastName,
          age: ageNum,
          city: isBoliviaFeeFlow ? city : 'Otro',
          country: locationCountry.name,
          timezone: selectedTz?.tz || DEFAULT_TZ.tz,
          source,
        });
      } else {
        handleBook();
      }
    }

    return (
      <Layout devMode={devMode}>
        <Logo width={90} />
        <h1 style={{ fontSize: 26, fontWeight: 600, textAlign: 'center', color: 'var(--negro)', marginBottom: 12, lineHeight: 1.2 }}>
          {flow.showOnboarding ? (
            <>
              Preparando tu sesión
              <br />
              <span style={{ display: 'inline-block', marginTop: 6 }}>Ahora necesito algunos datos básicos</span>
            </>
          ) : flow.isReturning ? `${flow.clientName}, qué bueno verte de nuevo` : 'Confirma tu sesión'}
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
          {flow.showOnboarding ? (
            <DateTimePill
              date={selectedDate}
              timeLabel={displayTime(selectedSlot)}
              timezoneLabel={selectedTz.tz !== 'America/La_Paz' ? `${selectedTz.flag} ${selectedTz.label}` : ''}
            />
          ) : (
            <>
              <div className="detail-row" style={{ paddingTop: 0 }}>
                <div className="detail-icon"><CalendarIcon size={18} color="var(--gris-medio)" /></div>
                <div><div className="detail-label">Fecha</div><div className="detail-value">{formatDateES(selectedDate)}</div></div>
              </div>
              <div className="detail-row" style={{ paddingBottom: 0 }}>
                <div className="detail-icon"><Clock size={18} color="var(--gris-medio)" /></div>
                <div>
                  <div className="detail-label">Hora</div><div className="detail-value">{displayTime(selectedSlot)} hs</div>
                  {selectedTz.tz !== 'America/La_Paz' && <div style={{ fontSize: 14, color: 'var(--gris-medio)', marginTop: 2 }}>Zona: {selectedTz.flag} {selectedTz.label}</div>}
                </div>
              </div>
            </>
          )}
          <div className={`onboarding-slide ${flow.showOnboarding ? 'open' : ''}`}>
            <div style={{ borderTop: '1px solid rgba(60, 57, 57, 0.08)', paddingTop: 18 }}>
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
                {!isBoliviaFeeFlow ? (
                  <div>
                    <span className="field-label">PAÍS ELEGIDO</span>
                    <div
                      style={{
                        borderRadius: 20,
                        background: 'var(--bg-input)',
                        padding: '18px 20px',
                      }}
                    >
                      <div style={{ fontSize: 22, fontWeight: 600, color: 'var(--text-primary)' }}>{locationCountry.name}</div>
                    </div>
                  </div>
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
          </div>
        {flow.error && <p style={{ color: 'var(--terracota)', fontSize: 16, textAlign: 'center', marginBottom: 12 }}>{flow.error}</p>}
        <button type="button" onClick={handleConfirm} disabled={flow.loading || (flow.showOnboarding && (!firstName || !lastName || !age || !source || ageOutOfRange))} className="btn-primary" style={{ marginBottom: 12 }}>
          <Check size={18} />{flow.loading ? 'Confirmando...' : 'Confirmar cita'}
        </button>
        <button
          type="button"
          onClick={() => dispatch({ type: 'GO_BACK', screen: 2 })}
          className="btn-secondary"
        >
          <ArrowLeft size={18} />Volver
        </button>
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
        <p style={{ fontSize: 24, fontWeight: 600, color: 'var(--turquesa)', textAlign: 'center', marginBottom: 24, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
          <Heart size={20} color="var(--turquesa)" fill="var(--turquesa)" strokeWidth={2.5} /> {displayName ? `Gracias por tu confianza ${displayName}` : 'Gracias por tu confianza'}
        </p>
        {flow.bookedAppointment && (
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="detail-row" style={{ paddingTop: 0 }}>
              <div className="detail-icon"><CalendarIcon size={18} color="var(--gris-medio)" /></div>
              <div><div className="detail-label" style={{ fontSize: 16 }}>Fecha</div><div className="detail-value" style={{ fontSize: 20 }}>{formatDateES(flow.bookedAppointment.date)}</div></div>
            </div>
            <div className="detail-row" style={{ paddingBottom: 0 }}>
              <div className="detail-icon"><Clock size={18} color="var(--gris-medio)" /></div>
              <div><div className="detail-label" style={{ fontSize: 16 }}>Hora</div><div className="detail-value" style={{ fontSize: 20 }}>{displayTime(flow.bookedAppointment.time)} hs</div></div>
            </div>
          </div>
        )}
        <div className="notice-box" style={{ marginBottom: 24 }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
            <MessageSquareHeart size={26} color="#1A1A17" />
            <p style={{ fontSize: 19, fontWeight: 500, color: 'var(--grafito)', lineHeight: 1.5, textAlign: 'center', margin: 0 }}>Te llegará un recordatorio el día antes de tu cita.</p>
          </div>
          <div style={{ borderTop: '1px solid rgba(0,0,0,0.06)', marginTop: 12, paddingTop: 12 }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
              <ShieldAlert size={26} color="#1A1A17" />
              <p style={{ fontSize: 19, fontWeight: 500, color: 'var(--grafito)', lineHeight: 1.5, textAlign: 'center', margin: 0 }}>
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

        {/* Icono superior */}
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 14 }}>
          <div style={{ width: 64, height: 64, borderRadius: '50%', background: '#CFE8E9', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <CalendarArrowUp size={26} color="#4E769B" />
          </div>
        </div>

        {/* Título */}
        <h1 style={{ fontSize: 26, fontWeight: 600, textAlign: 'center', color: '#B34E35', marginBottom: 10 }}>
          {flow.clientName ? `${flow.clientName}, ya tienes esta cita agendada:` : 'Ya tienes esta cita agendada:'}
        </h1>

        {/* Sub-encabezado */}
        <p style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, fontSize: 20, fontWeight: 600, color: '#3C3939', textAlign: 'center', marginBottom: 20 }}>
          <CircleArrowRight size={20} color="#4E769B" />
          Continúa para <strong style={{ fontWeight: 800 }}>reprogramar</strong>
        </p>

        {/* Bloque CITA ACTUAL */}
        <div className="card" style={{ marginBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
            <div className="detail-icon"><CalendarIcon size={18} color="var(--gris-medio)" /></div>
            <div>
              <div style={{ fontSize: 17, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--gris-medio)', marginBottom: 4 }}>Cita actual</div>
              <div style={{ fontSize: 18, fontWeight: 600, color: '#3C3939' }}>{formatDateES(apptDate)}</div>
              <div style={{ fontSize: 16, fontWeight: 600, color: '#3C3939', marginTop: 2 }}>{apptTime} hs</div>
            </div>
          </div>
        </div>

        {/* Bloque NUEVA PROPUESTA */}
        <div className="card" style={{ marginBottom: 24, background: '#FDFAE8', border: '1px solid #4E769B' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
            <div className="detail-icon" style={{ background: '#FEF3C7' }}><Clock4 size={18} color="#D97706" /></div>
            <div>
              <div style={{ fontSize: 17, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#D97706', marginBottom: 4 }}>Nueva propuesta</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: '#3C3939' }}>{formatDateES(selectedDate)}</div>
              <div style={{ fontSize: 22, fontWeight: 700, color: '#4E769B', marginTop: 2 }}>{displayTime(selectedSlot)} hs</div>
            </div>
          </div>
        </div>

        {flow.error && <p style={{ color: 'var(--terracota)', fontSize: 16, textAlign: 'center', marginBottom: 12 }}>{flow.error}</p>}

        {/* Botón principal */}
        <button type="button" onClick={handleReschedule} disabled={flow.loading} className="btn-primary" style={{ marginBottom: 12, fontSize: 18, fontWeight: 600, background: '#4E769B' }}>
          <RefreshCw size={18} />{flow.loading ? 'Reprogramando...' : 'Reprogramar'}
        </button>

        {/* Botón secundario */}
        <button type="button" onClick={() => dispatch({ type: 'KEEP_APPOINTMENT', appointment: { date: apptDate, time: apptTime } })} className="btn-secondary" style={{ fontSize: 18, fontWeight: 600 }}>
          <CircleCheck size={18} />Mantener mi cita actual
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
