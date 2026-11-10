/**
 * Verificação automatizada por CDP: layout, barra flutuante, responsividade,
 * erros de console, acessibilidade básica de alvos e fluxo de trabalho.
 *
 * Requer um Edge headless com --remote-debugging-port=9333.
 * Uso: node scripts/qa.mjs http://127.0.0.1:4188
 */
import fs from 'node:fs/promises';
import path from 'node:path';

const CDP = process.env.CDP || 'http://127.0.0.1:9333';
const BASE = (process.argv[2] || 'http://127.0.0.1:4188').replace(/\/$/, '');
const SHOTS = path.join(process.cwd(), 'shots');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

class CDPClient {
  constructor(url) {
    this.url = url;
    this.ws = null;
    this.seq = 0;
    this.pending = new Map();
    this.waiters = new Map();
    this.errors = [];
  }

  async connect() {
    this.ws = new WebSocket(this.url);
    await new Promise((resolve, reject) => {
      this.ws.onopen = resolve;
      this.ws.onerror = () => reject(new Error('Falha ao conectar no WebSocket do CDP.'));
    });
    this.ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.id) {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        if (message.error) pending.reject(new Error(message.error.message));
        else pending.resolve(message.result);
        return;
      }
      this.onEvent(message);
    };
  }

  onEvent(message) {
    if (message.method === 'Runtime.exceptionThrown') {
      const details = message.params.exceptionDetails;
      this.errors.push({
        kind: 'exception',
        text: details.exception?.description || details.text || 'exceção',
      });
    } else if (message.method === 'Log.entryAdded' && message.params.entry.level === 'error') {
      this.errors.push({ kind: 'log', text: message.params.entry.text });
    } else if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
      this.errors.push({
        kind: 'console',
        text: message.params.args.map((arg) => arg.value ?? arg.description ?? '').join(' '),
      });
    }

    const list = this.waiters.get(message.method);
    if (list?.length) {
      this.waiters.delete(message.method);
      list.forEach((waiter) => waiter.resolve(message.params));
    }
  }

  send(method, params = {}, timeout = 20000) {
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Timeout em ${method}`));
      }, timeout);
      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  waitFor(method, timeout = 10000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Timeout aguardando ${method}`)), timeout);
      const list = this.waiters.get(method) || [];
      list.push({
        resolve: (params) => {
          clearTimeout(timer);
          resolve(params);
        },
      });
      this.waiters.set(method, list);
    });
  }

  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
      userGesture: true,
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description || 'Erro ao avaliar expressão.');
    }
    return result.result.value;
  }
}

const METRICS = `(() => {
  const box = (el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return {
      top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left),
      right: Math.round(r.right), width: Math.round(r.width), height: Math.round(r.height),
      pe: cs.pointerEvents, display: cs.display, position: cs.position
    };
  };
  const nav = document.querySelector('.nav');
  const shell = document.querySelector('.nav-shell');
  const active = document.querySelector('.nav__link[aria-current="page"]');
  const inactive = document.querySelector('.nav__link:not([aria-current="page"])');
  const content = document.querySelector('.content');
  const navRect = nav ? nav.getBoundingClientRect() : null;
  const point = navRect ? document.elementFromPoint(8, Math.round(navRect.top + 8)) : null;
  const wide = [...document.querySelectorAll('main *, header *, nav *')]
    .filter((el) => {
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.right <= innerWidth + 1.5) return false;
      if (el.closest('.queue__list, .matrix__scroll, .segmented, .import-list')) return false;
      return getComputedStyle(el).position !== 'fixed';
    })
    .slice(0, 4)
    .map((el) => (typeof el.className === 'string' ? el.className : el.tagName).slice(0, 70));
  const anchors = [...document.querySelectorAll('.opt, .btn, .nav__link, .iconbtn')]
    .map((el) => el.getBoundingClientRect().height)
    .filter((h) => h > 0);
  return {
    title: document.title,
    hash: location.hash,
    viewport: { w: innerWidth, h: innerHeight },
    scrollWidth: document.documentElement.scrollWidth,
    bodyScrollWidth: document.body.scrollWidth,
    headerHeight: Math.round(document.querySelector('.masthead')?.getBoundingClientRect().height || 0),
    nav: nav ? box(nav) : null,
    navCenterDelta: navRect ? Math.round((navRect.left + navRect.right) / 2 - innerWidth / 2) : null,
    navShellPe: shell ? getComputedStyle(shell).pointerEvents : null,
    navPe: nav ? getComputedStyle(nav).pointerEvents : null,
    activeNav: active?.textContent.trim() || null,
    activeLabelDisplay: active ? getComputedStyle(active.querySelector('.nav__label')).display : null,
    inactiveLabelDisplay: inactive ? getComputedStyle(inactive.querySelector('.nav__label')).display : null,
    contentPadBottom: content ? getComputedStyle(content).paddingBottom : null,
    cards: document.querySelectorAll('.card').length,
    docRows: document.querySelectorAll('.docrow').length,
    checks: document.querySelectorAll('[data-check-row]').length,
    findings: document.querySelectorAll('.finding').length,
    matrixRows: document.querySelectorAll('.matrix tbody tr').length,
    clickThrough: point ? { tag: point.tagName, cls: String(point.className).slice(0, 50) } : null,
    minTargetHeight: anchors.length ? Math.round(Math.min(...anchors)) : null,
    smallTargets: [...document.querySelectorAll('.nav__link, .iconbtn, .opt')].filter((el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && (r.height < 36 || r.width < 36);
    }).length,
    serif: getComputedStyle(document.querySelector('.masthead__title') || document.body).fontFamily,
    wideElements: wide,
    online: navigator.onLine,
  };
})()`;

const BOTTOM = `(async () => {
  window.scrollTo(0, document.documentElement.scrollHeight);
  await new Promise((r) => setTimeout(r, 260));
  const nav = document.querySelector('.nav');
  const items = [...document.querySelectorAll('.content > .view > *, .content > .page > *')];
  const last = items.filter((el) => el.getBoundingClientRect().height > 0).pop() || null;
  const navTop = nav ? nav.getBoundingClientRect().top : innerHeight;
  const lastBottom = last ? last.getBoundingClientRect().bottom : 0;
  const result = {
    scrollY: Math.round(window.scrollY),
    navTop: Math.round(navTop),
    lastBottom: Math.round(lastBottom),
    gap: Math.round(navTop - lastBottom),
    maxScroll: Math.round(document.documentElement.scrollHeight - innerHeight),
  };
  window.scrollTo(0, 0);
  await new Promise((r) => setTimeout(r, 120));
  return result;
})()`;

function contrast(hexA, hexB) {
  const lum = (hex) => {
    const value = hex.replace('#', '');
    const rgb = [0, 2, 4].map((i) => parseInt(value.slice(i, i + 2), 16) / 255);
    const lin = rgb.map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
  };
  const a = lum(hexA);
  const b = lum(hexB);
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return Number(((hi + 0.05) / (lo + 0.05)).toFixed(2));
}

async function getState() {
  const response = await fetch(`${BASE}/api/state`);
  return response.json();
}

async function main() {
  await fs.mkdir(SHOTS, { recursive: true });
  const state = await getState();
  if (!state.process) throw new Error('Sem processo no servidor de QA. Rode make-demo.mjs antes.');

  const targetDoc =
    state.documents.find((doc) => doc.name === 'contrato-014-2026.pdf') || state.documents[0];
  const pendingDoc =
    state.documents.find((doc) => doc.name === 'ficha-cadastro.pdf') || targetDoc;

  const target = await (
    await fetch(`${CDP}/json/new?${encodeURIComponent('about:blank')}`, { method: 'PUT' })
  ).json();
  const client = new CDPClient(target.webSocketDebuggerUrl);
  await client.connect();
  await client.send('Page.enable');
  await client.send('Runtime.enable');
  await client.send('Log.enable');
  await client.send('Network.enable');
  await client.send('Network.setCacheDisabled', { cacheDisabled: true });

  const results = [];
  const shots = [];
  let navCounter = 0;

  const routes = [
    { id: 'painel', hash: '#/', label: 'Painel' },
    { id: 'documentos', hash: '#/documentos', label: 'Documentos' },
    { id: 'documento', hash: `#/documentos/${targetDoc.id}`, label: 'Documento' },
    { id: 'bancada', hash: `#/analisar/${targetDoc.id}`, label: 'Bancada' },
    { id: 'apontamentos', hash: '#/apontamentos', label: 'Apontamentos' },
    { id: 'ajustes', hash: '#/ajustes', label: 'Ajustes' },
  ];

  const combos = [
    { w: 1440, h: 1000, name: 'desktop', routes: routes.map((r) => r.id) },
    { w: 1180, h: 820, name: 'notebook', routes: ['painel', 'documentos', 'bancada', 'apontamentos'] },
    {
      w: 834,
      h: 1194,
      name: 'ipad-retrato',
      routes: ['painel', 'documentos', 'bancada', 'apontamentos', 'ajustes'],
    },
    { w: 1194, h: 834, name: 'ipad-paisagem', routes: ['bancada', 'documento'] },
    { w: 390, h: 844, name: 'telefone', routes: ['painel', 'bancada', 'documentos'] },
  ];

  for (const combo of combos) {
    await client.send('Emulation.setDeviceMetricsOverride', {
      width: combo.w,
      height: combo.h,
      deviceScaleFactor: 1,
      mobile: false,
    });

    for (const routeId of combo.routes) {
      const route = routes.find((r) => r.id === routeId);
      client.errors = [];
      navCounter += 1;
      const url = `${BASE}/?qa=${navCounter}${route.hash}`;
      const loaded = client.waitFor('Page.loadEventFired', 12000).catch(() => null);
      await client.send('Page.navigate', { url });
      await loaded;
      await sleep(1100);

      let metrics = null;
      let metricsError = null;
      try {
        metrics = await client.evaluate(METRICS);
      } catch (error) {
        metricsError = error.message;
      }
      let bottom = null;
      try {
        bottom = await client.evaluate(BOTTOM);
      } catch {
        bottom = null;
      }

      const shot = await client.send('Page.captureScreenshot', { format: 'png' });
      const file = path.join(SHOTS, `${route.id}-${combo.name}.png`);
      await fs.writeFile(file, Buffer.from(shot.data, 'base64'));
      shots.push(file);

      const errors = client.errors.slice();
      results.push({
        viewport: `${combo.w}×${combo.h}`,
        route: route.id,
        metrics,
        bottom,
        metricsError,
        errors,
      });
    }
  }

  /* --------------------------------------------------- interação real */

  await client.send('Emulation.setDeviceMetricsOverride', {
    width: 1440,
    height: 1000,
    deviceScaleFactor: 1,
    mobile: false,
  });
  client.errors = [];
  navCounter += 1;
  const loaded = client.waitFor('Page.loadEventFired', 12000).catch(() => null);
  await client.send('Page.navigate', { url: `${BASE}/?qa=${navCounter}#/analisar/${pendingDoc.id}` });
  await loaded;
  await sleep(1000);

  const interactions = {};
  interactions.workbenchHeading = await client.evaluate(
    `document.querySelector('.doc-head__title')?.textContent || null`
  );
  interactions.pending = await client.evaluate(`(() => {
    const row = [...document.querySelectorAll('[data-check-row]')]
      .find((r) => (r.getAttribute('aria-label') || '').includes('Pendente'));
    if (!row) return null;
    const id = row.dataset.checkRow;
    row.querySelector('[data-status="ok"]').click();
    return id;
  })()`);
  await sleep(900);
  if (interactions.pending) {
    const after = await getState();
    interactions.pendingStatus = after.checks.find((c) => c.id === interactions.pending)?.status;
  }

  interactions.noteCheck = await client.evaluate(`(() => {
    const area = document.querySelector('[data-note-id]');
    if (!area) {
      const toggle = document.querySelector('[data-action="note-toggle"]');
      toggle?.click();
    }
    const next = document.querySelector('[data-note-id]');
    if (!next) return null;
    next.value = next.value ? next.value + ' [qa]' : 'Nota de verificação [qa]';
    next.dispatchEvent(new Event('input', { bubbles: true }));
    return next.dataset.noteId;
  })()`);
  await sleep(1500);
  if (interactions.noteCheck) {
    const after = await getState();
    interactions.noteSaved = after.checks.find((c) => c.id === interactions.noteCheck)?.note?.includes('[qa]');
  }

  interactions.keyboard = await client.evaluate(`(() => {
    const row = [...document.querySelectorAll('[data-check-row]')]
      .find((r) => (r.getAttribute('aria-label') || '').includes('Pendente'));
    if (!row) return null;
    row.focus();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: '3', bubbles: true }));
    return row.dataset.checkRow;
  })()`);
  await sleep(1000);
  if (interactions.keyboard) {
    const after = await getState();
    interactions.keyboardStatus = after.checks.find((c) => c.id === interactions.keyboard)?.status;
  }

  await client.evaluate(`document.querySelector('.nav__link[href="#/apontamentos"]').click()`);
  await sleep(900);
  interactions.navAfterClick = await client.evaluate(
    `({ hash: location.hash, active: document.querySelector('.nav__link[aria-current="page"]')?.textContent.trim() })`
  );

  await client.send('Page.navigate', { url: `${BASE}/?qa=${navCounter++}#/documentos` });
  await sleep(1200);
  interactions.filterCounts = await client.evaluate(`(() => {
    const buttons = [...document.querySelectorAll('[data-action="filter-docs"]')];
    const before = document.querySelectorAll('.docrow').length;
    const pendingBtn = buttons.find((b) => b.dataset.filter === 'pending');
    pendingBtn?.click();
    const after = document.querySelectorAll('.docrow').length;
    return { before, after };
  })()`);
  await sleep(500);

  interactions.search = await client.evaluate(`(() => {
    const input = document.querySelector('[data-filter="doc-query"]');
    if (!input) return null;
    input.value = 'contrato';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    const rows = [...document.querySelectorAll('.docrow__name')].map((el) => el.textContent);
    return { count: rows.length, allMatch: rows.every((name) => name.toLowerCase().includes('contrato')) };
  })()`);

  await client.send('Page.navigate', { url: `${BASE}/?qa=${navCounter++}#/documentos/${targetDoc.id}` });
  await sleep(1300);
  interactions.documentHeading = await client.evaluate(
    `document.querySelector('.doc-head__title')?.textContent || null`
  );
  interactions.preview = await client.evaluate(`(() => {
    document.querySelector('[data-action="doc-preview"]')?.click();
    const dialog = document.querySelector('dialog[open]');
    const iframe = dialog?.querySelector('iframe');
    return { open: !!dialog, src: iframe?.getAttribute('src') || null };
  })()`);
  await client.evaluate(`document.querySelector('dialog[open] .iconbtn[data-close]')?.click()`);

  await client.send('Page.navigate', { url: `${BASE}/?qa=${navCounter++}#/ajustes` });
  await sleep(1200);
  interactions.access = await client.evaluate(`(() => {
    const codes = [...document.querySelectorAll('.url-box code')].map((c) => c.textContent);
    return { count: codes.length, codes };
  })()`);

  /* ------------------------------------------------------------ relatório */

  const checks = [];
  for (const result of results) {
    const label = `${result.viewport} ${result.route}`;
    const m = result.metrics;
    if (!m) {
      checks.push({ label, ok: false, note: `sem métricas: ${result.metricsError || ''}` });
      continue;
    }
    const overflow = m.scrollWidth - m.viewport.w;
    checks.push({
      label,
      ok: overflow <= 1,
      note: overflow > 1 ? `overflow horizontal de ${overflow}px` : 'sem overflow horizontal',
    });
    checks.push({
      label,
      ok: Math.abs(m.navCenterDelta ?? 0) <= 2,
      note: `centro da cápsula: ${m.navCenterDelta}px do centro`,
    });
    checks.push({
      label,
      ok: m.navShellPe === 'none' && m.navPe === 'auto',
      note: `wrapper ${m.navShellPe} / nav ${m.navPe}`,
    });
    checks.push({
      label,
      ok: !!m.activeNav && m.activeLabelDisplay !== 'none' && m.inactiveLabelDisplay === 'none',
      note: `ativo "${m.activeNav}" (${m.activeLabelDisplay}); inativo (${m.inactiveLabelDisplay})`,
    });
    checks.push({
      label,
      ok: (result.bottom?.gap ?? -999) >= 0,
      note: `folga acima da barra no fim da página: ${result.bottom?.gap}px`,
    });
    checks.push({
      label,
      ok: !result.errors.length,
      note: result.errors.length ? result.errors.map((e) => e.text).join(' | ').slice(0, 180) : 'sem erros de console',
    });
    checks.push({
      label,
      ok: (m.wideElements || []).length === 0,
      note: (m.wideElements || []).length ? `elementos além da viewport: ${m.wideElements.join(', ')}` : 'nenhum elemento além da viewport',
    });
    if (m.clickThrough) {
      checks.push({
        label,
        ok: !String(m.clickThrough.cls).includes('nav') && m.clickThrough.tag !== 'NAV',
        note: `clique ao lado da cápsula atinge ${m.clickThrough.tag}.${m.clickThrough.cls}`,
      });
    }
  }

  const functional = [
    ['bancada abre o documento solicitado', interactions.workbenchHeading === pendingDoc.name, interactions.workbenchHeading],
    ['detalhe abre o documento solicitado', interactions.documentHeading === targetDoc.name, interactions.documentHeading],
    ['clique em “Conforme” persiste', interactions.pendingStatus === 'ok', interactions.pendingStatus],
    ['nota digitada é salva', interactions.noteSaved === true, interactions.noteSaved],
    ['atalho 3 marca Observação', interactions.keyboardStatus === 'obs', interactions.keyboardStatus],
    [
      'navegação inferior muda de rota',
      interactions.navAfterClick?.hash === '#/apontamentos',
      JSON.stringify(interactions.navAfterClick),
    ],
    [
      'filtro Pendentes reduz a lista',
      interactions.filterCounts && interactions.filterCounts.after < interactions.filterCounts.before,
      JSON.stringify(interactions.filterCounts),
    ],
    [
      'busca por “contrato”',
      interactions.search?.allMatch === true && interactions.search.count > 0,
      JSON.stringify(interactions.search),
    ],
    [
      'pré-visualização abre o PDF',
      interactions.preview?.open === true && String(interactions.preview?.src).includes('/files/'),
      JSON.stringify(interactions.preview),
    ],
    ['endereços de acesso listados', (interactions.access?.count || 0) >= 1, JSON.stringify(interactions.access)],
  ];

  console.log('\n=== Layout ===');
  let fails = 0;
  for (const check of checks) {
    if (!check.ok) fails += 1;
    console.log(`  ${check.ok ? 'ok  ' : 'FAIL'} ${check.label} — ${check.note}`);
  }

  console.log('\n=== Fluxo ===');
  for (const [label, ok, detail] of functional) {
    if (!ok) fails += 1;
    console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label} — ${detail}`);
  }

  console.log('\n=== Contraste (WCAG) ===');
  const pairs = [
    ['texto principal / papel', '#131c23', '#f1eee3'],
    ['texto auxiliar / papel', '#5f686e', '#f1eee3'],
    ['texto auxiliar / cartão', '#5f686e', '#fbf9f2'],
    ['texto / cabeçalho escuro', '#f7f4eb', '#101a21'],
    ['item inativo da barra', '#a7b0b7', '#0c1319'],
    ['botão primário', '#f7f4eb', '#23527a'],
    ['conforme', '#2a6a4d', '#e3ede5'],
    ['não conforme', '#a33f2c', '#f6e7e1'],
    ['observação', '#7d5a16', '#f4ecd8'],
    ['não se aplica', '#5a636a', '#ecece7'],
  ];
  for (const [label, fg, bg] of pairs) {
    const ratio = contrast(fg, bg);
    const ok = ratio >= 4.5;
    if (!ok) fails += 1;
    console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}: ${ratio}:1`);
  }

  console.log(`\nCapturas: ${shots.length} em ${SHOTS}`);
  console.log(`Falhas: ${fails}\n`);
  await client.ws.close();
  if (fails) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
