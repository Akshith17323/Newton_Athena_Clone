const configuredBaseUrl = import.meta.env.VITE_API_BASE_URL?.trim();

export const API_BASE_URL = (configuredBaseUrl || 'http://127.0.0.1:3000').replace(/\/$/, '');

export function apiUrl(path) {
  return `${API_BASE_URL}${path}`;
}
