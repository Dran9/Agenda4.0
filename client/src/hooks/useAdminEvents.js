import { useEffect, useRef, useCallback } from 'react';

/**
 * SSE hook — connects to /api/admin/events and triggers a callback
 * whenever the server broadcasts a relevant event.
 *
 * Usage:
 *   useAdminEvents(['appointment:change', 'recurring:change'], () => {
 *     // re-fetch your page data
 *     loadAppointments();
 *   });
 *
 * The connection auto-reconnects with exponential back-off.
 * It tears down cleanly when the component unmounts.
 */
export default function useAdminEvents(eventNames = [], onEvent) {
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  // Debounce: collapse rapid-fire SSE events into a single callback
  const timerRef = useRef(null);
  const debouncedFire = useCallback(() => {
    if (timerRef.current) return; // already scheduled
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      onEventRef.current?.();
    }, 400); // 400 ms debounce window
  }, []);

  useEffect(() => {
    const token = localStorage.getItem('auth_token');
    if (!token || eventNames.length === 0) return;

    let es = null;
    let retryMs = 1000;
    let dead = false;

    function connect() {
      if (dead) return;

      // EventSource doesn't support custom headers, so we pass the token
      // as a query parameter.  The auth middleware already checks both.
      es = new EventSource(`/api/admin/events?token=${encodeURIComponent(token)}`);

      es.onopen = () => {
        retryMs = 1000; // reset back-off on successful connection
      };

      // Register a handler for each event name we care about
      eventNames.forEach((name) => {
        es.addEventListener(name, () => {
          debouncedFire();
        });
      });

      es.onerror = () => {
        // EventSource auto-reconnects, but we also enforce our own
        // exponential back-off just in case.
        es.close();
        if (!dead) {
          setTimeout(connect, retryMs);
          retryMs = Math.min(retryMs * 2, 30000);
        }
      };
    }

    connect();

    return () => {
      dead = true;
      if (es) es.close();
      if (timerRef.current) clearTimeout(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventNames.join(','), debouncedFire]);
}
