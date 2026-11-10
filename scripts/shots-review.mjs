/** Capturas finais do fluxo de revisão sobre a prévia limpa. */
import { writeFileSync } from 'node:fs';

const CDP = process.env.CDP || 'http://127.0.0.1:9334';
const BASE = process.argv[2] || 'http://127.0.0.1:4191';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const target = await (await fetch(`${CDP}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
let seq = 0;
const pending = new Map();
const waiters = new Map();
await new Promise((res, rej) => {
  ws.onopen = res;
  ws.onerror = rej;
});
ws.onmessage = (event) => {
  const m = JSON.parse(event.data);
  if (m.id) {
    const entry = pending.get(m.id);
    if (!entry) return;
    pending.delete(m.id);
    m.error ? entry.reject(new Error(m.error.message)) : entry.resolve(m.result);
    return;
  }
  const list = waiters.get(m.method);
  if (list) {
    waiters.delete(m.method);
    list.forEach((fn) => fn(m.params));
  }
};
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
const waitFor = (method) =>
  new Promise((resolve) => {
    const list = waiters.get(method) || [];
    list.push(resolve);
    waiters.set(method, list);
  });
const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
  return r.result.value;
};
const shot = async (name) => {
  const png = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(new URL(`../shots/${name}.png`, import.meta.url), Buffer.from(png.data, 'base64'));
};

await send('Page.enable');
await send('Runtime.enable');
await send('Network.enable');
await send('Network.setCacheDisabled', { cacheDisabled: true });
await send('Emulation.setDeviceMetricsOverride', { width: 834, height: 1194, deviceScaleFactor: 1, mobile: true });

let loaded = waitFor('Page.loadEventFired');
await send('Page.navigate', { url: `${BASE}/#/` });
await loaded;
await sleep(1200);
await evaluate(`localStorage.setItem('scad:profile', 'usr_diogenes')`);
loaded = waitFor('Page.loadEventFired');
await send('Page.reload', { ignoreCache: false });
await loaded;
await sleep(1400);
await evaluate(`location.hash = '#/documentos'`);
await sleep(700);
await evaluate(`location.hash = '#/'`);
await sleep(1000);
await shot('qa-revisor-painel');

await evaluate(`document.querySelector('[data-action="review-queue"]').click()`);
await sleep(1200);
const docId = await evaluate(`document.querySelector('[data-presence]')?.getAttribute('data-presence')`);
await shot('qa-revisor-fila');

const pid = await evaluate(`localStorage.getItem('scad:activeProcess')`);
await fetch(`${BASE}/api/presence`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-SCAD-Actor': 'usr_sergio', 'X-SCAD-Process': pid },
  body: JSON.stringify({ docId }),
});
await sleep(13500);
await shot('qa-revisor-presenca');

await evaluate(`location.hash = '#/'`);
await sleep(1000);
await evaluate(`document.querySelector('[data-action="review-filter"][data-filter="awaiting"]').click()`);
await sleep(800);
await shot('qa-revisor-documentos-revisao');
const filter = await evaluate(`({
  hash: location.hash,
  pressed: document.querySelector('[data-action="filter-docs"][data-filter="review"]')?.getAttribute('aria-pressed'),
  rows: document.querySelectorAll('.docrow').length
})`);
console.log('filtro pela faixa de revisão:', JSON.stringify(filter));

ws.close();
