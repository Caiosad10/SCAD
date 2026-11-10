/** Estado em memória + seletores do SCAD. */

let state = null;

const CACHE_KEY = 'scad:state:v1';
let cacheTimer = null;

function scheduleCache() {
  if (typeof sessionStorage === 'undefined') return;
  clearTimeout(cacheTimer);
  cacheTimer = setTimeout(() => {
    try {
      if (state?.process) sessionStorage.setItem(CACHE_KEY, JSON.stringify(state));
      else sessionStorage.removeItem(CACHE_KEY);
    } catch {
      /* armazenamento cheio ou bloqueado */
    }
  }, 250);
}

export function readCachedState() {
  if (typeof sessionStorage === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const cached = JSON.parse(raw);
    if (!cached || typeof cached !== 'object' || !Array.isArray(cached.checks)) return null;
    return cached;
  } catch {
    return null;
  }
}

export const ui = {
  route: { name: 'dashboard', id: null, param: null },
  docFilter: 'all',
  docQuery: '',
  findFilter: 'all',
  findQuery: '',
  notesOpen: new Set(),
  queueAll: false,
  lastRouteKey: '',
  health: null,
};

export function getState() {
  return state;
}

export function setState(next) {
  state = next;
  scheduleCache();
}

export function mergeCheck(rev, check) {
  if (!state) return;
  state.rev = rev;
  const index = state.checks.findIndex((c) => c.id === check.id);
  if (index >= 0) state.checks[index] = check;
  state.meta = { ...state.meta, lastDocId: check.docId, lastCheckId: check.id };
  scheduleCache();
}

/* ---------------------------------------------------------- seletores */

export function criteriaSorted(s = state) {
  return [...(s?.criteria || [])].sort((a, b) => a.order - b.order);
}

export function docById(s, id) {
  return (s?.documents || []).find((d) => d.id === id) || null;
}

export function criterionById(id, s = state) {
  return (s?.criteria || []).find((c) => c.id === id) || null;
}

export function docIndex(s, docId) {
  return s.documents.findIndex((d) => d.id === docId);
}

export function checksOfDoc(s, docId) {
  return s.checks.filter((c) => c.docId === docId);
}

export function docStats(s, docId) {
  const checks = checksOfDoc(s, docId);
  const total = checks.length;
  const done = checks.filter((c) => c.status !== 'pending').length;
  const nc = checks.filter((c) => c.status === 'nc').length;
  const obs = checks.filter((c) => c.status === 'obs').length;
  return { total, done, pending: total - done, nc, obs, pct: total ? Math.round((done / total) * 100) : 0 };
}

export function docFlag(s, docId) {
  const st = docStats(s, docId);
  if (st.nc || st.obs) return 'flagged';
  if (st.pending) return 'pending';
  return st.total ? 'done' : 'empty';
}

export function overall(s = state) {
  const checks = s?.checks || [];
  const total = checks.length;
  const done = checks.filter((c) => c.status !== 'pending').length;
  const nc = checks.filter((c) => c.status === 'nc').length;
  const obs = checks.filter((c) => c.status === 'obs').length;
  const na = checks.filter((c) => c.status === 'na').length;
  const ok = checks.filter((c) => c.status === 'ok').length;
  const docs = s?.documents?.length || 0;
  const pendingDocs = (s?.documents || []).filter((d) => docStats(s, d.id).pending > 0).length;
  return {
    docs,
    total,
    done,
    pending: total - done,
    pendingDocs,
    nc,
    obs,
    na,
    ok,
    pct: total ? Math.round((done / total) * 100) : 0,
  };
}

export function findings(s = state) {
  const docs = new Map((s?.documents || []).map((d) => [d.id, d]));
  return (s?.checks || [])
    .filter((c) => c.status === 'nc' || c.status === 'obs')
    .map((c) => ({
      check: c,
      doc: docs.get(c.docId) || null,
      criterion: (s.criteria || []).find((cr) => cr.id === c.criterionId) || null,
    }))
    .filter((f) => f.doc)
    .sort((a, b) => {
      const ai = s.documents.indexOf(a.doc);
      const bi = s.documents.indexOf(b.doc);
      if (ai !== bi) return ai - bi;
      return (a.check.updatedAt || '').localeCompare(b.check.updatedAt || '');
    });
}

export function nextPendingDoc(s, fromDocId = null) {
  const docs = s?.documents || [];
  if (!docs.length) return null;
  const start = fromDocId ? docs.findIndex((d) => d.id === fromDocId) + 1 : 0;
  const ordered = [...docs.slice(start), ...docs.slice(0, start)];
  const pending = ordered.find((d) => docStats(s, d.id).pending > 0);
  return pending || null;
}

export function pendingQueue(s) {
  return (s?.documents || []).filter((d) => docStats(s, d.id).pending > 0);
}

export function docStatusLabel(s, docId) {
  const flag = docFlag(s, docId);
  if (flag === 'flagged') return 'Com apontamento';
  if (flag === 'pending') return 'Em análise';
  if (flag === 'done') return 'Verificado';
  return 'Sem verificações';
}
