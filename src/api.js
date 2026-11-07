const configuredBaseUrl = import.meta.env.VITE_API_BASE_URL?.trim();

export const API_BASE_URL = (configuredBaseUrl || 'http://127.0.0.1:3000').replace(/\/$/, '');

export async function apiFetch(path, options = {}) {
  if (!window.athena?.apiRequest) {
    throw new Error('Authenticated Electron API bridge is unavailable');
  }

  const result = await window.athena.apiRequest({
    path,
    method: options.method || 'GET',
    body: options.body,
  });

  return {
    ok: result.ok,
    status: result.status,
    json: async () => result.data,
  };
}
