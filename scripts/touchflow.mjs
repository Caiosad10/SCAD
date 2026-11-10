/** Reproduz o fluxo de verificação com toque no iPad emulado. */
const CDP = process.env.CDP || 'http://127.0.0.1:9334';
const BASE = process.argv[2] || 'http://127.0.0.1:4188';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const target = await (
  await fetch(`${CDP}/json/new?${encodeURIComponent('about:blank')}`, { method: 'PUT' })
).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
let seq = 0;
const pending = new Map();
const waiters = new Map();
const logs = [];

await new Promise((resolve, reject) => {
  ws.onopen = resolve;
  ws.onerror = reject;
});

ws.onmessage = (event) => {
  const message = JSON.parse(event.data);
  if (message.id) {
    const entry = pending.get(message.id);
    if (!entry) return;
    pending.delete(message.id);
    message.error ? entry.reject(new Error(message.error.message)) : entry.resolve(message.result);
    return;
  }
  if (message.method === 'Runtime.exceptionThrown') {
    logs.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
  }
  const list = waiters.get(message.method);
  if (list) {
    waiters.delete(message.method);
    list.forEach((resolveFn) => resolveFn(message.params));
  }
};

function send(method, params = {}) {
  const id = ++seq;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
}

function waitFor(method) {
  return new Promise((resolve) => {
    const list = waiters.get(method) || [];
    list.push(resolve);
    waiters.set(method, list);
  });
}

async function evaluate(expression) {
  const result = await send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
    userGesture: true,
  });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || 'erro');
  return result.result.value;
}

async function tap(x, y) {
  const point = { x: Math.round(x), y: Math.round(y), radiusX: 2, radiusY: 2, force: 1, id: 1 };
  await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
  await sleep(60);
  await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

async function tapSelector(selector) {
  const rect = await evaluate(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return null;
    el.scrollIntoView({ block: 'center' });
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  })()`);
  if (!rect) return null;
  await sleep(250);
  await tap(rect.x, rect.y);
  return rect;
}

async function snapshot(label) {
  const data = await evaluate(`({
    hash: location.hash,
    heading: document.querySelector('.doc-head__title')?.textContent || null,
    pageTitle: document.querySelector('.page__title')?.textContent || null,
    rows: document.querySelectorAll('[data-check-row]').length,
    hashes: window.__hashes || [],
    label: document.querySelector('[data-check-row]')?.getAttribute('aria-label') || null
  })`);
  console.log(label, JSON.stringify(data));
  return data;
}

await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', {
  width: 834,
  height: 1194,
  deviceScaleFactor: 1,
  mobile: true,
});
await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
await send('Page.navigate', { url: `${BASE}/?touch=1#/documentos` });
await waitFor('Page.loadEventFired');
await sleep(1200);
await evaluate(
  `window.__hashes = []; addEventListener('hashchange', () => window.__hashes.push(location.hash));`
);

await tapSelector('.docrow');
await sleep(900);
await snapshot('após tocar no documento:');

await tapSelector('[data-action="doc-preview"]');
await sleep(500);
const dialog = await evaluate(`!!document.querySelector('dialog[open]')`);
console.log('pré-visualização abriu:', dialog);
await evaluate(`document.querySelector('dialog[open] [data-close]')?.click()`);
await sleep(300);

const docHref = await evaluate(
  `document.querySelector('.page__actions a[href^="#/analisar/"]')?.getAttribute('href')`
);
if (docHref) {
  await evaluate(`location.hash = ${JSON.stringify(docHref.slice(1))}`);
  await sleep(900);
}
await snapshot('bancada:');

const targetRect = await evaluate(`(() => {
  const row = [...document.querySelectorAll('[data-check-row]')].find((r) => (r.getAttribute('aria-label') || '').includes('Pendente'));
  if (!row) return null;
  const btn = row.querySelector('[data-status="obs"]');
  btn.scrollIntoView({ block: 'center' });
  const r = btn.getBoundingClientRect();
  return { row: row.dataset.checkRow, x: r.left + r.width / 2, y: r.top + r.height / 2 };
})()`);
await sleep(300);
if (targetRect) {
  await tap(targetRect.x, targetRect.y);
  await sleep(1200);
  const after = await snapshot('após tocar em Observação:');
  const rowLabel = await evaluate(
    `document.querySelector('[data-check-row=${JSON.stringify(targetRect.row)}]')?.getAttribute('aria-label')`
  );
  const noteBox = await evaluate(
    `(() => { const t = document.querySelector('[data-note-id=${JSON.stringify(targetRect.row)}]'); if (!t) return null; t.focus(); t.value = 'Observação de teste no toque'; t.dispatchEvent(new Event('input', { bubbles: true })); return t.value; })()`
  );
  await sleep(1000);
  const final = await snapshot('após escrever a nota:');
  console.log('linha:', rowLabel, '· nota:', noteBox);
  console.log('hashes:', JSON.stringify(final.hashes));
} else {
  console.log('nenhuma verificação pendente encontrada');
}

if (logs.length) console.log('EXCEÇÕES:', logs.join('\n'));
ws.close();
