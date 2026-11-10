/** Estado em memória (escopo do processo ativo) + seletores do SCAD v2. */

let state = null;

const CACHE_PREFIX = 'scad:state:v2';
const CACHE_MIRROR = 'scad:state:v2:mirror';
const CACHE_MIRROR_MAX_AGE = 3 * 24 * 60 * 60 * 1000;
let cacheTimer = null;

function readStored(key) {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage.getItem(key);
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
  health: null,
  activeProcessId: readStored('scad:activeProcess'),
  profileId: readStored('scad:profile'),
  pendingCollectionId: null,
};

export function setActiveProcess(id) {
  ui.activeProcessId = id || null;
  try {
    if (id) localStorage.setItem('scad:activeProcess', id);
    else localStorage.removeItem('scad:activeProcess');
  } catch {
    /* storage */
  }
}

export function setProfile(id) {
  ui.profileId = id || null;
  try {
    if (id) localStorage.setItem('scad:profile', id);
    else localStorage.removeItem('scad:profile');
  } catch {
    /* storage */
  }
}

export function getState() {
  return state;
}

function scheduleCache() {
  if (typeof sessionStorage === 'undefined') return;
  clearTimeout(cacheTimer);
  cacheTimer = setTimeout(() => {
    try {
      if (state?.process?.id) {
        const payload = JSON.stringify(state);
        sessionStorage.setItem(`${CACHE_PREFIX}:${state.process.id}`, payload);
        // Espelho no localStorage: no iPad o Safari pode descartar a sessão ao
        // recarregar/reabrir; assim a tela ainda abre antes do servidor.
        localStorage.setItem(
          `${CACHE_MIRROR}:${state.process.id}`,
          JSON.stringify({ at: Date.now(), state })
        );
        pruneMirrors(state.process.id);
      }
    } catch {
      /* cheio/bloqueado */
    }
  }, 250);
}

/** Mantém no máximo as cópias recentes, para o localStorage não crescer sem limite. */
function pruneMirrors(keepId) {
  try {
    const entries = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (!key?.startsWith(`${CACHE_MIRROR}:`)) continue;
      let at = 0;
      try {
        at = Number(JSON.parse(localStorage.getItem(key) || 'null')?.at || 0);
      } catch {
        /* entrada inválida */
      }
      entries.push({ key, at, id: key.slice(CACHE_MIRROR.length + 1) });
    }
    entries
      .filter((entry) => entry.id !== keepId && Date.now() - entry.at > CACHE_MIRROR_MAX_AGE)
      .forEach((entry) => localStorage.removeItem(entry.key));
    if (entries.length > 6) {
      entries
        .filter((entry) => entry.id !== keepId)
        .sort((a, b) => a.at - b.at)
        .slice(0, entries.length - 6)
        .forEach((entry) => localStorage.removeItem(entry.key));
    }
  } catch {
    /* storage bloqueado */
  }
}

function parseCached(raw, pid, wrapped) {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    const cached = wrapped ? parsed?.state : parsed;
    if (wrapped && Date.now() - Number(parsed?.at || 0) > CACHE_MIRROR_MAX_AGE) return null;
    if (!cached || cached.process?.id !== pid || !Array.isArray(cached.checks)) return null;
    return cached;
  } catch {
    return null;
  }
}

export function readCachedState() {
  if (typeof sessionStorage === 'undefined') return null;
  try {
    const pid = ui.activeProcessId;
    if (!pid) return null;
    const fromSession = parseCached(sessionStorage.getItem(`${CACHE_PREFIX}:${pid}`), pid, false);
    if (fromSession) return fromSession;
    return parseCached(localStorage.getItem(`${CACHE_MIRROR}:${pid}`), pid, true);
  } catch {
    return null;
  }
}

export function setState(next) {
  state = next;
  if (next?.process?.id) ui.activeProcessId = next.process.id;
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
  return (s?.documents || []).findIndex((d) => d.id === docId);
}

export function checksOfDoc(s, docId) {
  return (s?.checks || []).filter((c) => c.docId === docId);
}

export function docStats(s, docId) {
  const doc = docById(s, docId);
  const checks = checksOfDoc(s, docId);
  if (doc?.active === false) {
    return { inactive: true, total: checks.length, done: 0, pending: 0, nc: 0, obs: 0, pct: 0 };
  }
  const total = checks.length;
  const done = checks.filter((c) => c.status !== 'pending').length;
  const nc = checks.filter((c) => c.status === 'nc').length;
  const obs = checks.filter((c) => c.status === 'obs').length;
  return { inactive: false, total, done, pending: total - done, nc, obs, pct: total ? Math.round((done / total) * 100) : 0 };
}

export function docFlag(s, docId) {
  const doc = docById(s, docId);
  if (doc?.active === false) return 'inactive';
  const st = docStats(s, docId);
  if (st.nc || st.obs) return 'flagged';
  if (st.pending) return 'pending';
  return st.total ? 'done' : 'empty';
}

export function overall(s = state) {
  const docs = s?.documents || [];
  const activeDocs = docs.filter((d) => d.active !== false);
  const inactiveDocs = docs.length - activeDocs.length;
  const activeIds = new Set(activeDocs.map((d) => d.id));
  const activeChecks = (s?.checks || []).filter((c) => activeIds.has(c.docId));
  const suspended = (s?.checks || []).filter((c) => !activeIds.has(c.docId));
  const total = activeChecks.length;
  const done = activeChecks.filter((c) => c.status !== 'pending').length;
  const nc = activeChecks.filter((c) => c.status === 'nc').length;
  const obs = activeChecks.filter((c) => c.status === 'obs').length;
  const ok = activeChecks.filter((c) => c.status === 'ok').length;
  const pendingDocs = activeDocs.filter((d) => docStats(s, d.id).pending > 0).length;
  return {
    docs: docs.length,
    activeDocs: activeDocs.length,
    inactiveDocs,
    total,
    done,
    pending: total - done,
    pendingDocs,
    nc,
    obs,
    ok,
    na: 0,
    suspended: suspended.length,
    pct: total ? Math.round((done / total) * 100) : 0,
  };
}

export function findings(s = state) {
  const docs = new Map((s?.documents || []).map((d) => [d.id, d]));
  const criteria = new Map((s?.criteria || []).map((c) => [c.id, c]));
  return (s?.checks || [])
    .filter((c) => c.status === 'nc' || c.status === 'obs')
    .map((c) => ({ check: c, doc: docs.get(c.docId) || null, criterion: criteria.get(c.criterionId) || null }))
    .filter((item) => item.doc && item.doc.active !== false)
    .sort((a, b) => {
      const ai = s.documents.indexOf(a.doc);
      const bi = s.documents.indexOf(b.doc);
      if (ai !== bi) return ai - bi;
      return (a.check.updatedAt || '').localeCompare(b.check.updatedAt || '');
    });
}

export function nextPendingDoc(s, fromDocId = null) {
  const docs = (s?.documents || []).filter((doc) => doc.active !== false);
  if (!docs.length) return null;
  const start = fromDocId ? docs.findIndex((d) => d.id === fromDocId) + 1 : 0;
  const ordered = [...docs.slice(start), ...docs.slice(0, start)];
  return ordered.find((d) => docStats(s, d.id).pending > 0) || null;
}

export function pendingQueue(s) {
  return (s?.documents || []).filter((d) => d.active !== false && docStats(s, d.id).pending > 0);
}

export function activeProcess(s = state) {
  return s?.process || null;
}

export function activeCollection(s = state) {
  return s?.collection || null;
}

export function processesOfCollection(s, collectionId) {
  return (s?.processes || []).filter((process) => process.collectionId === collectionId);
}

export function collectionById(s, id) {
  return (s?.collections || []).find((collection) => collection.id === id) || null;
}

export function processById(s, id) {
  return (s?.processes || []).find((process) => process.id === id) || null;
}

export function currentProfile(s = state) {
  return (s?.profiles || []).find((profile) => profile.id === ui.profileId) || null;
}

export function docStatusLabel(s, docId) {
  const flag = docFlag(s, docId);
  if (flag === 'inactive') return 'Inativo';
  if (flag === 'flagged') return 'Com apontamento';
  if (flag === 'pending') return 'Em análise';
  if (flag === 'done') return 'Verificado';
  return 'Sem verificações';
}
