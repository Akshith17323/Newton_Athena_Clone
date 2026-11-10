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
