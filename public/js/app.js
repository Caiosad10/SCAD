/** SCAD — shell, rotas, interações e importação. */
import { api } from './api.js';
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
} from './store.js';
import {
  esc,
  fmtBytes,
  fmtInt,
  fmtTime,
  plural,
  toast,
  openSheet,
  confirmSheet,
  copyText,
  isEditing,
  fileKind,
  fileKindLabel,
  stamp,
  STATUS_LABEL,
  markSave,
} from './ui.js';
import { icon } from './icons.js';
import { renderOnboarding, chipsHtml, PRESET_LIST } from './views/onboarding.js';
import { renderDashboard } from './views/dashboard.js';
import { renderDocuments, renderDocumentsList, renderDocument, filterDocuments } from './views/documents.js';
import { renderWorkbench, resolveWorkbenchDoc } from './views/workbench.js';
import { renderFindings, renderFindingsResults } from './views/findings.js';
import { renderSettings } from './views/settings.js';
import { renderCheckRow, docSummaryHtml, checksHeadHtml, doneBannerHtml } from './views/checks.js';

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

let navReady = false;
let navEl = null;
let pillEl = null;
let pillTrack = 0;
let navActive = null;
let mastheadMode = null;

/* ---------------------------------------------------------------- boot */

boot();

function rememberRoute() {
  try {
    const hash = location.hash;
    if (!hash || hash === '#/' || hash === '#') {
      localStorage.removeItem(LAST_ROUTE_KEY);
      return;
    }
    localStorage.setItem(LAST_ROUTE_KEY, JSON.stringify({ hash, at: Date.now() }));
  } catch {
    /* armazenamento indisponível */
  }
}

function restoreLastRoute() {
  try {
    if (location.hash && location.hash !== '#/' && location.hash !== '#') return;
    const navEntry = performance.getEntriesByType?.('navigation')?.[0];
    const standalone =
      window.navigator.standalone === true ||
      window.matchMedia?.('(display-mode: standalone)')?.matches === true;
    const reloaded = navEntry ? navEntry.type === 'reload' || navEntry.type === 'back_forward' : false;
    if (!standalone && !reloaded) return;

    const saved = JSON.parse(localStorage.getItem(LAST_ROUTE_KEY) || 'null');
    if (!saved?.hash || !saved.hash.startsWith('#/') || saved.hash === '#/') return;
    if (Date.now() - Number(saved.at || 0) > 24 * 60 * 60 * 1000) return;
    history.replaceState(null, '', saved.hash);
  } catch {
    /* sem rota salva */
  }
}

async function boot() {
  bindEvents();
  restoreLastRoute();
  let paintedFromCache = false;

  const cached = readCachedState();
  if (cached?.process) {
    setState(cached);
    paintApp();
    paintedFromCache = true;
  }

  try {
    const [state, health] = await Promise.all([api.state(), api.health().catch(() => null)]);
    setState(state);
    ui.health = health;
    parseRoute();
    rememberRoute();
    renderAll({ preserveScroll: paintedFromCache });
    revealApp();
  } catch (err) {
    if (paintedFromCache) {
      toast('Servidor indisponível — exibindo a última cópia local.', 'err');
    } else {
      showBootError(err);
    }
  }

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
  if (!bootEl.classList.contains('is-hidden')) {
    bootEl.classList.add('is-hidden');
    setTimeout(() => bootEl.remove(), 450);
  }
}

function showBootError(err) {
  const bootEl = document.getElementById('boot');
  if (!bootEl) return;
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
  if (parts[0] === 'documentos') route = parts[1] ? { name: 'document', id: parts[1] } : { name: 'documents' };
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
}

function navigate(hash, { force = false } = {}) {
  if (location.hash === hash) {
    if (force) {
      parseRoute();
      renderAll();
    }
    return;
  }
  location.hash = hash;
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
        await leave.finished;
      } catch {
        /* animação cancelada */
      }
    }

    renderAll();
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
  mainEl.innerHTML = renderView();
  document.title = `${screenLabel()} · SCAD`;
  if (preserveScroll) window.scrollTo(0, y);
  else window.scrollTo(0, 0);
}

function renderView() {
  const state = getState();
  if (!state || !state.process) return renderOnboarding();
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
  if (!state?.process) {
    if (mastheadMode !== 'bare') {
      mastheadMode = 'bare';
      mastEl.className = 'masthead masthead--bare';
      mastEl.innerHTML =
        `<div class="masthead__inner"><div class="masthead__top">` +
        `<a class="brand" href="#/" aria-label="Ir para o início">${brandHtml()}</a>` +
        `<span class="masthead__kicker">Configuração inicial</span>` +
        `</div></div>`;
    }
    return;
  }

  if (mastheadMode !== 'full') {
    mastheadMode = 'full';
    mastEl.className = 'masthead';
    mastEl.innerHTML =
      `<div class="masthead__inner">` +
      `<div class="masthead__top">` +
      `<a class="brand" href="#/" aria-label="Ir para o painel">${brandHtml()}</a>` +
      `<div class="masthead__tools">` +
      `<button type="button" class="btn btn--paper btn--sm" data-action="open-import">${icon(
        'upload',
        15
      )} Importar</button>` +
      `<a class="iconbtn iconbtn--onink" href="#/ajustes" aria-label="Ajustes do processo" title="Ajustes">${icon(
        'settings',
        18
      )}</a>` +
      `</div></div>` +
      `<div class="masthead__context">` +
      `<div>` +
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
  const eyebrow = mastEl.querySelector('[data-mast-eyebrow]');
  const title = mastEl.querySelector('[data-mast-title]');
  const meta = mastEl.querySelector('[data-mast-meta]');
  const pct = mastEl.querySelector('[data-mast-pct]');
  const fill = mastEl.querySelector('[data-mast-fill]');
  const gauge = mastEl.querySelector('[data-mast-gauge]');
  const eyebrowText = `Processo ${state.process.code} · ${screenLabel()}`;

  if (eyebrow && eyebrow.textContent !== eyebrowText) eyebrow.textContent = eyebrowText;
  if (title && title.textContent !== state.process.name) title.textContent = state.process.name;
  if (meta) meta.innerHTML = metaLine(state);
  if (pct) pct.textContent = String(s.pct);
  if (fill) fill.style.width = `${s.pct}%`;
  if (gauge) gauge.setAttribute('aria-label', `${s.pct}% das verificações concluídas`);
}

function ensureNav() {
  const state = getState();
  if (!state?.process) {
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
      `<div class="nav-shell"><nav class="nav" aria-label="Navegação principal">` +
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
  pillEl.style.opacity = '1';
  pillEl.style.top = `${rect.top - navRect.top - navEl.clientTop}px`;
  pillEl.style.height = `${rect.height}px`;
  pillEl.style.width = `${rect.width}px`;
  pillEl.style.transform = `translate3d(${rect.left - navRect.left - navEl.clientLeft}px, 0, 0)`;
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
  window.addEventListener('hashchange', () => {
    handleRouteChange();
  });

  window.addEventListener('resize', () => {
    if (navReady) updatePill();
  });

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

  document.addEventListener('input', (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (target.matches('[data-filter="doc-query"]')) {
      ui.docQuery = target.value;
      refreshDocList();
    } else if (target.matches('[data-filter="find-query"]')) {
      ui.findQuery = target.value;
      refreshFindings();
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
    if (!document.hidden) syncIfIdle();
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

const ACTIONS = {
  'open-import': () => openImportDialog(),
  'export-csv': () => exportCsv(),
  print: () => window.print(),
  copy: async (el) => {
    const ok = await copyText(el.dataset.value || '');
    toast(ok ? 'Endereço copiado.' : 'Não foi possível copiar.', ok ? 'ok' : 'err');
  },
  'filter-docs': (el) => {
    ui.docFilter = el.dataset.filter || 'all';
    renderAll({ preserveScroll: true });
  },
  'clear-doc-filters': () => {
    ui.docFilter = 'all';
    ui.docQuery = '';
    renderAll({ preserveScroll: true });
  },
  'filter-findings': (el) => {
    ui.findFilter = el.dataset.filter || 'all';
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
    renderAll({ preserveScroll: true });
  },
  'queue-scope': (el) => {
    ui.queueAll = el.dataset.scope === 'all';
    renderAll({ preserveScroll: true });
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
  'doc-rename': (el) => renameDoc(el.dataset.id),
  'doc-delete': (el) => deleteDoc(el.dataset.id),
  'finding-edit': (el) => editFinding(el.dataset.checkId),
  'criterion-up': (el) => moveCriterion(el.dataset.id, -1),
  'criterion-down': (el) => moveCriterion(el.dataset.id, 1),
  'criterion-delete': (el) => deleteCriterion(el.dataset.id),
  'restore-backup': () => document.getElementById('restore-input')?.click(),
  'reset-data': () => resetAll(),
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
    el.textContent = docFlag(state, doc.id) === 'flagged' ? '!' : `${st.done}/${st.total}`;
  });
}

function syncAfterCheck(check) {
  const state = getState();
  const doc = docById(state, check.docId);
  renderMasthead();
  renderNav();
  if (!doc) return;
  const head = document.querySelector('.checks [data-checks-head]');
  if (head) head.outerHTML = checksHeadHtml(state, doc);
  const slot = document.querySelector('.checks [data-done-slot]');
  if (slot) slot.innerHTML = doneBannerHtml(state, doc);
  const summary = document.querySelector('[data-doc-summary]');
  if (summary) summary.innerHTML = docSummaryHtml(state, doc);
  refreshQueueCounts();
}

function updateCheckRow(check, { focus = false, focusNote = false, status = null } = {}) {
  const state = getState();
  const row = document.querySelector(`[data-check-row="${check.id}"]`);
  if (!row) return;
  const criterion = state.criteria.find((c) => c.id === check.criterionId);
  const crit = criteriaSorted(state);
  const index = crit.findIndex((c) => c.id === check.criterionId);
  const holder = document.createElement('div');
  holder.innerHTML = renderCheckRow(state, check, criterion, index, {
    isLast: index === crit.length - 1,
  });
  const next = holder.firstElementChild;
  if (!next) return;
  row.replaceWith(next);
  if (focus && status) {
    next.querySelector(`[data-status="${status}"]`)?.focus({ preventScroll: true });
  }
  if (focusNote) {
    next.querySelector('[data-note-id]')?.focus();
  }
}

/* -------------------------------------------------------------- checks */

async function setCheckStatus(checkId, status, { focusNote = false } = {}) {
  const state = getState();
  const check = state.checks.find((c) => c.id === checkId);
  if (!check) return;

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
    focusNote: focusNote && (status === 'nc' || status === 'obs'),
  });
  syncAfterCheck(check);
  activeWrites += 1;
  markSave(document.querySelector(`[data-check-row="${checkId}"]`), 'saving');

  try {
    const res = await api.updateCheck(checkId, { status, note: noteNow });
    mergeCheck(res.rev, res.check);
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

function openPreview(docId) {
  const doc = docById(getState(), docId);
  if (!doc) return;
  const url = api.fileUrl(doc.stored);
  const kind = fileKind(doc.name, doc.mime);
  let body;
  if (kind === 'pdf') {
    body =
      `<iframe class="preview-frame" src="${url}#view=FitH" title="Pré-visualização de ${esc(doc.name)}"></iframe>` +
      `<p class="sheet__note">No iPad, se o PDF não aparecer aqui, use “Abrir em nova aba”.</p>`;
  } else if (kind === 'image') {
    body = `<img class="preview-image" src="${url}" alt="${esc(doc.name)}" loading="lazy">`;
  } else {
    body =
      `<div class="preview-fallback">${icon('file', 22)}` +
      `<p>Este formato não tem pré-visualização no navegador. Abra ou baixe o arquivo.</p></div>`;
  }
  openSheet({
    title: doc.name,
    eyebrow: `${fileKindLabel(kind)} · ${fmtBytes(doc.size)}`,
    body,
    wide: true,
    footer:
      `<a class="btn btn--secondary" href="${url}" target="_blank" rel="noopener">${icon('external', 15)} Abrir em nova aba</a>` +
      `<a class="btn btn--primary" href="${url}?download=1" download>${icon('download', 15)} Baixar</a>`,
  });
}

function renameDoc(docId) {
  const doc = docById(getState(), docId);
  if (!doc) return;
  const dialog = openSheet({
    title: 'Renomear documento',
    eyebrow: fileKindLabel(fileKind(doc.name, doc.mime)),
    body:
      `<div class="field"><label for="rename-input">Nome do arquivo</label>` +
      `<input id="rename-input" type="text" maxlength="220" value="${esc(doc.name)}"></div>` +
      `<p class="sheet__note">O arquivo em si não é alterado — apenas o nome que aparece no processo.</p>`,
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
      const res = await api.renameDocument(doc.id, value);
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

async function deleteDoc(docId) {
  const doc = docById(getState(), docId);
  if (!doc) return;
  const st = docStats(getState(), doc.id);
  const ok = await confirmSheet({
    title: 'Excluir documento?',
    message:
      `<b>${esc(doc.name)}</b> e ${plural(st.total, 'verificação vinculada', 'verificações vinculadas')} ` +
      `serão removidos, junto com o arquivo enviado. Não há como desfazer.`,
    confirmLabel: 'Excluir documento',
    danger: true,
  });
  if (!ok) return;
  try {
    const res = await api.deleteDocument(doc.id);
    setState(res.state);
    if (ui.route.name === 'document' || ui.route.name === 'workbench') navigate('#/documentos');
    else renderAll({ preserveScroll: true });
    toast('Documento excluído.');
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
      const res = await api.addDocument({ name: file.name, mime: file.type || '', size: file.size, data });
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
  const name = nameInput?.value.trim() || '';
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
    button.textContent = 'Criando processo…';
  }

  try {
    const res = await api.createProcess({
      name,
      description: descInput?.value.trim() || '',
      criteria: criteria.map((label) => ({ label })),
    });
    setState(res.state);
    if (location.hash !== '#/') {
      history.replaceState(null, '', '#/');
    }
    parseRoute();
    renderAll({ entering: true });
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
    const res = await api.updateProcess({ name, description });
    setState(res.state);
    renderAll({ preserveScroll: true });
    toast('Processo atualizado.');
  } catch (err) {
    toast(err.message, 'err');
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
    const res = await api.addCriterion({ label });
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

async function resetAll() {
  const state = getState();
  const ok = await confirmSheet({
    title: 'Apagar todos os dados?',
    message:
      `Serão apagados o processo, ${plural(state.documents.length, 'documento', 'documentos')}, ` +
      `${plural(state.checks.length, 'verificação', 'verificações')} e os arquivos enviados. ` +
      `Baixe um backup antes, se quiser guardar o histórico.`,
    confirmLabel: 'Apagar tudo',
    danger: true,
  });
  if (!ok) return;
  try {
    const res = await api.reset();
    setState(res.state);
    ui.docFilter = 'all';
    ui.docQuery = '';
    ui.findFilter = 'all';
    ui.findQuery = '';
    ui.queueAll = false;
    navigate('#/', { force: true });
    toast('Dados apagados. Um novo processo pode ser criado.');
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
  const incoming = parsed?.state ?? parsed;
  if (!incoming || typeof incoming !== 'object' || !Array.isArray(incoming.documents)) {
    toast('Backup não reconhecido.', 'err');
    return;
  }
  const ok = await confirmSheet({
    title: 'Restaurar backup?',
    message:
      `O estado atual será substituído por <b>${esc(incoming.process?.name || 'processo sem nome')}</b> ` +
      `(${plural(incoming.documents.length, 'documento', 'documentos')}). ` +
      `Os arquivos referenciados precisam existir nesta máquina.`,
    confirmLabel: 'Restaurar backup',
    danger: true,
  });
  if (!ok) return;
  try {
    const res = await api.importState(incoming);
    setState(res.state);
    navigate('#/', { force: true });
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
  const rows = [['Documento', 'Critério', 'Resultado', 'Nota', 'Atualizado em']];
  for (const doc of state.documents) {
    for (const criterion of crit) {
      const check = state.checks.find((c) => c.docId === doc.id && c.criterionId === criterion.id);
      if (!check) continue;
      rows.push([
        doc.name,
        criterion.label,
        STATUS_LABEL[check.status] || check.status,
        check.note || '',
        check.updatedAt ? new Date(check.updatedAt).toLocaleString('pt-BR') : '',
      ]);
    }
  }
  const csv = rows.map((row) => row.map(csvCell).join(';')).join('\r\n');
  const blob = new Blob([`\ufeff${csv}`], { type: 'text/csv;charset=utf-8' });
  downloadBlob(blob, `scad-verificacoes-${dateStamp()}.csv`);
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
    const next = await api.state();
    if (next.rev !== getState().rev) {
      setState(next);
      renderAll({ preserveScroll: true });
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
