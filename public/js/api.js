/** Cliente da API do SCAD. */

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

async function request(method, url, body) {
  let response;
  try {
    response = await fetch(url, {
      method,
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError('Não foi possível falar com o servidor. Ele ainda está rodando?', 0);
  }

  const raw = await response.text();
  let data = null;
  if (raw) {
    try {
      data = JSON.parse(raw);
    } catch {
      data = null;
    }
  }

  if (!response.ok) {
    throw new ApiError(data?.error || `Falha na operação (${response.status}).`, response.status);
  }
  return data;
}

export const api = {
  health: () => request('GET', '/api/health'),
  state: () => request('GET', '/api/state'),

  createProcess: (payload) => request('POST', '/api/process', payload),
  updateProcess: (payload) => request('PATCH', '/api/process', payload),

  addCriterion: (payload) => request('POST', '/api/criteria', payload),
  updateCriterion: (id, payload) => request('PATCH', `/api/criteria/${encodeURIComponent(id)}`, payload),
  deleteCriterion: (id) => request('DELETE', `/api/criteria/${encodeURIComponent(id)}`),
  reorderCriteria: (ids) => request('POST', '/api/criteria/reorder', { ids }),

  addDocument: (payload) => request('POST', '/api/documents', payload),
  renameDocument: (id, name) => request('PATCH', `/api/documents/${encodeURIComponent(id)}`, { name }),
  deleteDocument: (id) => request('DELETE', `/api/documents/${encodeURIComponent(id)}`),

  updateCheck: (id, patch) => request('PATCH', `/api/checks/${encodeURIComponent(id)}`, patch),
  setMeta: (payload) => request('POST', '/api/meta', payload),

  reset: () => request('POST', '/api/reset', { confirm: true }),
  importState: (state) => request('POST', '/api/import', { state }),
  exportUrl: '/api/export',
  fileUrl: (stored, download = false) => `/files/${encodeURIComponent(stored)}${download ? '?download=1' : ''}`,
};
