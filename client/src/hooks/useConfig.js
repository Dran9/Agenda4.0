import { useState, useEffect } from 'react';
import { api } from '../utils/api';

export function useConfig() {
  const [config, setConfig] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/config/public')
      .then(setConfig)
      .catch(err => console.error('[useConfig] Error:', err.message))
      .finally(() => setLoading(false));
  }, []);

  return { config, loading };
}
