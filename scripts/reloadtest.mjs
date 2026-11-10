/** Verifica se um reload restaura a rota de trabalho (iPad/PWA). */
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
  });
  return result.result.value;
}

await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 834, height: 1194, deviceScaleFactor: 1, mobile: false });

let loaded = waitFor('Page.loadEventFired');
await send('Page.navigate', { url: `${BASE}/?rt=1#/analisar/${DOC}` });
await loaded;
await sleep(1200);
console.log(
  'antes do reload:',
  JSON.stringify(
    await evaluate(`({
      hash: location.hash,
      stored: localStorage.getItem('scad:lastRoute:v1'),
      heading: document.querySelector('.doc-head__title')?.textContent?.slice(0, 30)
    })`)
  )
);

loaded = waitFor('Page.loadEventFired');
await send('Page.reload', { ignoreCache: false });
await loaded;
await sleep(900);
console.log(
  'depois do reload:',
  JSON.stringify(
    await evaluate(`({
      hash: location.hash,
      heading: document.querySelector('.doc-head__title')?.textContent?.slice(0, 30),
      boot: !!document.getElementById('boot'),
      view: !!document.querySelector('.view')
    })`)
  )
);

await evaluate(`location.hash = '#/'`);
await sleep(700);
console.log(
  'painel:',
  JSON.stringify(
    await evaluate(`({ hash: location.hash, stored: localStorage.getItem('scad:lastRoute:v1') })`)
  )
);
loaded = waitFor('Page.loadEventFired');
await send('Page.reload', { ignoreCache: false });
await loaded;
await sleep(700);
console.log(
  'reload no painel:',
  JSON.stringify(await evaluate(`({ hash: location.hash, title: document.title })`))
);

ws.close();
