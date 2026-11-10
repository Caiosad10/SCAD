/** Mede o tempo de pintura inicial com cache local (sessionStorage). */
const CDP = process.env.CDP || 'http://127.0.0.1:9334';
const URL = process.argv[2] || 'http://127.0.0.1:4188/#/';
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
  });
  return result.result.value;
}

await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 834, height: 1194, deviceScaleFactor: 1, mobile: false });

let loaded = waitFor('Page.loadEventFired');
await send('Page.navigate', { url: URL });
await loaded;
await sleep(1200);
console.log('cache inicial:', await evaluate(`(sessionStorage.getItem('scad:state:v1') || '').length`));

for (let i = 1; i <= 3; i += 1) {
  loaded = waitFor('Page.loadEventFired');
  await send('Page.reload', { ignoreCache: false });
  await loaded;
  const fast = await evaluate(`({
    boot: !!document.getElementById('boot'),
    view: !!document.querySelector('.view'),
    appHidden: document.getElementById('app')?.hidden,
    cache: (sessionStorage.getItem('scad:state:v1') || '').length,
    title: document.title
  })`);
  console.log(`reload ${i}:`, JSON.stringify(fast));
  await sleep(700);
}

ws.close();
