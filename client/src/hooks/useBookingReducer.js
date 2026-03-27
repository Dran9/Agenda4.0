import { useReducer } from 'react';

const initialState = {
  screen: 'calendar', // calendar | phone | confirm | success | existing | reschedule_confirm
  selectedDate: null,
  selectedSlot: null,
  phone: '',
  clientId: null,
  clientName: '',
  existingAppointment: null,
  bookingResult: null,
  isReschedule: false,
  oldAppointmentId: null,
  error: null,
  loading: false,
};

function bookingReducer(state, action) {
  switch (action.type) {
    case 'SELECT_SLOT':
      return {
        ...state,
        screen: 'phone',
        selectedDate: action.date,
        selectedSlot: action.slot,
        error: null,
      };

    case 'SUBMIT_PHONE':
      return { ...state, phone: action.phone, loading: true, error: null };

    case 'NEEDS_ONBOARDING':
      return { ...state, loading: false, screen: 'confirm' };

    case 'BOOKED':
      return {
        ...state,
        loading: false,
        screen: 'success',
        bookingResult: action.result,
        clientName: action.clientName || state.clientName,
      };

    case 'HAS_APPOINTMENT':
      return {
        ...state,
        loading: false,
        screen: 'existing',
        clientId: action.clientId,
        clientName: action.clientName,
        existingAppointment: action.appointment,
      };

    case 'START_RESCHEDULE':
      return {
        ...state,
        screen: 'calendar',
        isReschedule: true,
        oldAppointmentId: action.oldAppointmentId,
        error: null,
      };

    case 'SELECT_SLOT_RESCHEDULE':
      return {
        ...state,
        screen: 'reschedule_confirm',
        selectedDate: action.date,
        selectedSlot: action.slot,
        error: null,
      };

    case 'RESCHEDULED':
      return {
        ...state,
        loading: false,
        screen: 'success',
        bookingResult: action.result,
        isReschedule: true,
      };

    case 'SET_LOADING':
      return { ...state, loading: action.loading };

    case 'SET_ERROR':
      return { ...state, error: action.error, loading: false };

    case 'GO_BACK':
      if (state.screen === 'phone') return { ...state, screen: 'calendar', error: null };
      if (state.screen === 'confirm') return { ...state, screen: 'phone', error: null };
      if (state.screen === 'reschedule_confirm') return { ...state, screen: 'calendar', error: null };
      if (state.screen === 'existing') return { ...state, screen: 'calendar', error: null };
      return state;

    case 'RESET':
      return initialState;

    default:
      return state;
  }
}

export function useBookingReducer() {
  return useReducer(bookingReducer, initialState);
}
