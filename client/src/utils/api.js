// Centralized fetch wrapper
const BASE_URL = '/api';

// Detect devmode from page URL once
const pageParams = new URLSearchParams(window.location.search);
const isDevMode = pageParams.get('devmode') === '1';

function buildApiUrl(path) {
  const separator = path.includes('?') ? '&' : '?';
  return isDevMode
    ? `${BASE_URL}${path}${separator}devmode=1`
    : `${BASE_URL}${path}`;
}

async function request(path, options = {}) {
  const config = {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  };

  // Add auth token if available
  const token = localStorage.getItem('auth_token');
  if (token) {
    config.headers = { ...config.headers, Authorization: `Bearer ${token}` };
  }

  const response = await fetch(buildApiUrl(path), config);
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
    const response = await fetch(buildApiUrl(path), {
      method: 'POST',
      headers,
      body: formData,
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
    return data;
  },
};
