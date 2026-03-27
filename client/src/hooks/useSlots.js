import { useState, useEffect, useCallback, useRef } from 'react';
import { api } from '../utils/api';

export function useSlots() {
  const [slots, setSlots] = useState([]);
  const [loading, setLoading] = useState(false);
  const [daysWithSlots, setDaysWithSlots] = useState(new Map());
  const cacheRef = useRef(new Map());

  const fetchSlots = useCallback(async (date) => {
    if (cacheRef.current.has(date)) {
      setSlots(cacheRef.current.get(date));
      return cacheRef.current.get(date);
    }

    setLoading(true);
    try {
      const data = await api.get(`/slots?date=${date}`);
      cacheRef.current.set(date, data.slots);
      setSlots(data.slots);
      return data.slots;
    } catch (err) {
      console.error('[useSlots] Error:', err.message);
      setSlots([]);
      return [];
    } finally {
      setLoading(false);
    }
  }, []);

  // Pre-fetch 7 days in parallel for calendar
  const prefetchDays = useCallback(async (dates) => {
    const uncached = dates.filter(d => !cacheRef.current.has(d));
    if (uncached.length === 0) {
      // Build map from cache
      const map = new Map();
      for (const d of dates) {
        const s = cacheRef.current.get(d);
        if (s && s.length > 0) map.set(d, true);
      }
      setDaysWithSlots(map);
      return;
    }

    // Fetch all uncached in parallel
    const results = await Promise.all(
      uncached.map(async (date) => {
        try {
          const data = await api.get(`/slots?date=${date}`);
          cacheRef.current.set(date, data.slots);
          return { date, slots: data.slots };
        } catch {
          return { date, slots: [] };
        }
      })
    );

    // Build map
    const map = new Map();
    for (const d of dates) {
      const s = cacheRef.current.get(d);
      if (s && s.length > 0) map.set(d, true);
    }
    setDaysWithSlots(map);
  }, []);

  return { slots, loading, daysWithSlots, fetchSlots, prefetchDays };
}
