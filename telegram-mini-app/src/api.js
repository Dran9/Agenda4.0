const API_BASE = '/api';

function getToken() {
  return localStorage.getItem('tg_auth_token');
}

async function request(path, options = {}) {
  const config = {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  };

  const token = getToken();
  if (token) {
    config.headers = { ...config.headers, Authorization: `Bearer ${token}` };
  }

  const response = await fetch(`${API_BASE}${path}`, config);

  let data;
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    data = await response.json();
  } else {
    const text = await response.text();
    data = { error: text.slice(0, 200) || `HTTP ${response.status}` };
  }

  if (!response.ok) {
    throw new Error(data.error || `HTTP ${response.status}`);
  }

  return data;
}

export const api = {
  get: (path) => request(path),
  post: (path, body) => request(path, { method: 'POST', body: JSON.stringify(body) }),
  put: (path, body) => request(path, { method: 'PUT', body: JSON.stringify(body) }),
  delete: (path) => request(path, { method: 'DELETE' }),
};

export function setToken(token) {
  localStorage.setItem('tg_auth_token', token);
}

export function clearToken() {
  localStorage.removeItem('tg_auth_token');
}
