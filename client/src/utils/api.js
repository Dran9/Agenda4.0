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
  let data;
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    data = await response.json();
  } else {
    const text = await response.text();
    data = { error: text.slice(0, 200) || `HTTP ${response.status}` };
  }

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

function resolveDownloadFilename(contentDisposition, fallbackFilename) {
  if (!contentDisposition) return fallbackFilename;

  const utf8Match = contentDisposition.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match?.[1]) return decodeURIComponent(utf8Match[1]);

  const filenameMatch = contentDisposition.match(/filename="?([^"]+)"?/i);
  if (filenameMatch?.[1]) return filenameMatch[1];

  return fallbackFilename;
}

export const api = {
  get: (path) => request(path),
  post: (path, body) => request(path, { method: 'POST', body: JSON.stringify(body) }),
  put: (path, body) => request(path, { method: 'PUT', body: JSON.stringify(body) }),
  delete: (path) => request(path, { method: 'DELETE' }),
  download: async (path, fallbackFilename = 'export.xlsx') => {
    const token = localStorage.getItem('auth_token');
    const headers = {};
    if (token) headers.Authorization = `Bearer ${token}`;

    const response = await fetch(buildApiUrl(path), { headers });
    if (!response.ok) {
      let errorMessage = `HTTP ${response.status}`;
      try {
        const data = await response.json();
        errorMessage = data.error || errorMessage;
      } catch {
        // Ignore JSON parse failures on binary/download responses.
      }
      throw new Error(errorMessage);
    }

    const blob = await response.blob();
    const filename = resolveDownloadFilename(
      response.headers.get('Content-Disposition'),
      fallbackFilename
    );
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(url);
    return { filename };
  },
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
