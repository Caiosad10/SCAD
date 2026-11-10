/** QA das correções: navegação no iPad (sem recarga), filtros persistentes e barra expandindo. */
import { writeFileSync } from 'node:fs';

const CDP = process.env.CDP || 'http://127.0.0.1:9335';
const BASE = process.argv[2] || 'http://127.0.0.1:4191';
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
    logs.push(`EXCEPTION ${message.params.exceptionDetails.exception?.description}`);
  }
  if (message.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(message.params.type)) {
    logs.push(`CONSOLE ${message.params.type}: ${message.params.args.map((a) => a.value ?? a.description).join(' ')}`);
  }
  const list = waiters.get(message.method);
  if (list) {
    waiters.delete(message.method);
    list.forEach((fn) => fn(message.params));
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
  const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
  return result.result.value;
}
async function shot(name) {
  const png = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  writeFileSync(new URL(`../shots/${name}.png`, import.meta.url), Buffer.from(png.data, 'base64'));
}
async function waitBootGone(timeout = 5000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const gone = await evaluate(`!document.getElementById('boot')`);
    if (gone) return Date.now() - started;
    await sleep(60);
  }
  return -1;
}

await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 834, height: 1194, deviceScaleFactor: 1, mobile: true });
await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
await send('Page.addScriptToEvaluateOnNewDocument', {
  source: `window.__bootVisible = false;
    const watchBoot = () => {
      if (!document.documentElement) { requestAnimationFrame(watchBoot); return; }
      new MutationObserver(() => {
        const boot = document.getElementById('boot');
        if (boot && boot.classList.contains('is-visible')) window.__bootVisible = true;
      }).observe(document.documentElement, { subtree: true, attributes: true, attributeFilter: ['class'] });
    };
    watchBoot();`,
});

let loaded = waitFor('Page.loadEventFired');
await send('Page.navigate', { url: `${BASE}/#/colecoes` });
await loaded;
await sleep(1200);

const start = await evaluate(`({
  bootGone: !document.getElementById('boot'),
  bootWasVisible: window.__bootVisible === true,
  hash: location.hash,
  cards: document.querySelectorAll('[data-action="open-collection"]').length,
  navHidden: document.body.classList.contains('nav-hidden')
})`);
console.log('1. abertura direta em coleções:', JSON.stringify(start));
await shot('qa-colecoes-ipad');

// abre a primeira coleção e o primeiro processo
await evaluate(`document.querySelector('[data-action="open-collection"]').click()`);
await sleep(800);
await shot('qa-colecao-ipad');
const collection = await evaluate(`({
  hash: location.hash,
  eyebrow: document.querySelector('[data-mast-eyebrow]')?.textContent,
  navHidden: document.body.classList.contains('nav-hidden')
})`);
console.log('2. dentro da coleção:', JSON.stringify(collection));

await evaluate(`document.querySelector('[data-action="open-process"]').click()`);
await sleep(260);
await shot('qa-barra-meio');
const midNav = await evaluate(`({
  hash: location.hash,
  shellAnim: getComputedStyle(document.querySelector('.nav-shell')).animationName,
  capsuleAnim: getComputedStyle(document.querySelector('.nav')).animationName,
  navHidden: document.body.classList.contains('nav-hidden')
})`);
console.log('3. barra em meio à expansão:', JSON.stringify(midNav));

await sleep(900);
await shot('qa-painel-ipad');
const processScreen = await evaluate(`({
  hash: location.hash,
  back: document.querySelector('[data-mast-back-label]')?.textContent,
  eyebrow: document.querySelector('[data-mast-eyebrow]')?.textContent,
  title: document.querySelector('[data-mast-title]')?.textContent,
  navVisible: !!document.querySelector('.nav'),
  shellAnim: getComputedStyle(document.querySelector('.nav-shell')).animationName,
  navEntries: performance.getEntriesByType('navigation').length
})`);
console.log('4. tela do processo:', JSON.stringify(processScreen));

// Fila -> Todos -> clicar num documento
await evaluate(`location.hash = '#/analisar'`);
await sleep(700);
const beforeQueue = await evaluate(`({
  hash: location.hash,
  scopeAll: document.querySelector('[data-action="queue-scope"][data-scope="all"]')?.getAttribute('aria-pressed')
})`);
console.log('5. bancada antes:', JSON.stringify(beforeQueue));
await evaluate(`document.querySelector('[data-action="queue-scope"][data-scope="all"]').click()`);
await sleep(500);
const firstDoc = await evaluate(
  `document.querySelector('.queue__item')?.getAttribute('href')`
);
console.log('6. primeiro documento da fila (Todos):', firstDoc);
await evaluate(`document.querySelector('.queue__item').click()`);
await sleep(700);
const afterDoc = await evaluate(`({
  hash: location.hash,
  docTitle: document.querySelector('.doc-head__title')?.textContent?.slice(0, 40),
  scopeAll: document.querySelector('[data-action="queue-scope"][data-scope="all"]')?.getAttribute('aria-pressed'),
  navEntries: performance.getEntriesByType('navigation').length,
  boot: !!document.getElementById('boot'),
  bootWasVisible: window.__bootVisible === true,
  session: JSON.parse(localStorage.getItem('scad:session:v1') || 'null')
})`);
console.log('7. documento aberto:', JSON.stringify(afterDoc));

// simula a recarga do iPad: abre a URL raiz sem hash
await evaluate(`window.scrollTo(0, 600)`);
await sleep(700);
loaded = waitFor('Page.loadEventFired');
await send('Page.navigate', { url: `${BASE}/?reload=1` });
await loaded;
const bootMs = await waitBootGone();
await sleep(900);
const afterReload = await evaluate(`({
  hash: location.hash,
  docTitle: document.querySelector('.doc-head__title')?.textContent?.slice(0, 40),
  scopeAll: document.querySelector('[data-action="queue-scope"][data-scope="all"]')?.getAttribute('aria-pressed'),
  scrollY: Math.round(window.scrollY),
  boot: !!document.getElementById('boot'),
  bootWasVisible: window.__bootVisible === true,
  navEntries: performance.getEntriesByType('navigation').length
})`);
console.log(`8. recarga sem hash (boot sumiu em ${bootMs}ms):`, JSON.stringify(afterReload));
await shot('qa-reaberto-ipad');

// navegação interna não deve gerar novas entradas de documento
const navEntryBefore = await evaluate(`performance.getEntriesByType('navigation').length`);
await evaluate(`document.querySelector('.nav__link[data-nav="dashboard"]').click()`);
await sleep(600);
await evaluate(`document.querySelector('.nav__link[data-nav="documents"]').click()`);
await sleep(600);
const navEntryAfter = await evaluate(`({
  entries: performance.getEntriesByType('navigation').length,
  hash: location.hash,
  boot: !!document.getElementById('boot'),
  view: (document.getElementById('main')?.innerHTML?.length || 0) > 100
})`);
console.log('9. navegação pela barra:', JSON.stringify({ before: navEntryBefore, after: navEntryAfter }));

// barra: ao sair para coleções deve sumir, ao voltar deve expandir de novo
await evaluate(`document.querySelector('[data-mast-back]').click()`);
await sleep(700);
const backToCollections = await evaluate(`({
  hash: location.hash,
  nav: !!document.querySelector('.nav'),
  navHidden: document.body.classList.contains('nav-hidden'),
  back: document.querySelector('[data-mast-back-label]')?.textContent
})`);
console.log('10. voltar para processos:', JSON.stringify(backToCollections));
await shot('qa-voltar-colecao-ipad');

if (logs.length) console.log('\nLOG:\n' + logs.join('\n'));
ws.close();
