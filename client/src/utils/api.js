// Centralized fetch wrapper
const BASE_URL = '/api';
const LOCAL_DEV_HOSTS = new Set(['localhost', '127.0.0.1']);

// Detect devmode from page URL once
const pageParams = new URLSearchParams(window.location.search);
const isDevMode = LOCAL_DEV_HOSTS.has(window.location.hostname) && pageParams.get('devmode') === '1';

async function request(path, options = {}) {
  // Append devmode to API URL so server-side rate limiter sees it
  const separator = path.includes('?') ? '&' : '?';
  const url = isDevMode
    ? `${BASE_URL}${path}${separator}devmode=1`
    : `${BASE_URL}${path}`;

  const config = {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  };

  // Add auth token if available
  const token = localStorage.getItem('auth_token');
  if (token) {
    config.headers = { ...config.headers, Authorization: `Bearer ${token}` };
  }

  const response = await fetch(url, config);
  const data = await response.json();

  if (!response.ok) {
    if (response.status === 401 && token) {
      localStorage.removeItem('auth_token');
      window.location.href = '/admin/login';
      return;
    }
    throw new Error(data.error || `HTTP ${response.status}`);
  }

  return data;
}

export const api = {
  get: (path) => request(path),
  post: (path, body) => request(path, { method: 'POST', body: JSON.stringify(body) }),
  put: (path, body) => request(path, { method: 'PUT', body: JSON.stringify(body) }),
  delete: (path) => request(path, { method: 'DELETE' }),
  upload: async (path, formData) => {
    const token = localStorage.getItem('auth_token');
    const headers = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    const response = await fetch(`${BASE_URL}${path}`, {
      method: 'POST',
      headers,
      body: formData,
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
    return data;
  },
};
