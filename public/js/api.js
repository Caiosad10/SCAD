/** Cliente da API do SCAD v2 (escopo de processo + autor). */

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

let actorId = null;
let processId = null;

export function configure({ actor, process }) {
  if (actor !== undefined) actorId = actor || null;
  if (process !== undefined) processId = process || null;
}

async function request(method, url, body) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (actorId) headers['X-SCAD-Actor'] = actorId;
  if (processId) headers['X-SCAD-Process'] = processId;

  let response;
  try {
    response = await fetch(url, {
      method,
      headers: Object.keys(headers).length ? headers : undefined,
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
  state: (pid = processId) => request('GET', `/api/state${pid ? `?processId=${encodeURIComponent(pid)}` : ''}`),

  createCollection: (payload) => request('POST', '/api/collections', payload),
  updateCollection: (id, payload) => request('PATCH', `/api/collections/${encodeURIComponent(id)}`, payload),
  deleteCollection: (id) => request('DELETE', `/api/collections/${encodeURIComponent(id)}`),

  createProcess: (payload) => request('POST', '/api/processes', payload),
  updateProcess: (id, payload) => request('PATCH', `/api/processes/${encodeURIComponent(id)}`, payload),
  deleteProcess: (id) => request('DELETE', `/api/processes/${encodeURIComponent(id)}`),

  addCriterion: (pid, payload) => request('POST', '/api/criteria', { processId: pid, ...payload }),
  updateCriterion: (id, payload) => request('PATCH', `/api/criteria/${encodeURIComponent(id)}`, payload),
  deleteCriterion: (id) => request('DELETE', `/api/criteria/${encodeURIComponent(id)}`),
  reorderCriteria: (ids) => request('POST', '/api/criteria/reorder', { ids }),
  copyCriteria: (payload) => request('POST', '/api/criteria/copy', payload),

  addDocument: (pid, payload) => request('POST', '/api/documents', { processId: pid, ...payload }),
  updateDocument: (id, payload) => request('PATCH', `/api/documents/${encodeURIComponent(id)}`, payload),
  deleteDocument: (id) => request('DELETE', `/api/documents/${encodeURIComponent(id)}`),

  updateCheck: (id, patch) => request('PATCH', `/api/checks/${encodeURIComponent(id)}`, patch),
  setMeta: (pid, payload) => request('POST', '/api/meta', { processId: pid, ...payload }),

  reset: () => request('POST', '/api/reset', { confirm: true }),
  importState: (state) => request('POST', '/api/import', { state }),
  exportUrl: '/api/export',
  fileUrl: (stored, download = false) => `/files/${encodeURIComponent(stored)}${download ? '?download=1' : ''}`,
};
