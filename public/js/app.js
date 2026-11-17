/** SCAD v2 — shell, rotas, coleções, perfis e interações. */
import { api, configure as configureApi } from './api.js';
import {
  getState,
  setState,
  mergeCheck,
  readCachedState,
  ui,
  overall,
  docById,
  docStats,
  docFlag,
  criteriaSorted,
  findings,
  nextPendingDoc,
  pendingQueue,
  setActiveProcess,
  setProfile,
  collectionById,
  processById,
  currentProfile,
  reviewOfDoc,
  reviewQueueItems,
  checkReview,
  isRequirementsFlow,
  isItemDoc,
  childDocuments,
  customStatuses,
  statusLabelFor,
  isPointedStatus,
  correctionVersion,
  currentVersion,
  versionsOf,
} from './store.js';
import {
  esc,
  fmtBytes,
  fmtInt,
  fmtTime,
  fmtDate,
  plural,
  toast,
  openSheet,
  confirmSheet,
  copyText,
  isEditing,
  fileKind,
  fileKindLabel,
  stamp,
  markSave,
} from './ui.js';
import { icon } from './icons.js';
import {
  suportaPreviaDocx,
  ehDocAntigo,
  montarPreviaDocx,
  montarPreviaDoc,
  textoDoArquivo,
} from './preview.js';
import { diffTexto, resumoEmTexto } from './diff.js';
import { diffBodyHtml, diffAvisoHtml } from './views/correction.js';
import { renderOnboarding, chipsHtml, PRESET_LIST } from './views/onboarding.js';
import { renderDashboard } from './views/dashboard.js';
import { renderDocuments, renderDocumentsList, renderDocument, filterDocuments } from './views/documents.js';
import { renderWorkbench, resolveWorkbenchDoc } from './views/workbench.js';
import { renderFindings, renderFindingsResults } from './views/findings.js';
import { renderSettings } from './views/settings.js';
import { renderCollections, renderCollection } from './views/collections.js';
import {
  renderCheckRow,
  docSummaryHtml,
  checksHeadHtml,
  patchChecksHead,
  patchCheckRow,
  doneBannerHtml,
  presenceLine,
  evidenceBlockHtml,
} from './views/checks.js';

const NAV = [
  { id: 'dashboard', href: '#/', label: 'Painel', icon: 'panel' },
  { id: 'documents', href: '#/documentos', label: 'Documentos', icon: 'docs' },
  { id: 'workbench', href: '#/analisar', label: 'Analisar', icon: 'analyze' },
  { id: 'findings', href: '#/apontamentos', label: 'Apontamentos', icon: 'findings' },
  { id: 'settings', href: '#/ajustes', label: 'Ajustes', icon: 'settings' },
];

const SCREEN_LABEL = {
  dashboard: 'Painel',
  documents: 'Documentos',
  document: 'Documento',
  workbench: 'Bancada',
  findings: 'Apontamentos',
  settings: 'Ajustes',
  collections: 'Coleções',
  collection: 'Coleção',
};

const MAX_UPLOAD = 32 * 1024 * 1024;
const ACTIVE_NAV = {
  dashboard: 'dashboard',
  documents: 'documents',
  document: 'documents',
  workbench: 'workbench',
  findings: 'findings',
  settings: 'settings',
};

const mainEl = document.getElementById('main');
const mastEl = document.getElementById('masthead');
const navSlot = document.getElementById('nav-slot');

const noteTimers = new Map();
let importBusy = false;
let activeWrites = 0;
let syncing = false;
let lastSyncToast = 0;
let navigating = false;
let pendingRoute = false;

const LAST_ROUTE_KEY = 'scad:lastRoute:v1';
const SESSION_KEY = 'scad:session:v1';
const SESSION_MAX_AGE = 7 * 24 * 60 * 60 * 1000;
const NAV_ENTER_MS = 820;

let navReady = false;
let navEl = null;
let pillEl = null;
let pillTrack = 0;
let navActive = null;
let mastheadMode = null;
let pendingScrollY = 0;
let scrollSaveTimer = 0;
let presenceTimer = 0;
let presenceDocId = null;
let presenceModeName = null;

/* ---------------------------------------------------------------- boot */

boot();

/** Salva a tela, os filtros e a rolagem para reabrir exatamente onde o usuário parou. */
function saveSession() {
  try {
    const hash = location.hash;
    if (!hash || hash === '#/' || hash === '#') {
      localStorage.removeItem(SESSION_KEY);
      return;
    }
    localStorage.setItem(
      SESSION_KEY,
      JSON.stringify({
        hash,
        processId: getState()?.process?.id || null,
        docFilter: ui.docFilter || 'all',
        docQuery: ui.docQuery || '',
        findFilter: ui.findFilter || 'all',
        findQuery: ui.findQuery || '',
        queueAll: Boolean(ui.queueAll),
        queueReview: Boolean(ui.queueReview),
        scrollY: Math.round(window.scrollY || 0),
        at: Date.now(),
      })
    );
  } catch {
    /* armazenamento indisponível */
  }
}

function rememberRoute() {
  try {
    const hash = location.hash;
    if (!hash || hash === '#/' || hash === '#') {
      localStorage.removeItem(LAST_ROUTE_KEY);
      localStorage.removeItem(SESSION_KEY);
      return;
    }
    localStorage.setItem(LAST_ROUTE_KEY, JSON.stringify({ hash, at: Date.now() }));
    saveSession();
  } catch {
    /* armazenamento indisponível */
  }
}

function scheduleSessionSave() {
  clearTimeout(scrollSaveTimer);
  scrollSaveTimer = setTimeout(saveSession, 350);
}

/** Devolve filtros, fila e rolagem da última sessão (recarga ou reabertura no iPad). */
function restoreSession() {
  let saved;
  try {
    saved = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
  } catch {
    return false;
  }
  if (!saved || typeof saved !== 'object') return false;
  if (Date.now() - Number(saved.at || 0) > SESSION_MAX_AGE) return false;
  if (saved.processId && ui.activeProcessId && saved.processId !== ui.activeProcessId) return false;
  if (typeof saved.docFilter === 'string') ui.docFilter = saved.docFilter;
  if (typeof saved.docQuery === 'string') ui.docQuery = saved.docQuery;
  if (typeof saved.findFilter === 'string') ui.findFilter = saved.findFilter;
  if (typeof saved.findQuery === 'string') ui.findQuery = saved.findQuery;
  ui.queueAll = Boolean(saved.queueAll);
  ui.queueReview = Boolean(saved.queueReview);
  pendingScrollY = Math.max(0, Number(saved.scrollY) || 0);
  return true;
}

function restoreLastRoute() {
  try {
    if (location.hash && location.hash !== '#/' && location.hash !== '#') return;
    const candidates = [];
    for (const key of [SESSION_KEY, LAST_ROUTE_KEY]) {
      try {
        candidates.push(JSON.parse(localStorage.getItem(key) || 'null'));
      } catch {
        /* ignora entrada inválida */
      }
    }
    const saved = candidates.find(
      (item) =>
        item?.hash &&
        item.hash.startsWith('#/') &&
        item.hash !== '#/' &&
        Date.now() - Number(item.at || 0) <= SESSION_MAX_AGE &&
        (!item.processId || !ui.activeProcessId || item.processId === ui.activeProcessId)
    );
    if (!saved) return;
    history.replaceState(null, '', saved.hash);
  } catch {
    /* sem rota salva */
  }
}

function restoreScroll() {
  const y = pendingScrollY;
  pendingScrollY = 0;
  if (y > 0) requestAnimationFrame(() => window.scrollTo(0, y));
}

async function boot() {
  bindEvents();
  restoreSession();
  restoreLastRoute();

  let paintedFromCache = false;
  const cached = readCachedState();
  if (cached?.process) {
    setState(cached);
    const cachedProfile = cached.profiles?.find((item) => item.id === ui.profileId) || null;
    configureApi({ actor: cachedProfile?.id || null, process: cached.process.id });
    parseRoute();
    renderAll();
    revealApp(true);
    restoreScroll();
    if (ui.route.name === 'dashboard') staggerDashboard();
    paintedFromCache = true;
  }

  let base;
  try {
    base = await api.state(null);
  } catch (err) {
    if (paintedFromCache) {
      toast('Servidor indisponível — exibindo a última cópia local.', 'err');
      setInterval(syncIfIdle, 12000);
      return;
    }
    showBootError(err);
    return;
  }
  setState(base);
  ui.health = await api.health().catch(() => null);

  let profile = base.profiles?.find((item) => item.id === ui.profileId) || null;
  configureApi({ actor: profile?.id || null, process: null });

  const wanted = (base.processes || []).find((item) => item.id === ui.activeProcessId) || base.processes?.[0] || null;
  if (wanted) {
    try {
      const scoped = await api.state(wanted.id);
      setState(scoped);
      setActiveProcess(wanted.id);
      configureApi({ actor: profile?.id || null, process: wanted.id });
      profile = scoped.profiles?.find((item) => item.id === ui.profileId) || profile;
    } catch {
      /* mantém a lista básica */
    }
  }

  parseRoute();
  rememberRoute();
  renderAll({ preserveScroll: paintedFromCache });
  revealApp();
  if (ui.route.name === 'dashboard' && !paintedFromCache) staggerDashboard();
  if (!paintedFromCache) restoreScroll();
  if (!profile) showProfilePicker(base.profiles || []);
  setInterval(syncIfIdle, 12000);
}

function paintApp() {
  parseRoute();
  rememberRoute();
  renderAll();
  revealApp(true);
}

function revealApp(instant = false) {
  const app = document.getElementById('app');
  if (app) app.hidden = false;
  const bootEl = document.getElementById('boot');
  if (!bootEl) return;
  if (instant) {
    bootEl.remove();
    return;
  }
  bootEl.classList.remove('is-visible');
  bootEl.classList.add('is-hidden');
  setTimeout(() => bootEl.remove(), 420);
}

function showBootError(err) {
  const bootEl = document.getElementById('boot');
  if (!bootEl) return;
  bootEl.classList.add('is-visible');
  bootEl.classList.remove('is-hidden');
  bootEl.innerHTML =
    `<div class="boot__panel boot__error">` +
    `<span class="boot__mark">SCAD</span>` +
    `<span class="boot__rule" aria-hidden="true"></span>` +
    `<p class="boot__error-title">Não foi possível abrir o arquivo de trabalho.</p>` +
    `<p class="boot__error-text">${esc(err.message || 'Erro ao carregar o estado.')}</p>` +
    `<button type="button" class="btn btn--primary" data-retry>${icon('arrowRight', 15)} Tentar novamente</button>` +
    `</div>`;
  bootEl.querySelector('[data-retry]')?.addEventListener('click', () => window.location.reload());
}

/* --------------------------------------------------------------- rotas */

function parseRoute() {
  const raw = (location.hash || '#/').replace(/^#/, '');
  const clean = raw.startsWith('/') ? raw.slice(1) : raw;
  let parts = [];
  try {
    parts = clean.split('/').filter(Boolean).map((part) => decodeURIComponent(part));
  } catch {
    parts = clean.split('/').filter(Boolean);
  }

  let route = { name: 'dashboard', id: null };
  if (parts[0] === 'colecoes') route = parts[1] ? { name: 'collection', id: parts[1] } : { name: 'collections' };
  else if (parts[0] === 'documentos') route = parts[1] ? { name: 'document', id: parts[1] } : { name: 'documents' };
  else if (parts[0] === 'analisar') route = { name: 'workbench', id: parts[1] || null };
  else if (parts[0] === 'apontamentos') route = { name: 'findings' };
  else if (parts[0] === 'ajustes') route = { name: 'settings' };

  ui.route = route;

  const state = getState();
  if (state?.process && route.name === 'workbench' && !route.id) {
    const doc = resolveWorkbenchDoc(state);
    if (doc) {
      ui.route = { ...route, id: doc.id };
      history.replaceState(null, '', `#/analisar/${doc.id}`);
    }
  }
  if (state && !state.process && !['collections', 'collection'].includes(ui.route.name)) {
    if ((state.collections || []).length) {
      ui.route = { name: 'collections', id: null };
      history.replaceState(null, '', '#/colecoes');
    } else {
      ui.route = { name: 'dashboard', id: null };
    }
  }
}

function navigate(hash, { force = false } = {}) {
  const current = location.hash || '#/';
  if (current === hash) {
    if (force) {
      parseRoute();
      renderAll();
    }
    return;
  }
  try {
    history.pushState(null, '', hash);
  } catch {
    location.hash = hash;
    return;
  }
  handleRouteChange();
}

function routeKey() {
  return `${ui.route.name}:${ui.route.id || ''}`;
}

async function handleRouteChange() {
  if (navigating) {
    pendingRoute = true;
    return;
  }
  closeDialogs();
  const before = routeKey();
  parseRoute();
  rememberRoute();
  if (['collections', 'collection'].includes(ui.route.name) && getState()?.process) {
    try {
      const fresh = await api.state(getState().process.id);
      setState(fresh);
    } catch {
      /* mantém os números já carregados */
    }
  }
  if (routeKey() === before) {
    renderAll({ preserveScroll: true });
    return;
  }

  navigating = true;
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const canAnimate = !reduce && typeof mainEl.animate === 'function';

  try {
    if (canAnimate) {
      mainEl.style.pointerEvents = 'none';
      const leave = mainEl.animate(
        [
          { opacity: 1, transform: 'translateY(0)' },
          { opacity: 0, transform: 'translateY(5px)' },
        ],
        { duration: 130, easing: 'cubic-bezier(0.4, 0, 0.9, 0.4)', fill: 'forwards' }
      );
      try {
        await Promise.race([leave.finished, new Promise((done) => setTimeout(done, 400))]);
      } catch {
        /* animação cancelada */
      }
    }

    try {
      renderAll();
    } catch (err) {
      console.error(err);
      toast('Não foi possível montar esta tela.', 'err');
    }
    mainEl.getAnimations().forEach((animation) => animation.cancel());

    if (canAnimate) {
      mainEl.animate(
        [
          { opacity: 0, transform: 'translateY(-7px)' },
          { opacity: 1, transform: 'translateY(0)' },
        ],
        { duration: 210, easing: 'cubic-bezier(0.2, 0.7, 0.25, 1)' }
      );
    }
    if (ui.route.name === 'dashboard') staggerDashboard();
  } finally {
    mainEl.style.pointerEvents = '';
    navigating = false;
  }

  if (pendingRoute) {
    pendingRoute = false;
    handleRouteChange();
  }
}

function closeDialogs() {
  document.querySelectorAll('dialog[open]').forEach((dialog) => dialog.close());
}

/** Entrada em cascata dos blocos do painel (só na troca de tela, não a cada salvamento). */
function staggerDashboard() {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const root = mainEl.firstElementChild;
  if (!root) return;
  const blocks = [...root.children].filter((el) => el instanceof HTMLElement);
  blocks.forEach((el, index) => {
    el.style.animation = `content-rise 0.5s cubic-bezier(0.22, 0.61, 0.36, 1) ${
      Math.min(index, 5) * 0.06
    }s both`;
  });
  setTimeout(() => {
    blocks.forEach((el) => {
      el.style.animation = '';
    });
  }, 1200);
}

/* -------------------------------------------------------------- render */

function screenLabel(route = ui.route) {
  return SCREEN_LABEL[route.name] || 'Painel';
}

function brandHtml() {
  return (
    `<span class="brand__mark">SCAD</span>` +
    `<span class="brand__rule" aria-hidden="true"></span>` +
    `<span class="brand__descr">Controle de análise documental</span>`
  );
}

function renderAll({ preserveScroll = false } = {}) {
  const y = window.scrollY;
  renderMasthead();
  renderNav();
  document.body.classList.toggle('nav-hidden', !navReady);
  mainEl.innerHTML = renderView();
  document.title = `${screenLabel()} · SCAD`;
  if (preserveScroll) window.scrollTo(0, y);
  else window.scrollTo(0, 0);
  syncPresence();
}

function renderView() {
  const state = getState();
  if (!state) return '';
  if (ui.route.name === 'collections') return renderCollections(state);
  if (ui.route.name === 'collection') return renderCollection(state, ui.route.id);
  if (!state.process) {
    if ((state.collections || []).length) return renderCollections(state);
    return renderOnboarding(state);
  }
  switch (ui.route.name) {
    case 'documents':
      return renderDocuments(state);
    case 'document':
      return renderDocument(state, ui.route.id);
    case 'workbench':
      return renderWorkbench(state);
    case 'findings':
      return renderFindings(state);
    case 'settings':
      return renderSettings(state);
    default:
      return renderDashboard(state);
  }
}

function routeIsProcess() {
  return !['collections', 'collection'].includes(ui.route.name);
}

function metaLine(state) {
  const s = overall(state);
  const sep = `<span aria-hidden="true">·</span>`;
  switch (ui.route.name) {
    case 'documents':
      return `<span>${plural(s.docs, 'arquivo', 'arquivos')}</span>${sep}<span>${plural(
        s.pendingDocs,
        'com pendência',
        'com pendências'
      )}</span>`;
    case 'document': {
      const doc = docById(state, ui.route.id);
      const index = doc ? state.documents.findIndex((d) => d.id === doc.id) : -1;
      return `<span>documento ${index + 1} de ${state.documents.length}</span>${sep}<span>${plural(
        s.pending,
        'verificação pendente',
        'verificações pendentes'
      )}</span>`;
    }
    case 'workbench':
      return `<span><b>${s.done}</b> de ${s.total} verificações</span>${sep}<span>${plural(
        s.pending,
        'pendente',
        'pendentes'
      )}</span>`;
    case 'findings':
      return `<span><b>${s.nc}</b> não conformes</span>${sep}<span><b>${s.obs}</b> observações</span>`;
    case 'settings':
      return `<span>${plural(criteriaSorted(state).length, 'critério', 'critérios')}</span>${sep}<span>${plural(
        s.docs,
        'documento',
        'documentos'
      )}</span>`;
    default:
      return `<span>${plural(s.docs, 'documento', 'documentos')}</span>${sep}<span>${plural(
        s.total,
        'verificação',
        'verificações'
      )}</span>${sep}<span>${s.pct}% concluído</span>`;
  }
}

function renderMasthead() {
  const state = getState();
  const browsing = ['collections', 'collection'].includes(ui.route.name);
  const showProcess = Boolean(state?.process) && !browsing;

  if (!showProcess) {
    if (mastheadMode !== 'bare') {
      mastheadMode = 'bare';
      mastEl.className = 'masthead masthead--bare';
      mastEl.innerHTML =
        `<div class="masthead__inner"><div class="masthead__top">` +
        `<a class="brand" href="${browsing ? '#/colecoes' : '#/'}" aria-label="Início">${brandHtml()}</a>` +
        `<div class="masthead__tools">${profileChipHtml()}</div>` +
        `</div></div>`;
    }
    syncProfileChip();
    return;
  }

  if (mastheadMode !== 'process') {
    mastheadMode = 'process';
    mastEl.className = 'masthead';
    mastEl.innerHTML =
      `<div class="masthead__inner">` +
      `<div class="masthead__top">` +
      `<a class="brand" href="#/" aria-label="Ir para o painel">${brandHtml()}</a>` +
      `<div class="masthead__tools">` +
      `<a class="iconbtn iconbtn--onink" href="#/ajustes" aria-label="Ajustes do processo" title="Ajustes">${icon(
        'settings',
        18
      )}</a>` +
      profileChipHtml() +
      `</div></div>` +
      `<div class="masthead__context">` +
      `<div>` +
      `<a class="masthead__back" href="#/colecoes/${state.collection?.id || ''}" data-mast-back>${icon(
        'arrowLeft',
        12
      )} <span data-mast-back-label></span></a>` +
      `<p class="eyebrow eyebrow--onink" data-mast-eyebrow></p>` +
      `<h1 class="masthead__title" data-mast-title></h1>` +
      `<p class="masthead__meta" data-mast-meta></p>` +
      `</div>` +
      `<div class="masthead__gauge" data-mast-gauge>` +
      `<span class="masthead__pct"><span data-mast-pct>0</span><em>%</em></span>` +
      `<span class="masthead__pct-label">concluído</span>` +
      `<div class="meter"><div class="meter__fill" data-mast-fill></div></div>` +
      `</div>` +
      `</div></div>`;
  }

  const s = overall(state);
  const collection = state.collection;
  const process = state.process;
  const back = mastEl.querySelector('[data-mast-back]');
  const backLabel = mastEl.querySelector('[data-mast-back-label]');
  if (back) {
    back.setAttribute('href', `#/colecoes/${collection?.id || ''}`);
    back.setAttribute('title', collection ? `Voltar para os processos de ${collection.name}` : 'Voltar para os processos');
    back.setAttribute('aria-label', collection ? `Voltar para os processos de ${collection.name}` : 'Voltar para os processos');
  }
  if (backLabel) backLabel.textContent = 'Voltar para processos';
  const eyebrow = mastEl.querySelector('[data-mast-eyebrow]');
  const eyebrowText = screenLabel();
  if (eyebrow && eyebrow.textContent !== eyebrowText) eyebrow.textContent = eyebrowText;
  const title = mastEl.querySelector('[data-mast-title]');
  // Coleção + processo: deixa claro em que arquivo e processo se está trabalhando.
  const titleText = collection ? `${collection.name} - ${process.name}` : process.name;
  if (title && title.textContent !== titleText) title.textContent = titleText;
  const meta = mastEl.querySelector('[data-mast-meta]');
  if (meta) meta.innerHTML = metaLine(state);
  const pct = mastEl.querySelector('[data-mast-pct]');
  const fill = mastEl.querySelector('[data-mast-fill]');
  const gauge = mastEl.querySelector('[data-mast-gauge]');
  if (pct) pct.textContent = String(s.pct);
  if (fill) fill.style.width = `${s.pct}%`;
  if (gauge) gauge.setAttribute('aria-label', `${s.pct}% das verificações concluídas`);
  syncProfileChip();
}

function profileChipHtml() {
  return (
    `<button type="button" class="profile-chip" data-action="switch-profile" title="Trocar perfil">` +
    `<span class="profile-chip__dot" aria-hidden="true"></span>` +
    `<span class="profile-chip__name" data-profile-name>—</span>` +
    `<span class="profile-chip__role" data-profile-role></span>` +
    `</button>`
  );
}

function syncProfileChip() {
  const profile = currentProfile();
  const name = mastEl.querySelector('[data-profile-name]');
  const role = mastEl.querySelector('[data-profile-role]');
  if (name) name.textContent = profile ? profile.name : 'Escolher perfil';
  if (role) role.textContent = profile ? (profile.role === 'reviewer' ? 'revisor' : 'analista') : '';
  const chip = mastEl.querySelector('[data-profile-name]')?.closest('.profile-chip');
  if (chip) chip.title = profile ? `Usando como ${profile.name} — trocar` : 'Escolher perfil';
}

function ensureNav() {
  const state = getState();
  const visible = Boolean(state?.process) && routeIsProcess();
  if (!visible) {
    if (navReady) {
      navSlot.innerHTML = '';
      navReady = false;
      navEl = null;
      pillEl = null;
      navActive = null;
    }
    return false;
  }

  if (!navReady) {
    navReady = true;
    navActive = null;
    navSlot.innerHTML =
      `<div class="nav-shell nav-shell--enter"><nav class="nav" aria-label="Navegação principal">` +
      `<span class="nav__pill" aria-hidden="true"></span>` +
      NAV.map(
        (item) =>
          `<a class="nav__link" href="${item.href}" data-nav="${item.id}">` +
          `${icon(item.icon, 20)}<span class="nav__label">${item.label}</span></a>`
      ).join('') +
      `</nav></div>`;
    navEl = navSlot.querySelector('.nav');
    pillEl = navSlot.querySelector('.nav__pill');
    updatePill();
    const shell = navSlot.querySelector('.nav-shell');
    setTimeout(() => {
      shell?.classList.remove('nav-shell--enter');
      updatePill();
      trackPill(260);
    }, NAV_ENTER_MS);
  }
  return true;
}

function updatePill() {
  if (!navEl || !pillEl) return;
  const active = navEl.querySelector('.nav__link[aria-current="page"]');
  if (!active) {
    pillEl.style.opacity = '0';
    return;
  }
  const navRect = navEl.getBoundingClientRect();
  const rect = active.getBoundingClientRect();
  // A cápsula pode estar escalada durante a entrada: converter a medida atual
  // para o espaço de layout mantém a pílula no lugar certo mesmo animando.
  const scale = navEl.offsetWidth ? navRect.width / navEl.offsetWidth : 1;
  const factor = scale > 0 ? scale : 1;
  pillEl.style.opacity = '1';
  pillEl.style.top = `${(rect.top - navRect.top) / factor - navEl.clientTop}px`;
  pillEl.style.height = `${rect.height / factor}px`;
  pillEl.style.width = `${rect.width / factor}px`;
  pillEl.style.transform = `translate3d(${(rect.left - navRect.left) / factor - navEl.clientLeft}px, 0, 0)`;
}

function trackPill(duration = 320) {
  if (!navEl || !pillEl) return;
  cancelAnimationFrame(pillTrack);
  const started = performance.now();
  const step = (now) => {
    updatePill();
    if (now - started < duration) pillTrack = requestAnimationFrame(step);
  };
  pillTrack = requestAnimationFrame(step);
}

function renderNav() {
  if (!ensureNav()) return;

  const state = getState();
  const s = overall(state);
  const badges = { workbench: s.pendingDocs, findings: s.nc + s.obs };
  const active = ACTIVE_NAV[ui.route.name] || 'dashboard';
  const activeChanged = navActive !== active;
  navActive = active;

  navEl.querySelectorAll('.nav__link').forEach((link) => {
    const id = link.dataset.nav;
    const current = id === active;
    if (current) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');

    const count = badges[id] || 0;
    let badge = link.querySelector('.nav__badge');
    if (count > 0) {
      if (!badge) {
        badge = document.createElement('span');
        badge.className = 'nav__badge';
        link.append(badge);
      }
      const text = count > 99 ? '99+' : fmtInt(count);
      if (badge.textContent !== text) badge.textContent = text;
    } else if (badge) {
      badge.remove();
    }

    const item = NAV.find((entry) => entry.id === id);
    const word = id === 'findings' ? 'apontamento' : 'pendente';
    const label = `${item ? item.label : ''}${
      count ? `, ${count} ${word}${count === 1 ? '' : 's'}` : ''
    }`;
    if (link.getAttribute('aria-label') !== label) link.setAttribute('aria-label', label);
  });

  updatePill();
  if (activeChanged) requestAnimationFrame(() => trackPill(320));
}

/* ------------------------------------------------------------- eventos */

function bindEvents() {
  // No Safari/Chrome a troca de hash dispara `hashchange` e `popstate` para a
  // mesma navegação; sem deduplicar, a tela era montada duas vezes (a animação
  // de entrada sumia e o cursor de digitação era perdido).
  let lastHash = null;
  let lastHashAt = 0;
  const onHashEvent = () => {
    const hash = location.hash || '#/';
    const at = performance.now();
    if (hash === lastHash && at - lastHashAt < 150) return;
    lastHash = hash;
    lastHashAt = at;
    handleRouteChange();
  };
  window.addEventListener('hashchange', onHashEvent);
  window.addEventListener('popstate', onHashEvent);

  window.addEventListener('resize', () => {
    if (navReady) updatePill();
  });

  window.addEventListener('scroll', () => {
    if (!getState()?.process) return;
    clearTimeout(scrollSaveTimer);
    scrollSaveTimer = setTimeout(saveSession, 500);
  }, { passive: true });

  window.addEventListener('online', () => toast('Conexão restabelecida.', 'ok'));
  window.addEventListener('offline', () => toast('Sem conexão com o servidor local.', 'err'));

  document.addEventListener('click', (event) => {
    const target = event.target.closest('[data-action]');
    if (!target) return;
    const handler = ACTIONS[target.dataset.action];
    if (!handler) return;
    event.preventDefault();
    Promise.resolve(handler(target, event)).catch((err) => {
      console.error(err);
      toast(err?.message || 'Não foi possível concluir a ação.', 'err');
    });
  });

  // Navegação interna sempre pela mesma página: no iPad o Safari recarregava o
  // documento ao seguir links de hash (tela de carregamento e filtros perdidos).
  document.addEventListener('click', (event) => {
    if (event.defaultPrevented || event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const link = event.target instanceof Element ? event.target.closest('a[href^="#"]') : null;
    if (!link) return;
    if (link.target && link.target !== '' && link.target !== '_self') return;
    const hash = link.getAttribute('href');
    if (!hash || hash === '#') return;
    event.preventDefault();
    navigate(hash);
  });

  document.addEventListener('input', (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (target.matches('[data-filter="doc-query"]')) {
      ui.docQuery = target.value;
      refreshDocList();
      scheduleSessionSave();
    } else if (target.matches('[data-filter="find-query"]')) {
      ui.findQuery = target.value;
      refreshFindings();
      scheduleSessionSave();
    } else if (target.matches('[data-note-id]')) {
      queueNote(target);
    }
  });

  document.addEventListener('change', (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (target.name === 'preset' && target.type === 'radio') {
      const preset = PRESET_LIST.find((p) => p.id === target.value);
      if (preset) setChips(preset.items);
    } else if (target.matches('[data-criterion-label]')) {
      saveCriterionLabel(target);
    } else if (target.id === 'restore-input') {
      const file = target.files?.[0];
      target.value = '';
      if (file) restoreBackup(file);
    }
  });

  document.addEventListener('submit', (event) => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement)) return;
    if (form.id === 'onboard-form') {
      event.preventDefault();
      createProcess(form);
    } else if (form.id === 'process-form') {
      event.preventDefault();
      saveProcess(form);
    } else if (form.id === 'criterion-form') {
      event.preventDefault();
      addCriterion(form);
    }
  });

  document.addEventListener('keydown', onKeydown);

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      syncIfIdle();
      heartbeatPresence();
    }
  });

  window.addEventListener('pagehide', () => {
    try {
      const docId = presenceRouteDoc();
      if (!docId) return;
      const headers = { 'Content-Type': 'application/json' };
      if (ui.profileId) headers['X-SCAD-Actor'] = ui.profileId;
      const pid = getState()?.process?.id;
      if (pid) headers['X-SCAD-Process'] = pid;
      fetch('/api/presence', {
        method: 'POST',
        keepalive: true,
        headers,
        body: JSON.stringify({ docId: null }),
      }).catch(() => {});
    } catch {
      /* saída best-effort */
    }
  });
}

function onKeydown(event) {
  if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
  if (document.querySelector('dialog[open]')) return;
  if (ui.route.name !== 'workbench') return;
  if (!getState()?.process || isEditing()) return;

  const rows = [...document.querySelectorAll('.check[data-check-row]')];
  if (!rows.length) return;
  const focusedRow = document.activeElement?.closest?.('.check') || null;

  if (['1', '2', '3'].includes(event.key)) {
    event.preventDefault();
    const status = ['ok', 'nc', 'obs'][Number(event.key) - 1];
    const target =
      focusedRow ||
      rows.find((row) => (row.getAttribute('aria-label') || '').includes('Pendente')) ||
      rows[0];
    setCheckStatus(target.dataset.checkRow, status);
    return;
  }

  if (event.key === 'j' || event.key === 'J' || event.key === 'ArrowDown') {
    event.preventDefault();
    moveRowFocus(rows, focusedRow, 1);
    return;
  }

  if (event.key === 'k' || event.key === 'K' || event.key === 'ArrowUp') {
    event.preventDefault();
    moveRowFocus(rows, focusedRow, -1);
    return;
  }

  if (event.key === 'n' || event.key === 'N') {
    event.preventDefault();
    const next = nextPendingDoc(getState(), ui.route.id);
    if (next) navigate(`#/analisar/${next.id}`);
    else toast('Nenhum documento pendente.');
  }
}

function moveRowFocus(rows, focusedRow, delta) {
  const index = focusedRow ? rows.indexOf(focusedRow) : -1;
  const nextIndex = Math.max(0, Math.min(rows.length - 1, index + delta));
  const next = rows[nextIndex];
  next.focus({ preventScroll: true });
  next.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

/* ------------------------------------------------------------- ações */

function showProfilePicker(profiles = []) {
  const options = profiles
    .map(
      (profile) =>
        `<button type="button" class="profile-option" data-profile-id="${profile.id}">` +
        `<span class="profile-option__name">${esc(profile.name)}</span>` +
        `<span class="stamp stamp--quiet">${profile.role === 'reviewer' ? 'revisor' : 'analista'}</span>` +
        `</button>`
    )
    .join('');
  const dialog = openSheet({
    title: 'Quem está usando o SCAD?',
    eyebrow: 'Perfil',
    body:
      (options || `<p class="sheet-message">Nenhum perfil cadastrado.</p>`) +
      `<p class="sheet__note">O nome identifica suas ações no histórico. Você pode trocar depois pelo cabeçalho.</p>`,
    footer: `<button type="button" class="btn btn--ghost" data-close-profile>Só olhando</button>`,
  });
  dialog.querySelectorAll('[data-profile-id]').forEach((button) => {
    button.addEventListener('click', () => {
      const profile = profiles.find((item) => item.id === button.dataset.profileId);
      setProfile(button.dataset.profileId);
      configureApi({ actor: button.dataset.profileId });
      dialog.close();
      syncProfileChip();
      heartbeatPresence();
      renderAll({ preserveScroll: true });
      if (profile) toast(`Perfil ativo: ${profile.name}`);
    });
  });
  dialog.querySelector('[data-close-profile]')?.addEventListener('click', () => dialog.close());
}

async function openProcess(processId) {
  if (!processId) return;
  try {
    const next = await api.state(processId);
    setState(next);
    setActiveProcess(processId);
    configureApi({ process: processId, actor: currentProfile()?.id || null });
    ui.docFilter = 'all';
    ui.docQuery = '';
    ui.queueAll = false;
    ui.queueReview = false;
    saveSession();
    navigate('#/', { force: true });
  } catch (err) {
    toast(err.message, 'err');
  }
}

function showNewCollection() {
  const dialog = openSheet({
    title: 'Nova coleção',
    eyebrow: 'Arquivo',
    body:
      `<div class="field"><label for="collection-name">Nome da coleção</label>` +
      `<input id="collection-name" type="text" maxlength="120" placeholder="Ex.: ISO 9001:2015" autocomplete="off"></div>` +
      `<div class="field"><label for="collection-desc">Descrição <span class="field__optional">opcional</span></label>` +
      `<textarea id="collection-desc" rows="2" maxlength="600" placeholder="Certificação, período, escopo…"></textarea></div>`,
    footer:
      `<button type="button" class="btn btn--ghost" data-cancel>Cancelar</button>` +
      `<button type="button" class="btn btn--primary" data-save>${icon('plus', 15)} Criar coleção</button>`,
  });
  const nameInput = dialog.querySelector('#collection-name');
  nameInput?.focus();
  dialog.querySelector('[data-cancel]')?.addEventListener('click', () => dialog.close());
  dialog.querySelector('[data-save]')?.addEventListener('click', async () => {
    try {
      const res = await api.createCollection({
        name: nameInput.value,
        description: dialog.querySelector('#collection-desc').value,
      });
      setState(res.state);
      dialog.close();
      if (res.createdCollection) navigate(`#/colecoes/${res.createdCollection.id}`);
      else renderAll({ preserveScroll: true });
      toast('Coleção criada.');
    } catch (err) {
      toast(err.message, 'err');
    }
  });
}

function showNewProcess(collectionId) {
  const state = getState();
  const processes = state.processes || [];
  const sourceOptions = processes
    .map(
      (process) =>
        `<option value="${process.id}">${esc(process.name)}</option>`
    )
    .join('');

  const dialog = openSheet({
    title: 'Novo processo',
    eyebrow: state.collections?.find((item) => item.id === collectionId)?.name || 'Coleção',
    body:
      `<div class="field"><label for="proc-name">Nome do processo</label>` +
      `<input id="proc-name" type="text" maxlength="120" placeholder="Ex.: POP, DC, Organograma" autocomplete="off"></div>` +
      `<div class="field"><label for="proc-flow">Fluxo do processo</label>` +
      `<select id="proc-flow">` +
      `<option value="documents">Documentos</option>` +
      `<option value="requirements">Listagem</option>` +
      `</select></div>` +
      `<div class="field" id="proc-custom-wrap" hidden><span class="field__label">Status personalizados <span class="field__optional">opcional · até 2</span></span>` +
      `<div id="cs-list" class="cs-list"></div>` +
      `<div id="cs-add-row" class="cs-add-row" hidden>` +
      `<input id="cs-input" type="text" class="input" maxlength="40" placeholder="Nome do status" autocomplete="off">` +
      `<button type="button" class="iconbtn" id="cs-confirm" aria-label="Salvar status">${icon('check', 17)}</button>` +
      `<button type="button" class="iconbtn" id="cs-cancel" aria-label="Cancelar">${icon('close', 17)}</button>` +
      `</div>` +
      `<button type="button" class="btn btn--ghost btn--sm" id="cs-add">${icon('plus', 14)} Adicionar status personalizado</button>` +
      `<p class="field__hint" id="cs-limit" hidden>Limite de 2 atingido — remova um para trocar.</p>` +
      `</div>` +
      `<div class="field"><label for="proc-desc">Descrição <span class="field__optional">opcional</span></label>` +
      `<textarea id="proc-desc" rows="2" maxlength="1000" placeholder="Objetivo ou escopo deste processo"></textarea></div>` +
      `<div class="field"><label for="proc-source">Copiar critérios de</label>` +
      `<select id="proc-source"><option value="">Começar sem critérios</option>${sourceOptions}</select>` +
      `<p class="field__hint">Marque abaixo quais critérios copiar; é só uma cópia, os processos continuam independentes.</p></div>` +
      `<div id="copy-criteria" class="copy-criteria"></div>`,
    footer:
      `<button type="button" class="btn btn--ghost" data-cancel>Cancelar</button>` +
      `<button type="button" class="btn btn--primary" data-save>${icon('plus', 15)} Criar processo</button>`,
  });

  const flowSelect = dialog.querySelector('#proc-flow');
  const customWrap = dialog.querySelector('#proc-custom-wrap');
  const csList = dialog.querySelector('#cs-list');
  const csAddRow = dialog.querySelector('#cs-add-row');
  const csAddBtn = dialog.querySelector('#cs-add');
  const csLimit = dialog.querySelector('#cs-limit');
  const csInput = dialog.querySelector('#cs-input');
  const csConfirm = dialog.querySelector('#cs-confirm');
  const csCancel = dialog.querySelector('#cs-cancel');
  const customLabels = [];

  const renderCustom = () => {
    if (csList) {
      csList.innerHTML = customLabels
        .map(
          (label, index) =>
            `<span class="cs-chip"><span>${esc(label)}</span>` +
            `<button type="button" class="cs-chip__x" data-cs-remove="${index}" aria-label="Remover ${esc(label)}">${icon('close', 13)}</button></span>`
        )
        .join('');
    }
    const full = customLabels.length >= 2;
    if (csAddBtn) csAddBtn.hidden = full;
    if (csLimit) csLimit.hidden = !full;
    // Ao encher a lista, a linha de digitação não pode ficar aberta.
    if (full && csAddRow) csAddRow.hidden = true;
  };
  const toggleCustom = () => {
    if (customWrap) customWrap.hidden = flowSelect?.value !== 'requirements';
  };

  flowSelect?.addEventListener('change', toggleCustom);
  toggleCustom();

  csAddBtn?.addEventListener('click', () => {
    csAddRow?.removeAttribute('hidden');
    csAddBtn.hidden = true;
    csInput?.focus();
  });
  csCancel?.addEventListener('click', () => {
    if (csInput) csInput.value = '';
    csAddRow?.setAttribute('hidden', '');
    if (csAddBtn && customLabels.length < 2) csAddBtn.hidden = false;
  });
  const confirmCustom = () => {
    const label = (csInput?.value || '').trim().replace(/\s+/g, ' ');
    if (label.length < 2) { toast('Dê um nome ao status.', 'err'); csInput?.focus(); return; }
    if (label.length > 40) { toast('Máximo de 40 caracteres.', 'err'); csInput?.focus(); return; }
    if (customLabels.some((item) => item.toLowerCase() === label.toLowerCase())) { toast('Esse status já foi adicionado.', 'err'); csInput?.focus(); return; }
    if (customLabels.length >= 2) { toast('Máximo de 2 status personalizados.', 'err'); return; }
    customLabels.push(label);
    if (csInput) csInput.value = '';
    csAddRow?.setAttribute('hidden', '');
    renderCustom();
  };
  csConfirm?.addEventListener('click', confirmCustom);
  csInput?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') { event.preventDefault(); confirmCustom(); }
    if (event.key === 'Escape') csCancel?.click();
  });
  csList?.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target.closest('[data-cs-remove]') : null;
    if (!target) return;
    const index = Number(target.dataset.csRemove);
    if (Number.isInteger(index) && index >= 0) {
      customLabels.splice(index, 1);
      renderCustom();
    }
  });

  const source = dialog.querySelector('#proc-source');
  const criteriaBox = dialog.querySelector('#copy-criteria');
  const renderCriteria = () => {
    const pid = source.value;
    const list = (state.criteriaCatalog || []).filter((criterion) => criterion.processId === pid);
    criteriaBox.innerHTML = list.length
      ? `<p class="copy-criteria__title">Critérios disponíveis</p>` +
        list
          .map(
            (criterion) =>
              `<label class="check-option"><input type="checkbox" value="${criterion.id}" checked>${esc(
                criterion.label
              )}</label>`
          )
          .join('')
      : '';
  };
  source?.addEventListener('change', renderCriteria);
  renderCriteria();
  dialog.querySelector('#proc-name')?.focus();

  dialog.querySelector('[data-cancel]')?.addEventListener('click', () => dialog.close());
  dialog.querySelector('[data-save]')?.addEventListener('click', async () => {
    const name = dialog.querySelector('#proc-name').value.trim();
    if (!name) {
      toast('Dê um nome ao processo.', 'err');
      dialog.querySelector('#proc-name').focus();
      return;
    }
    const catalog = new Map((state.criteriaCatalog || []).map((criterion) => [criterion.id, criterion]));
    const criteria = [...criteriaBox.querySelectorAll('input[type="checkbox"]:checked')]
      .map((input) => catalog.get(input.value))
      .filter(Boolean)
      .map((criterion) => ({ label: criterion.label, hint: criterion.hint || '' }));
    const flow = dialog.querySelector('#proc-flow')?.value || 'documents';
    const customStatuses =
      flow === 'requirements' ? customLabels.map((label) => ({ label })) : [];
    try {
      const res = await api.createProcess({
        collectionId,
        name,
        description: dialog.querySelector('#proc-desc').value,
        criteria,
        flow,
        customStatuses,
      });
      setState(res.state);
      if (res.createdProcess) {
        setActiveProcess(res.createdProcess.id);
        configureApi({ process: res.createdProcess.id });
      }
      dialog.close();
      ui.docFilter = 'all';
      ui.docQuery = '';
      ui.queueAll = false;
      saveSession();
      navigate('#/', { force: true });
      toast('Processo criado.');
    } catch (err) {
      toast(err.message, 'err');
    }
  });
}

function showCopyCriteria() {
  const state = getState();
  const process = state.process;
  if (!process) return;
  const sources = (state.processes || []).filter((item) => item.id !== process.id);
  if (!sources.length) {
    toast('Não há outro processo para copiar critérios.', 'err');
    return;
  }
  const sourceOptions = sources
    .map((item) => `<option value="${item.id}">${esc(item.name)}</option>`)
    .join('');
  const dialog = openSheet({
    title: 'Copiar critérios',
    eyebrow: process.name,
    body:
      `<div class="field"><label for="copy-source">Processo de origem</label>` +
      `<select id="copy-source">${sourceOptions}</select></div>` +
      `<div class="copy-criteria" id="copy-list"></div>` +
      `<p class="sheet__note">A cópia é independente: alterar um critério aqui não muda o processo de origem.</p>`,
    footer:
      `<button type="button" class="btn btn--ghost" data-cancel>Cancelar</button>` +
      `<button type="button" class="btn btn--primary" data-copy>Copiar selecionados</button>`,
  });
  const select = dialog.querySelector('#copy-source');
  const list = dialog.querySelector('#copy-list');
  const renderList = () => {
    const criteria = (state.criteriaCatalog || []).filter((item) => item.processId === select.value);
    list.innerHTML = criteria.length
      ? `<p class="copy-criteria__title">Critérios disponíveis</p>` +
        criteria
          .map(
            (criterion) =>
              `<label class="check-option"><input type="checkbox" value="${criterion.id}" checked>${esc(
                criterion.label
              )}</label>`
          )
          .join('')
      : `<p class="field__hint">O processo de origem não tem critérios.</p>`;
  };
  select.addEventListener('change', renderList);
  renderList();
  dialog.querySelector('[data-cancel]')?.addEventListener('click', () => dialog.close());
  dialog.querySelector('[data-copy]')?.addEventListener('click', async () => {
    const ids = [...list.querySelectorAll('input[type="checkbox"]:checked')].map((input) => input.value);
    if (!ids.length) {
      toast('Selecione ao menos um critério.', 'err');
      return;
    }
    try {
      const res = await api.copyCriteria({
        targetProcessId: process.id,
        sourceProcessId: select.value,
        criterionIds: ids,
      });
      setState(res.state);
      dialog.close();
      renderAll({ preserveScroll: true });
      toast(res.copied ? `Critérios copiados: ${res.copied}` : 'Nenhum critério novo.');
    } catch (err) {
      toast(err.message, 'err');
    }
  });
}

/* -------------------------------------------------------------- revisão */

function openApproveReview(docId, { onDone = null } = {}) {
  const state = getState();
  const doc = docById(state, docId);
  if (!doc) return;
  if (currentProfile(state)?.role !== 'reviewer') {
    toast('Apenas o revisor (Diogenes) aprova documentos.', 'err');
    return;
  }
  const review = reviewOfDoc(state, docId);
  if (review.status === 'analysis') {
    toast('Ainda há verificações pendentes neste documento.', 'err');
    return;
  }
  if (review.status === 'attention' || review.flagged) {
    toast('Este documento tem sinalizações: o analista precisa corrigir antes de aprovar.', 'err');
    return;
  }
  const nextVersion = doc.correction ? correctionVersion(doc) : null;
  const dialog = openSheet({
    title: 'Aprovar documento',
    eyebrow: 'Revisão',
    body:
      `<p class="sheet-message">${esc(doc.name)}</p>` +
      `<p class="sheet__note">${review.done} verificações serão marcadas como aprovadas${
        review.flagged ? ` — a sinalização de ${review.flagged} critério(s) será substituída pela aprovação` : ''
      }. A mensagem é opcional.</p>` +
      (doc.correction
        ? `<p class="sheet__note sheet__note--warn">A correção pendente será promovida a <b>v${nextVersion}</b> e a versão atual fica arquivada para comparação.</p>`
        : '') +
      (doc.reopen
        ? `<p class="sheet__note">Revisão reaberta por ${esc(doc.reopen.byName || 'revisor')}: ${esc(doc.reopen.reason)}</p>`
        : '') +
      `<div class="field"><label for="review-approve-message">Mensagem <span class="field__optional">opcional</span></label>` +
      `<textarea id="review-approve-message" rows="3" maxlength="2000" placeholder="Ex.: revisado, sem pendências."></textarea></div>`,
    footer:
      `<button type="button" class="btn btn--ghost" data-cancel>Cancelar</button>` +
      `<button type="button" class="btn btn--primary" data-confirm>${icon('check', 16)} Aprovar documento</button>`,
  });
  dialog.querySelector('[data-cancel]')?.addEventListener('click', () => dialog.close());
  const confirm = dialog.querySelector('[data-confirm]');
  confirm?.addEventListener('click', async () => {
    const message = (dialog.querySelector('#review-approve-message')?.value || '').trim();
    confirm.disabled = true;
    try {
      const res = await api.approveReview(doc.id, message);
      setState(res.state);
      dialog.close();
      renderAll({ preserveScroll: true });
      toast(doc.correction ? `Documento aprovado — versão v${nextVersion} publicada.` : 'Documento aprovado.');
      if (typeof onDone === 'function') onDone();
    } catch (err) {
      confirm.disabled = false;
      toast(err.message, 'err');
    }
  });
}

function openFlagReview(docId, checkId, { onDone = null } = {}) {
  const state = getState();
  const doc = docById(state, docId);
  const check = (state.checks || []).find((item) => item.id === checkId);
  if (!doc || !check) return;
  if (currentProfile(state)?.role !== 'reviewer') {
    toast('Apenas o revisor (Diogenes) sinaliza critérios.', 'err');
    return;
  }
  const criterion = (state.criteria || []).find((item) => item.id === check.criterionId);
  const dialog = openSheet({
    title: 'Sinalizar critério',
    eyebrow: `Revisão · ${criterion?.label || 'critério'}`,
    body:
      `<p class="sheet-message">${esc(doc.name)}</p>` +
      `<p class="sheet__note">O critério fica em <b>atenção</b> e os demais verificados são aprovados. A mensagem é obrigatória e fica visível para o analista.</p>` +
      `<div class="field"><label for="review-flag-message">O que precisa ser corrigido?</label>` +
      `<textarea id="review-flag-message" rows="3" maxlength="2000" placeholder="Ex.: a nota não cita a evidência do relatório."></textarea>` +
      `<p class="field__hint" data-flag-hint>Escreva a mensagem para sinalizar.</p></div>`,
    footer:
      `<button type="button" class="btn btn--ghost" data-cancel>Cancelar</button>` +
      `<button type="button" class="btn btn--danger" data-confirm disabled>${icon('flag', 15)} Sinalizar</button>`,
  });
  const area = dialog.querySelector('#review-flag-message');
  const confirm = dialog.querySelector('[data-confirm]');
  const hint = dialog.querySelector('[data-flag-hint]');
  const sync = () => {
    const ready = (area?.value || '').trim().length >= 3;
    if (confirm) confirm.disabled = !ready;
    if (hint) {
      hint.textContent = ready
        ? 'A mensagem aparece no critério para o analista.'
        : 'Escreva a mensagem para sinalizar.';
    }
  };
  area?.addEventListener('input', sync);
  dialog.querySelector('[data-cancel]')?.addEventListener('click', () => dialog.close());
  confirm?.addEventListener('click', async () => {
    const message = (area?.value || '').trim();
    if (!message) return;
    confirm.disabled = true;
    try {
      const res = await api.flagReview(doc.id, check.id, message, check.updatedAt);
      setState(res.state);
      dialog.close();
      renderAll({ preserveScroll: true });
      toast('Critério sinalizado.');
      if (typeof onDone === 'function') onDone();
    } catch (err) {
      confirm.disabled = false;
      toast(err.message, 'err');
    }
  });
  setTimeout(() => area?.focus(), 80);
}

/* ------------------------------------------------------------- presença */

/** Documento em que estou trabalhando (registra a minha presença). */
function presenceRouteDoc() {
  const state = getState();
  if (!state?.process) return null;
  if (ui.route.name === 'document') return ui.route.id;
  if (ui.route.name === 'workbench') {
    const doc = resolveWorkbenchDoc(state);
    return doc?.id || null;
  }
  return null;
}

/**
 * Três modos: `doc` registra onde estou; `watch` só observa a matriz
 * (painel); nenhum outro limpa a presença. A matriz é onde o outro se vê.
 */
function presenceMode() {
  if (presenceRouteDoc()) return 'doc';
  if (ui.route.name === 'dashboard' && getState()?.process) return 'watch';
  return null;
}

function syncPresence() {
  const mode = presenceMode();
  const docId = mode === 'doc' ? presenceRouteDoc() : null;
  if (mode === presenceModeName && docId === presenceDocId && presenceTimer) return;
  stopPresence();
  presenceModeName = mode;
  presenceDocId = docId;
  if (!mode) {
    if (ui.presence.length) {
      ui.presence = [];
      refreshPresence();
    }
    return;
  }
  heartbeatPresence();
  presenceTimer = setInterval(heartbeatPresence, 12000);
}

function stopPresence() {
  clearInterval(presenceTimer);
  presenceTimer = 0;
}

async function heartbeatPresence() {
  const mode = presenceMode();
  if (!mode || document.hidden) return;
  try {
    const res = await api.presence(mode === 'doc' ? presenceRouteDoc() : null);
    const next = Array.isArray(res?.present) ? res.present : [];
    if (JSON.stringify(next) === JSON.stringify(ui.presence)) return;
    ui.presence = next;
    refreshPresence();
  } catch {
    /* presença é acessório: falhas não interrompem o trabalho */
  }
}

function refreshPresence() {
  document.querySelectorAll('[data-presence]').forEach((node) => {
    const docId = node.getAttribute('data-presence');
    node.innerHTML = presenceLine(docId);
  });
}

const ACTIONS = {
  'open-collection': (el) => navigate(`#/colecoes/${el.dataset.id}`),
  'copy-criteria': () => showCopyCriteria(),
  'open-process': (el) => openProcess(el.dataset.id),
  'new-collection': () => showNewCollection(),
  'new-process': (el) => showNewProcess(el.dataset.collectionId),
  'switch-profile': () => showProfilePicker(getState()?.profiles || []),
  'open-import': () => openImportDialog(),
  'open-item-dialog': () => openItemDialog(),
  'evidence-delete': (el) => removeEvidence(el?.dataset?.evId),
  'evidence-preview': (el) => openEvidencePreview(el?.dataset?.evId || el?.dataset?.id),
  'evidence-unlink': (el) =>
    el?.dataset?.checkId
      ? unlinkAttachment(el.dataset.checkId, el.dataset.att)
      : removeEvidence(el?.dataset?.evId || el?.dataset?.att),
  'attach-evidence': (el) => openAttachEvidence(el?.dataset?.checkId, el?.dataset?.itemId),
  'export-csv': () => exportCsv(),
  print: () => window.print(),
  copy: async (el) => {
    const ok = await copyText(el.dataset.value || '');
    toast(ok ? 'Endereço copiado.' : 'Não foi possível copiar.', ok ? 'ok' : 'err');
  },
  'filter-docs': (el) => {
    ui.docFilter = el.dataset.filter || 'all';
    saveSession();
    renderAll({ preserveScroll: true });
  },
  'clear-doc-filters': () => {
    ui.docFilter = 'all';
    ui.docQuery = '';
    saveSession();
    renderAll({ preserveScroll: true });
  },
  'filter-findings': (el) => {
    ui.findFilter = el.dataset.filter || 'all';
    saveSession();
    refreshFindings();
    document.querySelectorAll('[data-action="filter-findings"]').forEach((button) => {
      button.setAttribute('aria-pressed', String(button.dataset.filter === ui.findFilter));
    });
  },
  'metric-filter': (el) => {
    ui.findFilter = el.dataset.filter || 'all';
    ui.findQuery = '';
    navigate('#/apontamentos');
  },
  'clear-finding-filters': () => {
    ui.findFilter = 'all';
    ui.findQuery = '';
    saveSession();
    renderAll({ preserveScroll: true });
  },
  'queue-scope': (el) => {
    const scope = el.dataset.scope || 'pending';
    ui.queueAll = scope === 'all';
    ui.queueReview = scope === 'review';
    saveSession();
    renderAll({ preserveScroll: true });
  },
  'review-approve': (el) => openApproveReview(el.dataset.id),
  'review-flag': (el) => openFlagReview(el.dataset.docId, el.dataset.checkId),
  'review-reopen': (el) => openReopenReview(el.dataset.id),
  'correction-add': (el) => openAddCorrection(el.dataset.id),
  'correction-open': (el) => openCompareCorrection(el.dataset.id),
  'correction-remove': (el) => removeCorrection(el.dataset.id),
  'versions-open': (el) => openVersions(el.dataset.id),
  'review-queue': () => {
    ui.queueReview = true;
    ui.queueAll = false;
    saveSession();
    const first = reviewQueueItems(getState())[0];
    if (first) navigate(`#/analisar/${first.id}`);
    else navigate('#/analisar');
  },
  'review-filter': (el) => {
    ui.docFilter = el.dataset.filter || 'review';
    saveSession();
    navigate('#/documentos');
  },
  'set-check': (el) => setCheckStatus(el.dataset.id, el.dataset.status, { focusNote: true }),
  'next-check': (el) => {
    const rows = [...document.querySelectorAll('.check[data-check-row]')];
    const index = rows.findIndex((row) => row.dataset.checkRow === el.dataset.id);
    const next = rows[index + 1];
    if (next) {
      next.scrollIntoView({ block: 'center', behavior: 'smooth' });
      next.focus({ preventScroll: true });
    } else {
      document
        .querySelector('.checks__foot, .done-card')
        ?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  },
  'note-toggle': (el) => toggleNote(el.dataset.id),
  'clear-note': (el) => clearNote(el.dataset.id),
  'doc-preview': (el) => openPreview(el.dataset.id),
  'item-preview': (el) => openItemPreview(el.dataset.id),
  'evidence-open': (el) => {
    el.closest('dialog')?.close();
    openPreview(el.dataset.id);
  },
  'doc-rename': (el) => renameDoc(el.dataset.id),
  'doc-toggle-active': (el) => toggleDocActive(el.dataset.id),
  'doc-delete': (el) => deleteDoc(el.dataset.id),
  'finding-edit': (el) => editFinding(el.dataset.checkId),
  'criterion-up': (el) => moveCriterion(el.dataset.id, -1),
  'criterion-down': (el) => moveCriterion(el.dataset.id, 1),
  'criterion-delete': (el) => deleteCriterion(el.dataset.id),
  'cs-settings-add': (el) => {
    const card = el?.closest('.card');
    const row = card?.querySelector('[data-cs-row]');
    const input = card?.querySelector('[data-cs-input]');
    if (row) row.hidden = false;
    if (el) el.hidden = true;
    input?.focus();
  },
  'cs-settings-cancel': (el) => {
    const card = el?.closest('.card');
    const row = card?.querySelector('[data-cs-row]');
    const input = card?.querySelector('[data-cs-input]');
    const addBtn = card?.querySelector('[data-action="cs-settings-add"]');
    if (input) input.value = '';
    if (row) row.hidden = true;
    if (addBtn) addBtn.hidden = customStatuses(getState()).length >= 2;
  },
  'cs-settings-confirm': (el) => {
    const card = el?.closest('.card');
    const input = card?.querySelector('[data-cs-input]');
    const label = String(input?.value || '').trim().replace(/\s+/g, ' ');
    const current = customStatuses(getState());
    if (label.length < 2) {
      toast('Dê um nome ao status.', 'err');
      input?.focus();
      return;
    }
    if (label.length > 40) {
      toast('Máximo de 40 caracteres.', 'err');
      input?.focus();
      return;
    }
    if (current.length >= 2) {
      toast('Máximo de 2 status personalizados.', 'err');
      return;
    }
    if (current.some((item) => item.label.toLowerCase() === label.toLowerCase())) {
      toast('Esse status já existe.', 'err');
      input?.focus();
      return;
    }
    return saveCustomStatuses(
      [...current.map(({ id, label: name }) => ({ id, label: name })), { label }],
      'Status adicionado.'
    );
  },
  'cs-settings-remove': async (el) => {
    const current = customStatuses(getState());
    const target = current.find((item) => item.id === el?.dataset?.id);
    if (!target) return;
    const ok = await confirmSheet({
      title: 'Remover status?',
      message: `“${target.label}” sai da lista de resultados deste processo. Verificações que já usam esse status impedem a remoção.`,
      confirmLabel: 'Remover',
      danger: true,
    });
    if (!ok) return;
    return saveCustomStatuses(
      current.filter((item) => item.id !== target.id).map(({ id, label }) => ({ id, label })),
      'Status removido.'
    );
  },
  'restore-backup': () => document.getElementById('restore-input')?.click(),
  'delete-process': () => deleteCurrentProcess(),
  'chip-remove': (el) => {
    el.closest('.chip')?.remove();
    updateChipCount();
  },
  'preset-add': () => addChip(),
};

/* ------------------------------------------------------- atualizações */

function refreshDocList() {
  const state = getState();
  const host = document.getElementById('doclist');
  if (host) host.innerHTML = renderDocumentsList(state);
  const count = document.getElementById('doc-results');
  if (count) count.textContent = `${filterDocuments(state).length} de ${state.documents.length}`;
}

function refreshFindings() {
  const state = getState();
  const host = document.getElementById('findings-results');
  if (host) host.innerHTML = renderFindingsResults(state);
}

function refreshQueueCounts() {
  const state = getState();
  document.querySelectorAll('[data-queue-count]').forEach((el) => {
    const doc = docById(state, el.dataset.queueCount);
    if (!doc) return;
    const st = docStats(state, doc.id);
    const flag = docFlag(state, doc.id);
    el.textContent = flag === 'inactive' ? '—' : flag === 'flagged' ? '!' : `${st.done}/${st.total}`;
  });
}

function syncAfterCheck(check) {
  const state = getState();
  const doc = docById(state, check.docId);
  renderMasthead();
  renderNav();
  if (!doc) return;
  // Cabeçalho, aviso de conclusão e resumo são atualizados no lugar: trocar o
  // HTML inteiro a cada verificação fazia a sessão de análise piscar.
  patchChecksHead(state, doc);
  const slot = document.querySelector('.checks [data-done-slot]');
  if (slot) {
    const html = doneBannerHtml(state, doc);
    if (slot.innerHTML !== html) slot.innerHTML = html;
  }
  const summary = document.querySelector('[data-doc-summary]');
  if (summary) {
    const html = docSummaryHtml(state, doc);
    if (summary.innerHTML !== html) summary.innerHTML = html;
  }
  refreshQueueCounts();
}

function updateCheckRow(check, { focus = false, focusNote = false, status = null } = {}) {
  const state = getState();
  const row = document.querySelector(`[data-check-row="${check.id}"]`);
  if (!row) return;
  const doc = docById(state, check.docId);
  const disabled = doc?.active === false;
  const patched = patchCheckRow(row, state, check, { disabled });
  let live = row;
  if (!patched) {
    // Casos raros (revisão do revisor, lista de resultados alterada): redesenha só esta linha.
    const criterion = state.criteria.find((c) => c.id === check.criterionId);
    const crit = criteriaSorted(state);
    const index = crit.findIndex((c) => c.id === check.criterionId);
    const holder = document.createElement('div');
    holder.innerHTML = renderCheckRow(state, check, criterion, index, {
      isLast: index === crit.length - 1,
      disabled,
    });
    const next = holder.firstElementChild;
    if (!next) return;
    row.replaceWith(next);
    live = next;
  }
  if (focus && status) {
    live.querySelector(`[data-status="${status}"]`)?.focus({ preventScroll: true });
  }
  if (focusNote) {
    live.querySelector('[data-note-id]')?.focus({ preventScroll: true });
  }
}

/* -------------------------------------------------------------- checks */

async function setCheckStatus(checkId, status, { focusNote = false } = {}) {
  const state = getState();
  const check = state.checks.find((c) => c.id === checkId);
  if (!check) return;
  if (docById(state, check.docId)?.active === false) {
    toast('Documento inativo: reative para editar verificações.', 'err');
    return;
  }

  if (check.status === status) {
    if (status === 'pending') return;
    status = 'pending';
  }

  const noteInput = document.querySelector(`[data-note-id="${checkId}"]`);
  const noteNow = noteInput ? noteInput.value : check.note || '';
  const before = { ...check };

  check.status = status;
  check.note = noteNow;
  check.updatedAt = new Date().toISOString();
  if (status === 'ok' || status === 'na') ui.notesOpen.delete(checkId);

  updateCheckRow(check, {
    // No iPad o teclado abre junto com o apontamento — é o fluxo que o Sergio usa.
    focusNote: focusNote && (status === 'nc' || status === 'obs'),
  });
  syncAfterCheck(check);
  activeWrites += 1;
  markSave(document.querySelector(`[data-check-row="${checkId}"]`), 'saving');

  try {
    const res = await api.updateCheck(checkId, { status, note: noteNow });
    mergeCheck(res.rev, res.check);
    if (Array.isArray(res.activity)) getState().activity = res.activity;
    rememberRoute();
    const live = document.querySelector(`[data-note-id="${checkId}"]`);
    if (live && live.value !== res.check.note) {
      const local = getState().checks.find((c) => c.id === checkId);
      if (local) local.note = live.value;
    }
    markSave(document.querySelector(`[data-check-row="${checkId}"]`), 'saved', fmtTime(res.check.updatedAt));
  } catch (err) {
    const local = getState().checks.find((c) => c.id === checkId);
    if (local) Object.assign(local, before);
    updateCheckRow(local || before);
    syncAfterCheck(local || before);
    toast(err.message, 'err');
  } finally {
    activeWrites = Math.max(0, activeWrites - 1);
  }
}

function queueNote(textarea) {
  const id = textarea.dataset.noteId;
  const state = getState();
  const check = state.checks.find((c) => c.id === id);
  if (!check) return;
  check.note = textarea.value;
  markSave(textarea.closest('.check'), 'saving');
  if (noteTimers.has(id)) clearTimeout(noteTimers.get(id));
  noteTimers.set(
    id,
    setTimeout(() => saveNote(id, textarea.value), 600)
  );
}

async function saveNote(id, value) {
  noteTimers.delete(id);
  const row = document.querySelector(`[data-check-row="${id}"]`);
  markSave(row, 'saving');
  activeWrites += 1;
  try {
    const res = await api.updateCheck(id, { note: value });
    mergeCheck(res.rev, res.check);
    const live = document.querySelector(`[data-note-id="${id}"]`);
    if (live && live.value !== res.check.note) {
      const local = getState().checks.find((c) => c.id === id);
      if (local) local.note = live.value;
    }
    markSave(row, 'saved', fmtTime(res.check.updatedAt));
  } catch (err) {
    markSave(row, 'error');
    toast('Não foi possível salvar a nota.', 'err');
  } finally {
    activeWrites = Math.max(0, activeWrites - 1);
  }
}

function toggleNote(id) {
  if (ui.notesOpen.has(id)) ui.notesOpen.delete(id);
  else ui.notesOpen.add(id);
  const check = getState().checks.find((c) => c.id === id);
  if (!check) return;
  updateCheckRow(check);
  document.querySelector(`[data-note-id="${id}"]`)?.focus();
}

async function clearNote(id) {
  const state = getState();
  const check = state.checks.find((c) => c.id === id);
  if (!check) return;
  check.note = '';
  const input = document.querySelector(`[data-note-id="${id}"]`);
  if (input) input.value = '';
  const row = document.querySelector(`[data-check-row="${id}"]`);
  markSave(row, 'saving');
  activeWrites += 1;
  try {
    const res = await api.updateCheck(id, { note: '' });
    mergeCheck(res.rev, res.check);
    markSave(row, 'saved', fmtTime(res.check.updatedAt));
    const clearBtn = row?.querySelector('.note-clear');
    if (clearBtn) clearBtn.remove();
  } catch (err) {
    toast(err.message, 'err');
    markSave(row, 'error');
  } finally {
    activeWrites = Math.max(0, activeWrites - 1);
  }
}

/* ------------------------------------------------------------ documentos */

/**
 * Corpo da prévia para um arquivo qualquer (atual, correção ou versão).
 * Devolve `body` já com os hosts e `montar(host)` para os formatos que
 * precisam de JavaScript (docx desenhado no navegador, .doc em texto).
 */
function previewBody(name, mime, url) {
  const kind = fileKind(name, mime);
  if (kind === 'pdf') {
    return {
      kind,
      body:
        `<iframe class="preview-frame" src="${url}#view=FitH" title="Pré-visualização de ${esc(name)}"></iframe>` +
        `<p class="sheet__note">No iPad, se o PDF não aparecer aqui, use “Abrir em nova aba”.</p>`,
    };
  }
  if (kind === 'image') {
    return { kind, body: `<img class="preview-image" src="${url}" alt="${esc(name)}" loading="lazy">` };
  }
  if (suportaPreviaDocx(name)) {
    // .docx: o próprio navegador desenha o documento (sem passar pelo servidor).
    return {
      kind: 'docx',
      body:
        `<div class="preview-docx" data-docx-host></div>` +
        `<p class="sheet__note">Prévia montada no seu navegador a partir do arquivo original — o layout pode variar um pouco em relação ao Word, e o arquivo em si não é alterado.</p>`,
      montar: (host) => {
        const alvo = host?.querySelector?.('[data-docx-host]');
        if (alvo) montarPreviaDocx(alvo, url, { nome: name });
      },
    };
  }
  if (ehDocAntigo(name)) {
    // .doc: o navegador não desenha este formato, mas o texto é legível —
    // lemos o próprio arquivo aqui e mostramos o conteúdo (sem layout).
    return {
      kind: 'doc',
      body:
        `<div class="preview-doc" data-doc-text-host></div>` +
        `<p class="sheet__note" data-doc-note>Prévia em <b>texto</b> — o formato .doc não guarda o layout para o navegador. ` +
        `O texto é o do documento inteiro, na ordem; imagens e tabelas não aparecem como no Word.</p>`,
      montar: (host) => {
        const alvo = host?.querySelector?.('[data-doc-text-host]');
        const nota = host?.querySelector?.('[data-doc-note]');
        if (alvo) montarPreviaDoc(alvo, url, { nome: name, nota });
      },
    };
  }
  return {
    kind: 'file',
    body:
      `<div class="preview-fallback">${icon('file', 22)}` +
      `<p>Este formato não tem pré-visualização no navegador. Abra ou baixe o arquivo.</p></div>`,
  };
}

/** Abre a prévia de um arquivo armazenado qualquer (documento, correção, versão). */
function openStoredPreview({ name, mime, size, stored, eyebrowLabel = null }) {
  const url = api.fileUrl(stored);
  const view = previewBody(name, mime, url);
  const dialog = openSheet({
    title: name,
    eyebrow: eyebrowLabel || `${fileKindLabel(view.kind)}${size ? ` · ${fmtBytes(size)}` : ''}`,
    body: view.body,
    wide: true,
    footer:
      `<a class="btn btn--secondary" href="${url}" target="_blank" rel="noopener">${icon('external', 15)} Abrir em nova aba</a>` +
      `<a class="btn btn--primary" href="${url}?download=1" download>${icon('download', 15)} Baixar</a>`,
  });
  view.montar?.(dialog);
  return dialog;
}

function openPreview(docId) {
  const doc = docById(getState(), docId);
  if (!doc) return;
  if (isItemDoc(doc)) {
    openSheet({
      title: doc.name,
      eyebrow: fileKindLabel('item'),
      body:
        `<div class="preview-fallback">${icon('list', 22)}` +
        `<p>Este é um item da listagem — ele reúne as evidências de cada critério. Abra uma evidência para ver o arquivo.</p></div>`,
      wide: true,
      footer: `<button type="button" class="btn btn--primary" data-close>Fechar</button>`,
    });
    return;
  }
  openStoredPreview({ name: doc.name, mime: doc.mime, size: doc.size, stored: doc.stored });
}

/* ------------------------------------------------- correção e versões */

/** Painel de critérios usado na comparação da correção. */
function criteriaPanelHtml(state, doc) {
  const criteria = criteriaSorted(state);
  const criterionById = new Map(criteria.map((item) => [item.id, item]));
  const checks = (state.checks || [])
    .filter((check) => check.docId === doc.id && criterionById.has(check.criterionId))
    .sort((a, b) => (criterionById.get(a.criterionId)?.order || 0) - (criterionById.get(b.criterionId)?.order || 0));
  const reviewer = currentProfile(state)?.role === 'reviewer';
  if (!checks.length) return '<p class="sheet__note">Este documento ainda não tem verificações.</p>';
  return checks
    .map((check) => {
      const criterion = criterionById.get(check.criterionId);
      const review = checkReview(check);
      const stampClass =
        check.status === 'ok'
          ? 'stamp--ok'
          : check.status === 'nc'
            ? 'stamp--nc'
            : check.status === 'obs'
              ? 'stamp--obs'
              : 'stamp--pending';
      const chip =
        review === 'approved'
          ? '<span class="review-chip review-chip--ok">aprovada</span>'
          : review === 'flagged'
            ? '<span class="review-chip review-chip--flag">sinalizada</span>'
            : '<span class="review-chip">aguardando</span>';
      return (
        `<div class="compare__criterion">` +
        `<div class="compare__criterion-top"><span class="compare__criterion-label">${esc(criterion.label)}</span>` +
        `<span class="stamp ${stampClass}">${esc(statusLabelFor(state, check.status))}</span></div>` +
        ((check.note || '').trim() ? `<p class="compare__criterion-note">${esc(check.note)}</p>` : '') +
        `<div class="compare__criterion-foot">${chip}` +
        (reviewer && check.status !== 'pending'
          ? `<button type="button" class="btn btn--ghost btn--sm" data-compare-flag="${esc(check.id)}">${icon(
              'flag',
              13
            )} Sinalizar</button>`
          : '') +
        `</div></div>`
      );
    })
    .join('');
}

/** Comparação antes/depois da correção pendente, com o painel de critérios. */
function openCompareCorrection(docId) {
  const state = getState();
  const doc = docById(state, docId);
  if (!doc) return;
  if (!doc.correction) {
    toast('Este documento não tem correção pendente.', 'err');
    return;
  }
  const reviewer = currentProfile(state)?.role === 'reviewer';
  const review = reviewOfDoc(state, doc.id);
  const correction = doc.correction;
  const version = correctionVersion(doc);
  const originalView = previewBody(doc.name, doc.mime, api.fileUrl(doc.stored));
  const correctedView = previewBody(correction.name, correction.mime, api.fileUrl(correction.stored));
  const canApproveNow = reviewer && review.status === 'awaiting';
  const mine = currentProfile(state)?.id === correction.by;
  const diffPanelId = `compare-diff-${Math.random().toString(36).slice(2, 8)}`;
  const dialog = openSheet({
    title: doc.name,
    eyebrow: `Comparação · correção v${version}`,
    className: 'sheet--compare',
    body:
      `<div class="compare" data-view="corrected">` +
      `<div class="compare__toolbar">` +
      `<div class="segmented compare__switch" role="group" aria-label="O que visualizar">` +
      `<button type="button" data-compare-view="original" aria-pressed="false">Original</button>` +
      `<button type="button" data-compare-view="corrected" aria-pressed="true">Corrigido · v${version}</button>` +
      `<button type="button" data-compare-view="criteria" aria-pressed="false">Critérios</button>` +
      `</div>` +
      `<span class="compare__meta">${esc(correction.byName || 'alguém')} · ${esc(
        fmtDate(correction.addedAt)
      )} · ${fmtBytes(correction.size)}</span></div>` +
      `<section class="compare__diff" data-compare-diff>` +
      `<button type="button" class="compare__diff-head" data-compare-diff-toggle aria-expanded="false" ` +
      `aria-controls="${diffPanelId}">` +
      `<span class="compare__diff-title">${icon('list', 14)} O que mudou</span>` +
      `<span class="compare__diff-summary" data-diff-summary>comparando o texto das duas versões…</span>` +
      `<span class="compare__diff-chev" aria-hidden="true">${icon('chevronDown', 14)}</span></button>` +
      `<div class="compare__diff-body" id="${diffPanelId}" data-diff-host hidden></div>` +
      `</section>` +
      `<div class="compare__grid">` +
      `<section class="compare__pane" data-compare-pane="original">` +
      `<header class="compare__pane-head">Original · v${currentVersion(doc)}` +
      `<span>${esc(doc.name)} · ${fmtBytes(doc.size)}</span></header>` +
      `<div class="compare__preview" data-preview-host="original">${originalView.body}</div></section>` +
      `<section class="compare__pane" data-compare-pane="corrected">` +
      `<header class="compare__pane-head compare__pane-head--new">Corrigido · v${version}` +
      `<span>${esc(correction.name)} · ${fmtBytes(correction.size)}</span></header>` +
      `<div class="compare__preview" data-preview-host="corrected">${correctedView.body}</div></section>` +
      `<aside class="compare__criteria" data-compare-pane="criteria">` +
      `<header class="compare__pane-head">Critérios<span>${review.approved}/${review.done} aprovados</span></header>` +
      `<div class="compare__criteria-list">${criteriaPanelHtml(state, doc)}</div></aside>` +
      `</div></div>`,
    footer:
      `<button type="button" class="btn btn--ghost" data-close>Fechar</button>` +
      (mine
        ? `<button type="button" class="btn btn--danger" data-compare-remove>${icon('trash', 14)} Remover correção</button>`
        : '') +
      `<span class="sheet__foot-spacer"></span>` +
      `<a class="btn btn--secondary" href="${api.fileUrl(correction.stored)}" target="_blank" rel="noopener">${icon(
        'external',
        15
      )} Abrir corrigido</a>` +
      (canApproveNow
        ? `<button type="button" class="btn btn--primary" data-compare-approve>${icon(
            'check',
            15
          )} Aprovar documento</button>`
        : ''),
  });
  originalView.montar?.(dialog.querySelector('[data-preview-host="original"]'));
  correctedView.montar?.(dialog.querySelector('[data-preview-host="corrected"]'));
  montarDiffCorrecao(dialog, doc, correction);

  const setView = (view) => {
    dialog.querySelectorAll('[data-compare-view]').forEach((btn) => {
      btn.setAttribute('aria-pressed', String(btn.dataset.compareView === view));
    });
    dialog.querySelector('.compare')?.setAttribute('data-view', view);
  };
  dialog.querySelectorAll('[data-compare-view]').forEach((btn) =>
    btn.addEventListener('click', () => setView(btn.dataset.compareView))
  );

  const bindFlagButtons = () => {
    dialog.querySelectorAll('[data-compare-flag]').forEach((btn) =>
      btn.addEventListener('click', () => {
        openFlagReview(doc.id, btn.dataset.compareFlag, {
          onDone: () => {
            const next = docById(getState(), doc.id);
            const list = dialog.querySelector('.compare__criteria-list');
            if (next && list) {
              list.innerHTML = criteriaPanelHtml(getState(), next);
              bindFlagButtons();
            }
          },
        });
      })
    );
  };
  bindFlagButtons();

  dialog.querySelector('[data-compare-approve]')?.addEventListener('click', () =>
    openApproveReview(doc.id, { onDone: () => dialog.close() })
  );
  dialog.querySelector('[data-compare-remove]')?.addEventListener('click', () =>
    removeCorrection(doc.id, dialog)
  );
  return dialog;
}

/**
 * Preenche o painel "O que mudou" da comparação.
 *
 * Lê o texto das duas versões no próprio navegador (`textoDoArquivo`) e mostra
 * os trechos alterados. É só apoio à leitura: o revisor continua decidindo pela
 * comparação lado a lado, e o registro continua sendo o arquivo aprovado.
 */
async function montarDiffCorrecao(dialog, doc, correction) {
  const secao = dialog.querySelector('[data-compare-diff]');
  const corpo = dialog.querySelector('[data-diff-host]');
  const resumo = dialog.querySelector('[data-diff-summary]');
  const botao = dialog.querySelector('[data-compare-diff-toggle]');
  if (!secao || !corpo || !resumo) return;

  const mostrar = (aberto) => {
    corpo.hidden = !aberto;
    botao?.setAttribute('aria-expanded', String(aberto));
    secao.setAttribute('data-open', String(aberto));
  };
  botao?.addEventListener('click', () => mostrar(corpo.hidden));

  let falhouLeitura = false;
  const ler = async (nome, url) => {
    try {
      return await textoDoArquivo(nome, url);
    } catch (err) {
      if (err?.codigo !== 'semTexto') falhouLeitura = true;
      return null;
    }
  };
  const [antes, depois] = await Promise.all([
    ler(doc.name, api.fileUrl(doc.stored)),
    ler(correction.name, api.fileUrl(correction.stored)),
  ]);
  if (!dialog.isConnected) return;

  if (antes === null || depois === null) {
    resumo.textContent = 'sem texto para comparar';
    corpo.innerHTML = diffAvisoHtml(
      'Não dá para comparar o texto destas versões.',
      falhouLeitura
        ? 'A leitura de um dos arquivos falhou. A comparação lado a lado continua valendo — abra as duas versões e confira.'
        : 'Ao menos um dos arquivos não guarda texto legível (PDF digitalizado ou imagem). A comparação lado a lado continua valendo — abra as duas versões e confira.'
    );
    mostrar(true);
    return;
  }

  const resultado = diffTexto(antes, depois);
  resumo.textContent = resumoEmTexto(resultado.resumo);
  corpo.innerHTML = diffBodyHtml(resultado);
  secao.setAttribute('data-total', String(resultado.resumo.total));
  // Mudança pequena abre sozinha; mudança grande fica fechada para não empurrar a comparação.
  mostrar(resultado.resumo.total > 0 && resultado.resumo.total <= 6);
}

/** Envia a nova versão do arquivo (a atual vira histórico na aprovação). */
function openAddCorrection(docId) {
  const state = getState();
  const doc = docById(state, docId);
  if (!doc) return;
  if (doc.itemKind === 'item') {
    toast('Itens de listagem não têm arquivo próprio — corrija uma evidência.', 'err');
    return;
  }
  if (doc.correction) {
    openCompareCorrection(doc.id);
    return;
  }
  if (doc.active === false) {
    toast('Documento inativo: reative antes de enviar correção.', 'err');
    return;
  }
  const version = correctionVersion(doc);
  let selected = null;
  let objectUrl = null;
  const dialog = openSheet({
    title: 'Adicionar correção',
    eyebrow: `Documento · correção v${version}`,
    body:
      `<p class="sheet__note">Envie a nova versão do arquivo corrigido. A versão atual continua disponível para comparação — nada é apagado.</p>` +
      `<div class="field"><label for="correction-name">Nome do documento</label>` +
      `<input id="correction-name" type="text" maxlength="220" value="${esc(doc.name)}" autocomplete="off"></div>` +
      `<div class="dropzone" id="correction-dropzone" role="button" tabindex="0" aria-label="Selecionar o arquivo corrigido">` +
      `<span class="dropzone__icon">${icon('upload', 19)}</span>` +
      `<strong>Arraste o arquivo corrigido ou toque para selecionar</strong>` +
      `<span>PDF, imagens, planilhas e documentos · até 32 MB</span>` +
      `<span>Versão atual: ${esc(doc.name)} · ${fmtBytes(doc.size)}</span></div>` +
      `<input type="file" id="correction-file" class="sr-only" ` +
      `accept=".pdf,.png,.jpg,.jpeg,.webp,.gif,.heic,.doc,.docx,.xls,.xlsx,.csv,.txt">` +
      `<div class="correction-selected" id="correction-selected" hidden></div>` +
      `<div class="correction-preview" id="correction-preview"></div>`,
    footer:
      `<button type="button" class="btn btn--ghost" data-cancel>Cancelar</button>` +
      `<button type="button" class="btn btn--primary" data-confirm disabled>${icon(
        'upload',
        15
      )} Enviar correção v${version}</button>`,
    onClose: () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    },
  });
  const input = dialog.querySelector('#correction-file');
  const dropzone = dialog.querySelector('#correction-dropzone');
  const selectedHost = dialog.querySelector('#correction-selected');
  const previewHost = dialog.querySelector('#correction-preview');
  const confirm = dialog.querySelector('[data-confirm]');
  dialog.querySelector('[data-cancel]')?.addEventListener('click', () => dialog.close());

  const select = (file) => {
    if (!file) return;
    if (file.size > MAX_UPLOAD) {
      toast(`Arquivo acima de 32 MB (${fmtBytes(file.size)}).`, 'err');
      return;
    }
    selected = file;
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = URL.createObjectURL(file);
    selectedHost.hidden = false;
    selectedHost.innerHTML =
      `${icon('file', 14)} <span class="correction-selected__name">${esc(file.name)}</span>` +
      `<span class="correction-selected__size">${fmtBytes(file.size)}</span>`;
    const view = previewBody(file.name, file.type, objectUrl);
    previewHost.innerHTML = `<div class="correction-preview__body">${view.body}</div>`;
    view.montar?.(previewHost.querySelector('.correction-preview__body'));
    confirm.disabled = false;
  };

  input?.addEventListener('change', () => select(input.files?.[0]));
  dropzone?.addEventListener('click', () => input?.click());
  dropzone?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      input?.click();
    }
  });
  dropzone?.addEventListener('dragover', (event) => {
    event.preventDefault();
    dropzone.classList.add('dropzone--over');
  });
  dropzone?.addEventListener('dragleave', () => dropzone.classList.remove('dropzone--over'));
  dropzone?.addEventListener('drop', (event) => {
    event.preventDefault();
    dropzone.classList.remove('dropzone--over');
    select(event.dataTransfer?.files?.[0]);
  });

  confirm?.addEventListener('click', async () => {
    if (!selected) return;
    const name = (dialog.querySelector('#correction-name')?.value || '').trim() || selected.name;
    confirm.disabled = true;
    try {
      const data = await readBase64(selected);
      const res = await api.addCorrection(doc.id, { name, data });
      setState(res.state);
      dialog.close();
      renderAll({ preserveScroll: true });
      toast(`Correção v${version} enviada — aguardando revisão.`);
      openCompareCorrection(doc.id);
    } catch (err) {
      confirm.disabled = false;
      toast(err.message, 'err');
    }
  });
}

/** Histórico de versões: arquivo atual e todas as versões arquivadas. */
function openVersions(docId) {
  const state = getState();
  const doc = docById(state, docId);
  if (!doc) return;
  const versions = versionsOf(doc);
  if (!versions.length) {
    toast('Este documento ainda não tem outras versões.');
    return;
  }
  const total = 1 + versions.length;
  const rows = versions
    .map((version, index) => {
      const number = index + 1;
      return (
        `<button type="button" class="version-row" data-version-open="${esc(version.stored)}" ` +
        `data-version-name="${esc(version.name)}" data-version-mime="${esc(version.mime || '')}" ` +
        `data-version-size="${Number(version.size) || 0}">` +
        `<span class="version-row__num">v${number}</span>` +
        `<span class="version-row__copy"><strong>${esc(version.name)}</strong>` +
        `<span>${fmtBytes(version.size)} · arquivada em ${esc(
          fmtDate(version.replacedAt || version.addedAt)
        )}${version.replacedByName ? ` por ${esc(version.replacedByName)}` : ''}</span></span>` +
        `${icon('chevronRight', 16)}</button>`
      );
    })
    .join('');
  const currentRow =
    `<div class="version-row version-row--current">` +
    `<span class="version-row__num">v${total}</span>` +
    `<span class="version-row__copy"><strong>${esc(doc.name)}</strong>` +
    `<span>${fmtBytes(doc.size)} · versão vigente</span></span>` +
    `<span class="stamp stamp--ok">Atual</span></div>`;
  const dialog = openSheet({
    title: 'Versões do documento',
    eyebrow: `${doc.name} · ${total} versões`,
    body:
      `<p class="sheet__note">O arquivo antigo nunca é apagado: a comparação fica disponível a qualquer tempo.</p>` +
      `<div class="version-list">${rows}${currentRow}</div>`,
    footer: `<button type="button" class="btn btn--primary" data-close>Fechar</button>`,
  });
  dialog.querySelectorAll('[data-version-open]').forEach((btn) =>
    btn.addEventListener('click', () =>
      openStoredPreview({
        name: btn.dataset.versionName,
        mime: btn.dataset.versionMime,
        size: Number(btn.dataset.versionSize) || 0,
        stored: btn.dataset.versionOpen,
        eyebrowLabel: `Versão arquivada · ${fmtBytes(Number(btn.dataset.versionSize) || 0)}`,
      })
    )
  );
}

/** Reabertura da revisão de um documento já aprovado (só o revisor). */
function openReopenReview(docId) {
  const state = getState();
  const doc = docById(state, docId);
  if (!doc) return;
  if (currentProfile(state)?.role !== 'reviewer') {
    toast('Apenas o revisor (Diogenes) reabre uma revisão.', 'err');
    return;
  }
  if (reviewOfDoc(state, doc.id).status !== 'approved') {
    toast('Só é possível reabrir um documento já aprovado.', 'err');
    return;
  }
  const dialog = openSheet({
    title: 'Reabrir revisão',
    eyebrow: `Revisão · v${currentVersion(doc)}`,
    body:
      `<p class="sheet-message">${esc(doc.name)}</p>` +
      `<p class="sheet__note">O documento volta para a fila de revisão e as verificações precisam ser aprovadas de novo. ` +
      `Use quando precisar corrigir algo que já foi aprovado — um erro seu, uma ideia melhor ou um apontamento de auditoria.</p>` +
      `<div class="field"><label for="reopen-reason">Motivo da reabertura</label>` +
      `<textarea id="reopen-reason" rows="3" maxlength="1000" placeholder="Ex.: auditoria apontou divergência na cláusula 4.2."></textarea>` +
      `<p class="field__hint" data-reopen-hint>O motivo fica registrado na atividade do documento.</p></div>`,
    footer:
      `<button type="button" class="btn btn--ghost" data-cancel>Cancelar</button>` +
      `<button type="button" class="btn btn--primary" data-confirm disabled>${icon(
        'arrowLeft',
        15
      )} Reabrir revisão</button>`,
  });
  const area = dialog.querySelector('#reopen-reason');
  const confirm = dialog.querySelector('[data-confirm]');
  const hint = dialog.querySelector('[data-reopen-hint]');
  area?.addEventListener('input', () => {
    const ok = (area.value || '').trim().length >= 5;
    confirm.disabled = !ok;
    if (hint) {
      hint.textContent = ok
        ? 'O motivo fica registrado na atividade do documento.'
        : 'Escreva ao menos uma frase explicando o motivo.';
    }
  });
  dialog.querySelector('[data-cancel]')?.addEventListener('click', () => dialog.close());
  confirm?.addEventListener('click', async () => {
    const reason = (area?.value || '').trim();
    if (!reason) return;
    confirm.disabled = true;
    try {
      const res = await api.reopenReview(doc.id, reason);
      setState(res.state);
      dialog.close();
      renderAll({ preserveScroll: true });
      toast('Revisão reaberta — o documento voltou para a fila de revisão.');
    } catch (err) {
      confirm.disabled = false;
      toast(err.message, 'err');
    }
  });
  setTimeout(() => area?.focus(), 80);
}

/** Remove a correção pendente (só quem enviou). */
async function removeCorrection(docId, sourceDialog = null) {
  const state = getState();
  const doc = docById(state, docId);
  if (!doc?.correction) return;
  const ok = await confirmSheet({
    title: 'Remover correção?',
    message:
      `<b>${esc(doc.correction.name)}</b> será descartada e o documento continua na versão atual ` +
      `(v${currentVersion(doc)}). O arquivo enviado é apagado.`,
    confirmLabel: 'Remover correção',
    danger: true,
  });
  if (!ok) return;
  try {
    const res = await api.removeCorrection(doc.id);
    setState(res.state);
    sourceDialog?.close();
    renderAll({ preserveScroll: true });
    toast('Correção removida.');
  } catch (err) {
    toast(err.message, 'err');
  }
}

function renameDoc(docId) {
  const doc = docById(getState(), docId);
  if (!doc) return;
  const isItem = isItemDoc(doc);
  const dialog = openSheet({
    title: isItem ? 'Renomear item' : 'Renomear documento',
    eyebrow: fileKindLabel(isItem ? 'item' : fileKind(doc.name, doc.mime)),
    body:
      `<div class="field"><label for="rename-input">${isItem ? 'Nome do item' : 'Nome do arquivo'}</label>` +
      `<input id="rename-input" type="text" maxlength="220" value="${esc(doc.name)}"></div>` +
      `<p class="sheet__note">${
        isItem
          ? 'A numeração, as evidências e as verificações continuam iguais — só o nome muda.'
          : 'O arquivo em si não é alterado — apenas o nome que aparece no processo.'
      }</p>`,
    footer:
      `<button type="button" class="btn btn--ghost" data-cancel>Cancelar</button>` +
      `<button type="button" class="btn btn--primary" data-save>Salvar nome</button>`,
  });
  const input = dialog.querySelector('#rename-input');
  input?.focus();
  input?.select();
  dialog.querySelector('[data-cancel]')?.addEventListener('click', () => dialog.close());
  dialog.querySelector('[data-save]')?.addEventListener('click', async () => {
    const value = input.value.trim();
    if (!value) {
      toast('Informe um nome.', 'err');
      input.focus();
      return;
    }
    try {
      const res = await api.updateDocument(doc.id, { name: value });
      setState(res.state);
      dialog.close();
      renderAll({ preserveScroll: true });
      toast('Nome alterado.');
    } catch (err) {
      toast(err.message, 'err');
    }
  });
  input?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') dialog.querySelector('[data-save]')?.click();
  });
}

async function toggleDocActive(docId) {
  const doc = docById(getState(), docId);
  if (!doc) return;
  if (doc.active === false) {
    const ok = await confirmSheet({
      title: 'Reativar documento?',
      message:
        'As verificações voltam ao estado anterior e o documento retorna à fila de análise. A dispensa fica registrada no histórico.',
      confirmLabel: 'Reativar documento',
    });
    if (!ok) return;
    try {
      const res = await api.updateDocument(doc.id, { active: true });
      setState(res.state);
      renderAll({ preserveScroll: true });
      toast('Documento reativado.');
    } catch (err) {
      toast(err.message, 'err');
    }
    return;
  }

  const dialog = openSheet({
    title: 'Inativar documento',
    eyebrow: doc.name,
    body:
      `<div class="field"><label for="inactive-reason">Motivo</label>` +
      `<textarea id="inactive-reason" rows="3" maxlength="500" ` +
      `placeholder="Ex.: cargo inexistente, documento descontinuado, não se aplica…"></textarea></div>` +
      `<p class="sheet__note">O documento sai da fila e conta como verificado; as verificações ficam suspensas e podem ser retomadas ao reativar. A dispensa entra na revisão do Diogenes.</p>`,
    footer:
      `<button type="button" class="btn btn--ghost" data-cancel>Cancelar</button>` +
      `<button type="button" class="btn btn--primary" data-inactivate>Inativar documento</button>`,
  });
  const reason = dialog.querySelector('#inactive-reason');
  reason?.focus();
  dialog.querySelector('[data-cancel]')?.addEventListener('click', () => dialog.close());
  dialog.querySelector('[data-inactivate]')?.addEventListener('click', async () => {
    const value = reason.value.trim();
    if (!value) {
      toast('Informe o motivo da inativação.', 'err');
      reason.focus();
      return;
    }
    try {
      const res = await api.updateDocument(doc.id, { active: false, inactiveReason: value });
      setState(res.state);
      dialog.close();
      renderAll({ preserveScroll: true });
      toast('Documento inativado.');
    } catch (err) {
      toast(err.message, 'err');
    }
  });
}


async function deleteDoc(docId) {
  const doc = docById(getState(), docId);
  if (!doc) return;
  const isItem = isItemDoc(doc);
  const evidences = isItem ? childDocuments(getState(), doc.id).length : 0;
  const st = docStats(getState(), doc.id);
  const ok = await confirmSheet({
    title: isItem ? 'Excluir linha?' : 'Excluir documento?',
    message: isItem
      ? `<b>${esc(doc.name)}</b> e ${plural(st.total, 'verificação vinculada', 'verificações vinculadas')} ` +
        `${evidences ? `serão removidas, junto com ${plural(evidences, 'evidência', 'evidências')} anexada(s). ` : 'serão removidas. '}Não há como desfazer.`
      : `<b>${esc(doc.name)}</b> e ${plural(st.total, 'verificação vinculada', 'verificações vinculadas')} ` +
        `serão removidos, junto com o arquivo enviado. Não há como desfazer.`,
    confirmLabel: isItem ? 'Excluir linha' : 'Excluir documento',
    danger: true,
  });
  if (!ok) return;
  try {
    const res = await api.deleteDocument(doc.id);
    setState(res.state);
    if (ui.route.name === 'document' || ui.route.name === 'workbench') navigate('#/documentos');
    else renderAll({ preserveScroll: true });
    toast(isItem ? 'Linha excluída.' : 'Documento excluído.');
  } catch (err) {
    toast(err.message, 'err');
  }
}

/* --------------------------------------------------------- importação */

function readBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(new Error('Não foi possível ler o arquivo.'));
    reader.readAsDataURL(file);
  });
}

function openImportDialog() {
  const state = getState();
  if (!state?.process) return;
  if (!state.criteria.length) {
    toast('Adicione um critério antes de importar.', 'err');
    navigate('#/ajustes');
    return;
  }

  const dialog = openSheet({
    title: 'Importar documentos',
    eyebrow: `Acervo · ${plural(state.criteria.length, 'critério', 'critérios')} por arquivo`,
    body:
      `<div class="dropzone" id="dropzone" role="button" tabindex="0" aria-label="Selecionar arquivos para importar">` +
      `<span class="dropzone__icon">${icon('upload', 19)}</span>` +
      `<strong>Arraste arquivos ou toque para selecionar</strong>` +
      `<span>PDF, imagens, planilhas e documentos · até 32 MB por arquivo</span>` +
      `<span>${plural(state.documents.length, 'documento já importado', 'documentos já importados')}</span>` +
      `</div>` +
      `<input type="file" id="file-input" multiple class="sr-only" ` +
      `accept=".pdf,.png,.jpg,.jpeg,.webp,.gif,.heic,.doc,.docx,.xls,.xlsx,.csv,.txt">` +
      `<div class="import-progress" id="import-progress">Nenhum arquivo selecionado</div>` +
      `<div class="import-list" id="import-list"></div>`,
    footer:
      `<div class="import-progress" id="import-progress-foot">Selecione quantos arquivos precisar</div>` +
      `<span class="spacer"></span>` +
      `<button type="button" class="btn btn--secondary" data-done>Concluir</button>`,
  });

  const input = dialog.querySelector('#file-input');
  const dropzone = dialog.querySelector('#dropzone');
  const doneBtn = dialog.querySelector('[data-done]');

  doneBtn?.addEventListener('click', () => dialog.close());
  dropzone?.addEventListener('click', () => input.click());
  dropzone?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      input.click();
    }
  });
  input?.addEventListener('change', () => {
    const files = [...(input.files || [])];
    input.value = '';
    if (files.length) handleFiles(files, dialog);
  });

  ['dragenter', 'dragover'].forEach((type) =>
    dropzone?.addEventListener(type, (event) => {
      event.preventDefault();
      dropzone.classList.add('is-over');
    })
  );
  ['dragleave', 'dragend'].forEach((type) =>
    dropzone?.addEventListener(type, () => dropzone.classList.remove('is-over'))
  );
  dropzone?.addEventListener('drop', (event) => {
    event.preventDefault();
    dropzone.classList.remove('is-over');
    const files = [...(event.dataTransfer?.files || [])];
    if (files.length) handleFiles(files, dialog);
  });
}

async function handleFiles(files, dialog) {
  const list = dialog.querySelector('#import-list');
  const progress = dialog.querySelector('#import-progress');
  const footProgress = dialog.querySelector('#import-progress-foot');
  const doneBtn = dialog.querySelector('[data-done]');
  const dropzone = dialog.querySelector('#dropzone');

  importBusy = true;
  if (doneBtn) doneBtn.disabled = true;
  dropzone?.classList.add('is-busy');
  let ok = 0;

  for (let index = 0; index < files.length; index += 1) {
    const file = files[index];
    const row = document.createElement('div');
    row.className = 'import-item';
    row.innerHTML =
      `${icon('file', 14)}<span class="import-item__name">${esc(file.name)}</span>` +
      `<span class="import-item__state">enviando</span>`;
    list?.append(row);
    if (progress) progress.textContent = `Enviando ${index + 1} de ${files.length}…`;
    if (footProgress) footProgress.textContent = `${file.name} · ${fmtBytes(file.size)}`;

    try {
      if (file.size > MAX_UPLOAD) throw new Error('acima de 32 MB');
      const data = await readBase64(file);
      const res = await api.addDocument(getState().process.id, {
        name: file.name,
        mime: file.type || '',
        size: file.size,
        data,
      });
      setState(res.state);
      ok += 1;
      row.classList.add('import-item--done');
      const stateEl = row.querySelector('.import-item__state');
      if (stateEl) stateEl.textContent = 'importado';
    } catch (err) {
      row.classList.add('import-item--error');
      const stateEl = row.querySelector('.import-item__state');
      if (stateEl) stateEl.textContent = err.message?.includes('32 MB') ? 'acima de 32 MB' : 'falhou';
      row.title = err.message || 'Falha ao importar';
    }
  }

  importBusy = false;
  if (doneBtn) doneBtn.disabled = false;
  dropzone?.classList.remove('is-busy');
  if (progress) progress.textContent = ok ? `${ok} de ${files.length} importados` : 'Nenhum arquivo importado';
  if (footProgress) footProgress.textContent = ok ? 'Arquivos prontos para verificação' : 'Tente novamente';

  renderAll({ preserveScroll: true });
  if (ok) toast(plural(ok, 'documento importado', 'documentos importados'));
  else toast('Nenhum documento foi importado.', 'err');
}

/* ------------------------------------------------------------ itens e evidências */

function openEvidencePreview(id) {
  if (id) openPreview(id);
}

/**
 * Prévia a partir da listagem: o item não tem arquivo próprio, então abrimos
 * direto a evidência quando há uma só, ou deixamos escolher quando há várias.
 */
function openItemPreview(itemId) {
  const state = getState();
  const item = docById(state, itemId);
  if (!item) return;
  const evidencias = childDocuments(state, itemId);
  if (!evidencias.length) {
    toast('Este item ainda não tem evidência anexada.');
    return;
  }
  if (evidencias.length === 1) {
    openPreview(evidencias[0].id);
    return;
  }
  openSheet({
    title: 'Evidências do item',
    eyebrow: item.name,
    body:
      `<p class="sheet__note">${plural(evidencias.length, 'evidência anexada', 'evidências anexadas')} — ` +
      `escolha qual quer ver.</p>` +
      `<div class="attach-list">${evidencias
        .map((ev) => {
          const kind = fileKind(ev.name, ev.mime);
          return (
            `<button type="button" class="evpick" data-action="evidence-open" data-id="${ev.id}">` +
            `<span class="evpick__main">` +
            `<span class="evpick__name">${esc(ev.name)}</span>` +
            `<span class="evpick__meta">${esc(fileKindLabel(kind))} <i>·</i> ${fmtBytes(ev.size)} ` +
            `<i>·</i> ${esc(fmtDate(ev.addedAt))}</span></span>` +
            `${icon('external', 16)}</button>`
          );
        })
        .join('')}</div>`,
  });
}

/* ------------------------------------------------------------- item dialog */

function openItemDialog() {
  const state = getState();
  const process = state?.process;
  if (!process || !isRequirementsFlow(state)) return;

  /** Nomes pendentes de envio, na ordem em que aparecerão na listagem. */
  const names = [];

  const dialog = openSheet({
    title: 'Adicionar itens',
    eyebrow: process.name,
    body:
      `<p class="sheet__note">Cada item é uma linha desta listagem (por exemplo, um prestador). ` +
      `Ele recebe uma verificação por critério e guarda as evidências que comprovam cada uma.</p>` +
      `<div class="field">` +
      `<label for="item-name">Itens a adicionar <span class="field__optional" data-item-count>0</span></label>` +
      `<div class="criteria-chips" data-item-chips></div>` +
      `<p class="field__hint" data-item-empty>Nenhum item ainda — digite o nome abaixo e tecle Enter.</p>` +
      `<div class="form-row">` +
      `<input id="item-name" type="text" maxlength="220" autocomplete="off" spellcheck="false" ` +
      `placeholder="Nome do item — ex.: RMC">` +
      `<button type="button" class="btn btn--secondary btn--sm" id="item-add">${icon('plus', 15)} Adicionar</button>` +
      `</div>` +
      `<p class="field__hint">A numeração (01, 02…) é automática.</p>` +
      `</div>` +
      `<details class="item-paste">` +
      `<summary>Colar vários de uma vez</summary>` +
      `<textarea id="item-paste" class="input" rows="4" spellcheck="false" ` +
      `placeholder="Um nome por linha — ex.:&#10;RMC&#10;CASA DO ELETRICISTA"></textarea>` +
      `<button type="button" class="btn btn--ghost btn--sm" id="item-paste-add">${icon('plus', 14)} Adicionar todos</button>` +
      `</details>`,
    footer:
      `<button type="button" class="btn btn--ghost" data-close>Cancelar</button>` +
      `<button type="button" class="btn btn--primary" id="item-create" disabled>${icon('plus', 15)} ` +
      `<span data-item-create-label>Adicionar itens</span></button>`,
  });

  const chipsHost = dialog.querySelector('[data-item-chips]');
  const emptyHint = dialog.querySelector('[data-item-empty]');
  const countEl = dialog.querySelector('[data-item-count]');
  const nameInput = dialog.querySelector('#item-name');
  const addBtn = dialog.querySelector('#item-add');
  const createBtn = dialog.querySelector('#item-create');
  const createLabel = dialog.querySelector('[data-item-create-label]');
  const pasteBox = dialog.querySelector('#item-paste');
  const pasteAdd = dialog.querySelector('#item-paste-add');

  const render = () => {
    if (chipsHost) {
      chipsHost.innerHTML = names
        .map(
          (name, index) =>
            `<span class="chip"><b class="chip__num">${String(index + 1).padStart(2, '0')}</b>` +
            `<span>${esc(name)}</span>` +
            `<button type="button" data-item-remove="${index}" aria-label="Remover ${esc(name)}">${icon(
              'close',
              11
            )}</button></span>`
        )
        .join('');
    }
    if (emptyHint) emptyHint.hidden = names.length > 0;
    if (countEl) countEl.textContent = names.length ? `${names.length} ${names.length === 1 ? 'item' : 'itens'}` : '0';
    if (createBtn) createBtn.disabled = names.length === 0;
    if (createLabel) {
      createLabel.textContent = names.length
        ? `Adicionar ${names.length} ${names.length === 1 ? 'item' : 'itens'}`
        : 'Adicionar itens';
    }
  };

  /** Devolve true quando o nome entrou na lista (ignora vazios e repetidos). */
  const pushName = (raw) => {
    const name = String(raw || '').trim().replace(/\s+/g, ' ');
    if (!name) return false;
    const key = name.toLowerCase();
    if (names.some((item) => item.toLowerCase() === key)) return false;
    names.push(name.slice(0, 220));
    return true;
  };

  const addCurrent = () => {
    const raw = nameInput?.value || '';
    if (!pushName(raw)) {
      if (!raw.trim()) nameInput?.focus();
      else toast('Esse item já está na lista.', 'err');
      return;
    }
    if (nameInput) nameInput.value = '';
    render();
    nameInput?.focus();
  };

  addBtn?.addEventListener('click', addCurrent);
  nameInput?.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    addCurrent();
  });

  pasteAdd?.addEventListener('click', () => {
    const lines = String(pasteBox?.value || '').split(/[\r\n]+/);
    let added = 0;
    for (const line of lines) if (pushName(line)) added += 1;
    if (pasteBox) pasteBox.value = '';
    render();
    toast(
      added ? plural(added, 'item adicionado à lista.', 'itens adicionados à lista.') : 'Nenhum item novo.',
      added ? 'ok' : 'err'
    );
  });
  pasteBox?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      pasteAdd?.click();
    }
  });

  chipsHost?.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target.closest('[data-item-remove]') : null;
    if (!target) return;
    const index = Number(target.dataset.itemRemove);
    if (Number.isInteger(index) && index >= 0) {
      names.splice(index, 1);
      render();
    }
  });

  createBtn?.addEventListener('click', async () => {
    if (!names.length) return;
    createBtn.disabled = true;
    const errors = [];
    try {
      let latest = null;
      for (const name of names) {
        try {
          const res = await api.addItem(process.id, { name });
          if (res?.state) latest = res.state;
        } catch (err) {
          errors.push(`${name}: ${err.message || 'falha'}`);
        }
      }
      if (latest) setState(latest);
      dialog.close();
      if (errors.length) toast(`Adicionados ${names.length - errors.length} de ${names.length}. Falharam: ${errors.join('; ')}`, 'err');
      else toast(plural(names.length, 'item adicionado', 'itens adicionados'));
      renderAll({ preserveScroll: true });
    } catch (err) {
      toast(err.message || 'Falha ao adicionar itens.', 'err');
      createBtn.disabled = false;
    }
  });

  render();
  nameInput?.focus();
}

/** Evidência removida do item (e dos checks que a referenciavam). */
async function removeEvidence(evId, { refreshList } = {}) {
  if (!evId) return false;
  const ok = await confirmSheet({
    title: 'Remover evidência?',
    message: 'A evidência será excluída do item e desvinculada das verificações que a usavam.',
    confirmLabel: 'Remover',
    danger: true,
  });
  if (!ok) return false;
  try {
    const res = await api.deleteDocument(evId);
    if (res?.state) setState(res.state);
    // Sem redesenho da página: o item some da lista e das linhas que o citavam.
    if (typeof refreshList === 'function') refreshList();
    syncEvidenceBlocks();
    const doc = docById(getState(), ui.route.id);
    if (doc) syncAfterCheck({ docId: doc.id });
    toast('Evidência excluída.');
    return true;
  } catch (err) {
    toast(err.message || 'Falha ao remover.', 'err');
    return false;
  }
}

/* -------------------------------------------------- anexo por critério */

/** Atualiza só o bloco de evidências da linha visível.
 *  Recriar a linha inteira a cada vínculo fazia a tela "piscar"; aqui o DOM
 *  só muda quando o conteúdo realmente difere. */
function updateCheckEvidence(check) {
  const state = getState();
  if (!state || !check) return;
  const row = document.querySelector(`[data-check-row="${check.id}"]`);
  if (!row) return;
  const doc = docById(state, check.docId);
  const html = evidenceBlockHtml(state, check, doc, doc?.active === false);
  const block = row.querySelector('.check__evidence');
  if (block) {
    if (!html) block.remove();
    else if (block.outerHTML !== html) block.outerHTML = html;
    return;
  }
  if (!html) return;
  const anchor = row.querySelector('.check__options');
  if (anchor) anchor.insertAdjacentHTML('afterend', html);
  else updateCheckRow(check);
}

/** Sincroniza os blocos de evidência de todas as linhas na tela. */
function syncEvidenceBlocks() {
  const state = getState();
  if (!state) return;
  document.querySelectorAll('[data-check-row]').forEach((row) => {
    const check = state.checks.find((c) => c.id === row.getAttribute('data-check-row'));
    if (check) updateCheckEvidence(check);
  });
}

async function updateCheckAttachments(checkId, attachments) {
  const res = await api.updateCheck(checkId, { attachments });
  const fresh = res?.check;
  if (fresh) {
    mergeCheck(res.rev, fresh);
    updateCheckEvidence(fresh);
  }
}

async function unlinkAttachment(checkId, attId) {
  if (!checkId || !attId) return;
  const state = getState();
  const check = state?.checks?.find((c) => c.id === checkId);
  if (!check) return;
  const next = (Array.isArray(check.attachments) ? check.attachments : []).filter((id) => id !== attId);
  try {
    await updateCheckAttachments(checkId, next);
    toast('Evidência desvinculada.');
  } catch (err) { toast(err.message || 'Falha ao desvincular.', 'err'); }
}

/** Lista de evidências do item, com checkbox de vínculo com o check. */
function evidenceListHtml(state, itemId, checkId) {
  const freshCheck = state?.checks?.find((c) => c.id === checkId);
  const attached = new Set(Array.isArray(freshCheck?.attachments) ? freshCheck.attachments : []);
  const children = childDocuments(state, itemId);
  if (!children.length) {
    return `<p class="evidence-empty">Nenhuma evidência neste item. Clique em “Enviar evidência”.</p>`;
  }
  return children
    .map(
      (att) =>
        `<div class="evidence-row" data-ev-id="${att.id}">` +
        `<label class="check-option evidence-row__label" title="Vincular a este critério">` +
        `<input type="checkbox" data-ev-attach="${att.id}" ${attached.has(att.id) ? 'checked' : ''}>` +
        `<span class="evidence-row__main">` +
        `<span class="evidence-row__name">${esc(att.name)}</span>` +
        `<span class="evidence-row__meta">${fmtBytes(att.size)} <i>·</i> ${esc(fmtDate(att.addedAt))}</span>` +
        `</span></label>` +
        `<span class="evidence-row__actions">` +
        `<button type="button" class="iconbtn iconbtn--sm" data-ev-preview="${att.id}" aria-label="Abrir ${esc(att.name)}" title="Abrir">${icon(
          'external',
          16
        )}</button>` +
        `<button type="button" class="iconbtn iconbtn--sm iconbtn--danger" data-ev-delete="${att.id}" aria-label="Excluir ${esc(att.name)}" title="Excluir evidência">${icon(
          'trash',
          16
        )}</button>` +
        `</span></div>`
    )
    .join('');
}

async function openAttachEvidence(checkId, itemId) {
  const state = getState();
  const process = state?.process;
  const item = docById(state, itemId);
  const check = state?.checks?.find((c) => c.id === checkId);
  if (!item || !check) return;
  const criterion = state.criteria.find((c) => c.id === check.criterionId);
  const processId = process?.id;

  const dialog = openSheet({
    title: 'Anexar evidência',
    eyebrow: criterion?.label || item.name,
    body:
      `<p class="sheet__note">Evidências que comprovam <b>${esc(item.name)}</b> — marque quais comprovam este critério.</p>` +
      `<div class="attach-list" style="max-height:340px;overflow:auto;">${evidenceListHtml(state, itemId, checkId)}</div>` +
      `<input type="file" id="att-file" class="sr-only" multiple ` +
      `accept=".pdf,.png,.jpg,.jpeg,.webp,.gif,.heic,.doc,.docx,.xls,.xlsx,.csv,.txt">` +
      `<p class="field__hint">PDF, imagens, planilhas ou documentos — até 32 MB por arquivo.</p>`,
    footer:
      `<button type="button" class="btn btn--secondary" id="att-upload">${icon('upload', 15)} Enviar evidência</button>` +
      `<span class="spacer"></span>` +
      `<button type="button" class="btn btn--primary" data-close>Concluir</button>`,
  });

  const refreshList = () => {
    const listEl = dialog.querySelector('.attach-list');
    if (listEl) listEl.innerHTML = evidenceListHtml(getState(), itemId, checkId);
    bindList();
  };

  const bindList = () => {
    dialog.querySelectorAll('[data-ev-attach]').forEach((box) => {
      box.addEventListener('change', async () => {
        const freshCheck = getState()?.checks?.find((c) => c.id === checkId);
        const current = new Set(Array.isArray(freshCheck?.attachments) ? freshCheck.attachments : []);
        if (box.checked) current.add(box.dataset.evAttach);
        else current.delete(box.dataset.evAttach);
        // Evita duplo clique enquanto a gravação está em curso.
        box.disabled = true;
        try {
          await updateCheckAttachments(checkId, [...current]);
        } catch (err) {
          box.checked = !box.checked;
          toast(err.message || 'Falha ao vincular.', 'err');
        } finally {
          box.disabled = false;
        }
      });
    });
    dialog.querySelectorAll('[data-ev-preview]').forEach((button) => {
      button.addEventListener('click', () => openEvidencePreview(button.dataset.evPreview));
    });
    dialog.querySelectorAll('[data-ev-delete]').forEach((button) => {
      button.addEventListener('click', () => removeEvidence(button.dataset.evDelete, { refreshList }));
    });
  };
  bindList();

  const fileInput = dialog.querySelector('#att-file');
  const uploadBtn = dialog.querySelector('#att-upload');
  uploadBtn?.addEventListener('click', () => fileInput?.click());

  fileInput?.addEventListener('change', async () => {
    const files = [...(fileInput?.files || [])];
    fileInput.value = '';
    if (!files.length) return;
    uploadBtn.disabled = true;
    const failures = [];
    for (const file of files) {
      try {
        if (file.size > MAX_UPLOAD) throw new Error('acima de 32 MB');
        const data = await readBase64(file);
        const res = await api.addDocument(processId, {
          name: file.name,
          mime: file.type || '',
          size: file.size,
          data,
          itemId,
        });
        const created = res?.document;
        if (res?.state) setState(res.state);
        if (created?.id) {
          const freshCheck = getState()?.checks?.find((c) => c.id === checkId);
          const current = new Set(Array.isArray(freshCheck?.attachments) ? freshCheck.attachments : []);
          current.add(created.id);
          await updateCheckAttachments(checkId, [...current]);
        }
      } catch (err) {
        failures.push(`${file.name}: ${err.message || 'falha'}`);
      }
    }
    uploadBtn.disabled = false;
    refreshList();
    if (failures.length) toast(failures.join('; '), 'err');
    else toast('Evidência anexada e vinculada a este critério.');
  });
}

/* ------------------------------------------------------------ onboarding */

function getChips() {
  return [...document.querySelectorAll('#criteria-chips .chip')].map((chip) => chip.dataset.label);
}

function setChips(labels) {
  const host = document.getElementById('criteria-chips');
  if (host) host.innerHTML = chipsHtml(labels);
  updateChipCount();
}

function updateChipCount() {
  const host = document.getElementById('criteria-count');
  if (!host) return;
  const count = getChips().length;
  host.textContent = plural(count, 'critério', 'critérios');
}

function addChip() {
  const input = document.getElementById('criteria-input');
  if (!input) return;
  const label = input.value.trim();
  if (!label) {
    input.focus();
    return;
  }
  const labels = getChips();
  if (labels.includes(label)) {
    toast('Esse critério já está na lista.', 'err');
    return;
  }
  setChips([...labels, label]);
  input.value = '';
  input.focus();
}

async function createProcess(form) {
  const nameInput = form.querySelector('#process-name');
  const descInput = form.querySelector('#process-desc');
  const collectionInput = form.querySelector('#collection-name');
  const name = nameInput?.value.trim() || '';
  const collectionName = collectionInput?.value.trim() || 'Coleção principal';
  if (!name) {
    toast('Dê um nome ao processo.', 'err');
    nameInput?.focus();
    return;
  }
  const criteria = getChips();
  if (!criteria.length) {
    toast('Adicione ao menos um critério.', 'err');
    document.getElementById('criteria-input')?.focus();
    return;
  }

  const button = form.querySelector('#onboard-submit');
  if (button) {
    button.disabled = true;
    button.textContent = 'Criando…';
  }

  try {
    const collectionRes = await api.createCollection({ name: collectionName, description: '' });
    const collectionId = collectionRes.createdCollection.id;
    const res = await api.createProcess({
      collectionId,
      name,
      description: descInput?.value.trim() || '',
      criteria: criteria.map((label) => ({ label })),
    });
    setState(res.state);
    if (res.createdProcess) {
      setActiveProcess(res.createdProcess.id);
      configureApi({ process: res.createdProcess.id });
    }
    if (location.hash !== '#/') history.replaceState(null, '', '#/');
    parseRoute();
    renderAll();
    toast('Processo criado. Agora importe os documentos.');
  } catch (err) {
    toast(err.message, 'err');
    if (button) {
      button.disabled = false;
      button.innerHTML = `${icon('analyze', 17)} Criar processo`;
    }
  }
}

/* ------------------------------------------------------------- ajustes */

async function saveProcess(form) {
  const name = form.querySelector('#setting-name')?.value.trim() || '';
  const description = form.querySelector('#setting-desc')?.value.trim() || '';
  if (!name) {
    toast('O processo precisa de um nome.', 'err');
    return;
  }
  try {
    const res = await api.updateProcess(getState().process.id, { name, description });
    setState(res.state);
    renderAll({ preserveScroll: true });
    toast('Processo atualizado.');
  } catch (err) {
    toast(err.message, 'err');
  }
}

/** Salva a lista de status personalizados do processo ativo (no máximo 2). */
async function saveCustomStatuses(next, message = 'Status atualizados.') {
  const state = getState();
  const pid = state?.process?.id;
  if (!pid) return;
  if (next.length > 2) {
    toast('Máximo de 2 status personalizados.', 'err');
    return;
  }
  try {
    const res = await api.updateProcess(pid, { customStatuses: next });
    setState(res.state);
    renderAll({ preserveScroll: true });
    toast(message);
  } catch (err) {
    toast(err.message || 'Falha ao salvar os status.', 'err');
  }
}

async function addCriterion(form) {
  const input = form.querySelector('input[name="label"]');
  const label = input?.value.trim() || '';
  if (!label) {
    input?.focus();
    return;
  }
  try {
    const res = await api.addCriterion(getState().process.id, { label });
    setState(res.state);
    renderAll({ preserveScroll: true });
    toast('Critério adicionado aos documentos.');
  } catch (err) {
    toast(err.message, 'err');
  }
}

async function saveCriterionLabel(input) {
  const id = input.dataset.criterionLabel;
  const state = getState();
  const criterion = state.criteria.find((c) => c.id === id);
  if (!criterion) return;
  const value = input.value.trim();
  if (!value) {
    input.value = criterion.label;
    toast('O critério não pode ficar vazio.', 'err');
    return;
  }
  if (value === criterion.label) return;
  try {
    const res = await api.updateCriterion(id, { label: value });
    setState(res.state);
  } catch (err) {
    input.value = criterion.label;
    toast(err.message, 'err');
  }
}

async function moveCriterion(id, delta) {
  const state = getState();
  const crit = criteriaSorted(state);
  const index = crit.findIndex((c) => c.id === id);
  const target = index + delta;
  if (index < 0 || target < 0 || target >= crit.length) return;
  const ids = crit.map((c) => c.id);
  [ids[index], ids[target]] = [ids[target], ids[index]];
  try {
    const res = await api.reorderCriteria(ids);
    setState(res.state);
    renderAll({ preserveScroll: true });
  } catch (err) {
    toast(err.message, 'err');
  }
}

async function deleteCriterion(id) {
  const state = getState();
  const criterion = state.criteria.find((c) => c.id === id);
  if (!criterion) return;
  const affected = state.checks.filter((check) => check.criterionId === id).length;
  const ok = await confirmSheet({
    title: 'Excluir critério?',
    message:
      `<b>${esc(criterion.label)}</b> será removido` +
      (affected ? ` e ${plural(affected, 'verificação vinculada', 'verificações vinculadas')} também.` : '.'),
    confirmLabel: 'Excluir critério',
    danger: true,
  });
  if (!ok) return;
  try {
    const res = await api.deleteCriterion(id);
    setState(res.state);
    renderAll({ preserveScroll: true });
    toast('Critério removido.');
  } catch (err) {
    toast(err.message, 'err');
  }
}

/** Exclui o processo aberto com tudo que pertence a ele: documentos, arquivos,
 *  critérios e verificações. Nenhum outro processo é afetado. */
async function deleteCurrentProcess() {
  const state = getState();
  const process = state?.process;
  if (!process) {
    toast('Abra o processo que deseja excluir.', 'err');
    return;
  }
  const collectionId = state.collection?.id || process.collectionId;
  const contado = (n, um, varios) => (n ? plural(n, um, varios) : '');
  const partes = [
    contado(state.documents?.length || 0, 'documento', 'documentos'),
    contado(state.checks?.length || 0, 'verificação', 'verificações'),
    contado(state.criteria?.length || 0, 'critério', 'critérios'),
  ].filter(Boolean);
  const lista =
    partes.length > 1 ? `${partes.slice(0, -1).join(', ')} e ${partes[partes.length - 1]}` : partes[0] || '';
  const ok = await confirmSheet({
    title: 'Excluir este processo?',
    message:
      (lista
        ? `“${process.name}” sai do SCAD com ${lista}, mais os arquivos enviados. `
        : `“${process.name}” sai do SCAD. `) +
      `Nenhum outro processo da coleção é afetado. Não há desfazer.`,
    confirmLabel: 'Excluir processo',
    danger: true,
    requireText: process.name,
  });
  if (!ok) return;
  try {
    await api.deleteProcess(process.id);
    setActiveProcess(null);
    configureApi({ process: null });
    setState(await api.state());
    navigate(`#/colecoes/${collectionId || ''}`, { force: true });
    toast('Processo excluído.');
  } catch (err) {
    toast(err.message, 'err');
  }
}

async function restoreBackup(file) {
  let parsed;
  try {
    parsed = JSON.parse(await file.text());
  } catch {
    toast('O arquivo não é um JSON válido.', 'err');
    return;
  }
  const incoming = parsed?.state?.state ?? parsed?.state ?? parsed;
  if (
    !incoming ||
    typeof incoming !== 'object' ||
    (!Array.isArray(incoming.documents) && !Array.isArray(incoming.collections))
  ) {
    toast('Backup não reconhecido.', 'err');
    return;
  }
  const ok = await confirmSheet({
    title: 'Restaurar backup?',
    message:
      `O estado atual será substituído por <b>${
        esc(incoming.collections?.[0]?.name || incoming.process?.name || 'arquivo de backup')
      }</b> ` +
      `(${plural(incoming.documents?.length || 0, 'documento', 'documentos')}). ` +
      `Os arquivos referenciados precisam existir nesta máquina.`,
    confirmLabel: 'Restaurar backup',
    danger: true,
  });
  if (!ok) return;
  try {
    const res = await api.importState(incoming);
    setState(res.state);
    const first = res.state?.processes?.[0] || null;
    if (first) {
      const scoped = await api.state(first.id);
      setState(scoped);
      setActiveProcess(first.id);
      configureApi({ process: first.id });
      navigate('#/', { force: true });
    } else {
      setActiveProcess(null);
      configureApi({ process: null });
      navigate('#/colecoes', { force: true });
    }
    toast('Backup restaurado.');
  } catch (err) {
    toast(err.message, 'err');
  }
}

/* ---------------------------------------------------------- apontamentos */

function editFinding(checkId) {
  const state = getState();
  const check = state.checks.find((c) => c.id === checkId);
  if (!check) return;
  const doc = docById(state, check.docId);
  const criterion = state.criteria.find((c) => c.id === check.criterionId);

  const dialog = openSheet({
    title: 'Nota do apontamento',
    eyebrow: `${doc?.name || 'Documento'} · ${criterion?.label || 'Critério'}`,
    body:
      `<div class="field"><label for="finding-note">Observação registrada</label>` +
      `<textarea id="finding-note" rows="5" placeholder="Descreva o problema, o trecho ou o que precisa ser corrigido…">${esc(
        check.note || ''
      )}</textarea></div>` +
      `<p class="sheet__note">${stamp(check.status)} Resultado atual da verificação.</p>`,
    footer:
      `<button type="button" class="btn btn--ghost" data-cancel>Cancelar</button>` +
      `<button type="button" class="btn btn--primary" data-save>Salvar nota</button>`,
  });

  const textarea = dialog.querySelector('#finding-note');
  textarea?.focus();
  dialog.querySelector('[data-cancel]')?.addEventListener('click', () => dialog.close());
  dialog.querySelector('[data-save]')?.addEventListener('click', async () => {
    const value = textarea.value;
    try {
      const res = await api.updateCheck(check.id, { note: value });
      mergeCheck(res.rev, res.check);
      dialog.close();
      renderAll({ preserveScroll: true });
      toast('Nota atualizada.');
    } catch (err) {
      toast(err.message, 'err');
    }
  });
}

/* ------------------------------------------------------------ exportação */

function csvCell(value) {
  return `"${String(value ?? '').replace(/"/g, '""')}"`;
}

function dateStamp() {
  return new Date().toISOString().slice(0, 10);
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function exportCsv() {
  const state = getState();
  if (!state?.checks?.length) {
    toast('Nada para exportar ainda.', 'err');
    return;
  }
  const crit = criteriaSorted(state);
  const requirementsMode = isRequirementsFlow(state);
  const listable = (state.documents || []).filter((d) => !d.itemId);
  const evidenceNames = (ids) =>
    (Array.isArray(ids) ? ids : [])
      .map((id) => (state.documents || []).find((d) => d.id === id)?.name)
      .filter(Boolean)
      .join(' | ');
  const collectionName = state.collection?.name || '';
  const processName = state.process?.name || '';
  const processCode = state.process?.code || '';
  const subjectsHeader = requirementsMode ? 'Linha' : 'Documento';
  const rows = [
    [
      'Coleção',
      'Processo',
      'Código',
      subjectsHeader,
      'Situação',
      'Critério',
      'Resultado',
      'Nota',
      ...(requirementsMode ? ['Evidências'] : []),
      'Revisão',
      'Revisor',
      'Mensagem da revisão',
      'Revisado em',
      'Atualizado em',
    ],
  ];
  const reviewLabels = { pending: 'Aguardando revisão', approved: 'Aprovada', flagged: 'Sinalizada' };
  for (const doc of listable) {
    for (const criterion of crit) {
      const check = state.checks.find((c) => c.docId === doc.id && c.criterionId === criterion.id);
      if (!check) continue;
      const review = checkReview(check);
      rows.push([
        collectionName,
        processName,
        processCode,
        doc.name,
        doc.active === false ? `Inativo — ${doc.inactiveReason || 'sem motivo'}` : 'Ativo',
        criterion.label,
        doc.active === false ? 'Suspenso' : statusLabelFor(state, check.status),
        check.note || '',
        ...(requirementsMode ? [evidenceNames(check.attachments)] : []),
        doc.active === false ? '' : reviewLabels[review] || '',
        doc.active === false ? '' : check.review?.byName || '',
        doc.active === false ? '' : check.review?.note || '',
        doc.active === false ? '' : check.review?.at ? new Date(check.review.at).toLocaleString('pt-BR') : '',
        check.updatedAt ? new Date(check.updatedAt).toLocaleString('pt-BR') : '',
      ]);
    }
  }
  const csv = rows.map((row) => row.map(csvCell).join(';')).join('\r\n');
  const blob = new Blob([`\ufeff${csv}`], { type: 'text/csv;charset=utf-8' });
  downloadBlob(blob, `scad-${processCode || 'verificacoes'}-${dateStamp()}.csv`);
  toast('CSV exportado com as verificações.');
}

/* -------------------------------------------------------------- sincronia */

async function syncIfIdle() {
  const state = getState();
  if (!state?.process || document.hidden || importBusy || syncing || navigating) return;
  if (activeWrites > 0 || noteTimers.size > 0) return;
  if (isEditing() || document.querySelector('dialog[open]')) return;
  if (!navigator.onLine) return;
  syncing = true;
  try {
    const next = await api.state(getState().process?.id);
    if (next.rev !== getState().rev) {
      if (canPatchInPlace(next)) patchRemoteState(next);
      else {
        setState(next);
        renderAll({ preserveScroll: true });
      }
      if (Date.now() - lastSyncToast > 30000) {
        lastSyncToast = Date.now();
        toast('Atualizado a partir de outro dispositivo.');
      }
    }
  } catch {
    /* servidor off-line: a próxima tentativa resolve */
  } finally {
    syncing = false;
  }
}

/**
 * Dá para atualizar sem reconstruir a página? Sim quando a estrutura não mudou:
 * mesmos documentos, mesmos critérios e linhas de verificação na tela.
 */
function canPatchInPlace(next) {
  const cur = getState();
  if (!cur?.process || !next?.process) return false;
  if (cur.process.id !== next.process.id) return false;
  if (!document.querySelector('[data-check-row]')) return false;
  const ids = (list) => (list || []).map((item) => item.id).join('|');
  if (ids(cur.documents) !== ids(next.documents)) return false;
  if (ids(cur.criteria) !== ids(next.criteria)) return false;
  if (ids(cur.process.customStatuses) !== ids(next.process.customStatuses)) return false;
  return true;
}

/** Atualiza dados de outro dispositivo mexendo só no que está na tela. */
function patchRemoteState(next) {
  setState(next);
  document.querySelectorAll('[data-check-row]').forEach((row) => {
    const check = next.checks.find((c) => c.id === row.dataset.checkRow);
    if (check) updateCheckRow(check);
    else row.remove();
  });
  const doc = docById(next, ui.route.id);
  if (doc) syncAfterCheck({ docId: doc.id });
  else {
    renderMasthead();
    renderNav();
  }
}
