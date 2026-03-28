import { useState, useEffect } from 'react';
import { useBookingReducer } from '../hooks/useBookingReducer';
import { useSlots } from '../hooks/useSlots';
import { useConfig } from '../hooks/useConfig';
import { api } from '../utils/api';
import { DEFAULT_TZ, detectTimezoneFromIP } from '../utils/timezones';

import CalendarScreen from '../components/booking/CalendarScreen';
import PhoneScreen from '../components/booking/PhoneScreen';
import ConfirmScreen from '../components/booking/ConfirmScreen';
import SuccessScreen from '../components/booking/SuccessScreen';
import ExistingApptScreen from '../components/booking/ExistingApptScreen';
import RescheduleConfirm from '../components/booking/RescheduleConfirm';

// Parse URL params once
const pageParams = new URLSearchParams(window.location.search);

export default function BookingFlow() {
  const [state, dispatch] = useBookingReducer();
  const { config, loading: configLoading } = useConfig();
  const { slots, loading: slotsLoading, daysWithSlots, fetchSlots, prefetchDays } = useSlots();
  const [timezone, setTimezone] = useState(DEFAULT_TZ);
  const [detectedCountryCode, setDetectedCountryCode] = useState('591');

  // URL params: ?t=PHONE, ?code=XXX
  const urlPhone = pageParams.get('t') || '';
  const urlCode = pageParams.get('code') || '';

  // Detect timezone and country from IP on mount
  useEffect(() => {
    fetch('https://ipapi.co/json/')
      .then(r => r.json())
      .then(data => {
        setTimezone(detectTimezoneFromIP(data));
        // Auto-detect country code for phone input
        if (data.country_calling_code) {
          setDetectedCountryCode(data.country_calling_code.replace('+', ''));
        }
      })
      .catch(() => {});
  }, []);

  // Prefetch next 5 weekdays on mount + auto-select today if it has slots
  useEffect(() => {
    if (!config) return;

    function getNextWeekdays(count) {
      const days = [];
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      while (days.length < count) {
        const dow = d.getDay(); // 0=Sun, 6=Sat
        if (dow >= 1 && dow <= 5) {
          const str = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
          days.push(str);
        }
        d.setDate(d.getDate() + 1);
      }
      return days;
    }

    const weekdays = getNextWeekdays(5);
    prefetchDays(weekdays);

    // Auto-select today and show its slots if today is a weekday
    const today = new Date();
    const todayDow = today.getDay();
    if (todayDow >= 1 && todayDow <= 5) {
      const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
      fetchSlots(todayStr).then(todaySlots => {
        if (todaySlots && todaySlots.length > 0) {
          dispatch({ type: 'SELECT_DATE_ONLY', date: todayStr });
        }
      });
    }
  }, [config]);

  // Dev mode detection
  const isDevMode = new URLSearchParams(window.location.search).get('devmode') === '1';

  // Handle phone submission → POST /api/book
  async function handleSubmitPhone(phone) {
    dispatch({ type: 'SUBMIT_PHONE', phone });
    try {
      const body = {
        phone,
        date_time: `${state.selectedDate}T${state.selectedSlot.time}`,
      };
      if (urlCode) body.code = urlCode;
      const data = await api.post('/book', body);

      if (data.status === 'needs_onboarding') {
        dispatch({ type: 'NEEDS_ONBOARDING' });
      } else if (data.status === 'booked') {
        dispatch({ type: 'BOOKED', result: data, clientName: data.client_name });
      } else if (data.status === 'has_appointment') {
        dispatch({
          type: 'HAS_APPOINTMENT',
          clientId: data.client_id,
          clientName: data.client_name,
          appointment: data.appointment,
        });
      }
    } catch (err) {
      dispatch({ type: 'SET_ERROR', error: err.message });
    }
  }

  // Handle onboarding submission → POST /api/book with onboarding
  async function handleSubmitOnboarding(onboarding) {
    dispatch({ type: 'SET_LOADING', loading: true });
    try {
      const data = await api.post('/book', {
        phone: state.phone,
        date_time: `${state.selectedDate}T${state.selectedSlot.time}`,
        onboarding,
      });

      if (data.status === 'booked') {
        dispatch({ type: 'BOOKED', result: data, clientName: onboarding.first_name });
      } else {
        dispatch({ type: 'SET_ERROR', error: 'Error inesperado al agendar' });
      }
    } catch (err) {
      dispatch({ type: 'SET_ERROR', error: err.message });
    }
  }

  // Handle reschedule DIRECTLY from Step 4 (user already picked a slot)
  async function handleRescheduleFromExisting() {
    dispatch({ type: 'SET_LOADING', loading: true });
    try {
      const data = await api.post('/reschedule', {
        client_id: state.clientId,
        old_appointment_id: state.existingAppointment.id,
        date_time: `${state.selectedDate}T${state.selectedSlot.time}`,
      });
      dispatch({ type: 'RESCHEDULED', result: data });
    } catch (err) {
      dispatch({ type: 'SET_ERROR', error: err.message });
    }
  }

  // Handle reschedule confirmation from Step 4b (picked new slot from calendar)
  async function handleConfirmReschedule() {
    dispatch({ type: 'SET_LOADING', loading: true });
    try {
      const data = await api.post('/reschedule', {
        client_id: state.clientId,
        old_appointment_id: state.oldAppointmentId,
        date_time: `${state.selectedDate}T${state.selectedSlot.time}`,
      });
      dispatch({ type: 'RESCHEDULED', result: data });
    } catch (err) {
      dispatch({ type: 'SET_ERROR', error: err.message });
    }
  }

  if (configLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-gray-400">Cargando...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white">
      {isDevMode && (
        <div className="bg-yellow-100 text-yellow-800 text-xs text-center py-1 font-medium">
          MODO DESARROLLO
        </div>
      )}

      <div className="max-w-md mx-auto px-3 py-6 sm:px-6">
        {state.screen === 'calendar' && (
          <CalendarScreen
            state={state}
            dispatch={dispatch}
            config={config}
            slots={slots}
            slotsLoading={slotsLoading}
            fetchSlots={fetchSlots}
            prefetchDays={prefetchDays}
            daysWithSlots={daysWithSlots}
            timezone={timezone}
            onTimezoneChange={setTimezone}
          />
        )}

        {state.screen === 'phone' && (
          <PhoneScreen
            state={state}
            dispatch={dispatch}
            onSubmitPhone={handleSubmitPhone}
            prefillPhone={urlPhone}
            detectedCountryCode={detectedCountryCode}
          />
        )}

        {state.screen === 'confirm' && (
          <ConfirmScreen
            state={state}
            dispatch={dispatch}
            onSubmitOnboarding={handleSubmitOnboarding}
          />
        )}

        {state.screen === 'success' && (
          <SuccessScreen state={state} />
        )}

        {state.screen === 'existing' && (
          <ExistingApptScreen
            state={state}
            dispatch={dispatch}
            onReschedule={handleRescheduleFromExisting}
          />
        )}

        {state.screen === 'reschedule_confirm' && (
          <RescheduleConfirm
            state={state}
            dispatch={dispatch}
            onConfirmReschedule={handleConfirmReschedule}
          />
        )}
      </div>
    </div>
  );
}
