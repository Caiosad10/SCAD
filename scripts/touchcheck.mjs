/** Teste focado: toque em Observação, nota e "Próximo critério". */
const CDP = process.env.CDP || 'http://127.0.0.1:9334';
const BASE = process.argv[2] || 'http://127.0.0.1:4188';
const DOC = process.argv[3];
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
  await sleep(70);
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
  await sleep(300);
  await tap(rect.x, rect.y);
  return rect;
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
await send('Page.navigate', { url: `${BASE}/?tc=2#/analisar/${DOC}` });
await waitFor('Page.loadEventFired');
await sleep(1400);
await evaluate(`window.__hashes=[]; addEventListener('hashchange',()=>window.__hashes.push(location.hash));`);

const targetRow = await evaluate(`(() => {
  const row = [...document.querySelectorAll('[data-check-row]')].find((r) => (r.getAttribute('aria-label') || '').includes('Pendente'));
  if (!row) return null;
  window.__rowRef = row;
  const btn = row.querySelector('[data-status="obs"]');
  btn.scrollIntoView({ block: 'center' });
  const r = btn.getBoundingClientRect();
  return { id: row.dataset.checkRow, x: r.left + r.width / 2, y: r.top + r.height / 2 };
})()`);
await sleep(300);
console.log('alvo:', JSON.stringify(targetRow));
await tap(targetRow.x, targetRow.y);
await sleep(900);

const afterTap = await evaluate(`({
  hash: location.hash,
  hashes: window.__hashes,
  label: document.querySelector('[data-check-row=${JSON.stringify(targetRow.id)}]')?.getAttribute('aria-label'),
  active: document.activeElement?.tagName + (document.activeElement?.getAttribute('data-note-id') ? ':' + document.activeElement.getAttribute('data-note-id') : ''),
  rowStillSame: window.__rowRef?.isConnected === true,
  textarea: !!document.querySelector('[data-note-id=${JSON.stringify(targetRow.id)}]'),
  next: !!document.querySelector('[data-action="next-check"][data-id=${JSON.stringify(targetRow.id)}]')
})`);
console.log('após Observação:', JSON.stringify(afterTap));

await send('Input.insertText', { text: 'Observação digitada no iPad emulado' });
await sleep(1400);
const afterNote = await evaluate(`({
  hash: location.hash,
  hashes: window.__hashes,
  value: document.querySelector('[data-note-id=${JSON.stringify(targetRow.id)}]')?.value,
  save: document.querySelector('[data-check-row=${JSON.stringify(targetRow.id)}] .autosave')?.textContent,
  rowStillSame: window.__rowRef?.isConnected === true,
  active: document.activeElement?.tagName
})`);
console.log('após digitar:', JSON.stringify(afterNote));

const nextRect = await evaluate(`(() => {
  const btn = document.querySelector('[data-action="next-check"][data-id=${JSON.stringify(targetRow.id)}]');
  if (!btn) return null;
  btn.scrollIntoView({ block: 'center' });
  const r = btn.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
})()`);
await sleep(300);
if (nextRect) {
  await tap(nextRect.x, nextRect.y);
  await sleep(700);
}
const afterNext = await evaluate(`({
  hash: location.hash,
  hashes: window.__hashes,
  focused: document.activeElement?.getAttribute('aria-label'),
  scrollY: Math.round(scrollY)
})`);
console.log('após "Próximo critério":', JSON.stringify(afterNext));

if (logs.length) console.log('EXCEÇÕES:\n' + logs.join('\n'));
ws.close();
