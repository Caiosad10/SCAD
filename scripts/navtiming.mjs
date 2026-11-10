/** Mede, dentro da página, a curva de expansão da barra (sem custo de screenshots). */
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

await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 834, height: 1194, deviceScaleFactor: 1, mobile: true });

let loaded = waitFor('Page.loadEventFired');
await send('Page.navigate', { url: `${BASE}/#/colecoes` });
await loaded;
await sleep(1000);
await evaluate(`document.querySelector('[data-action="open-collection"]').click()`);
await sleep(900);
await evaluate(`(() => {
  window.__navSamples = [];
  const t0 = performance.now();
  const tick = () => {
    const nav = document.querySelector('.nav');
    if (nav) {
      const r = nav.getBoundingClientRect();
      window.__navSamples.push([
        Math.round(performance.now() - t0),
        Math.round(r.width),
        Number(getComputedStyle(nav).opacity).toFixed(2),
        Number(getComputedStyle(document.querySelector('.nav__pill')).opacity).toFixed(2),
        nav.closest('.nav-shell').classList.contains('nav-shell--enter') ? 1 : 0
      ]);
    }
    if (performance.now() - t0 < 900) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  return true;
})()`);
await evaluate(`document.querySelector('[data-action="open-process"]').click()`);
await sleep(1100);
const samples = await evaluate(`window.__navSamples`);
console.log('ms | largura | opacidade | pílula | animando');
for (const [ms, w, o, p, a] of samples.filter((_, i) => i % 3 === 0)) {
  console.log(`${String(ms).padStart(4)} | ${String(w).padStart(6)} | ${o} | ${p} | ${a}`);
}
const settleAt = samples.find((s) => s[4] === 0);
console.log('classe de entrada removida em', settleAt ? `${settleAt[0]}ms` : 'não removida');
console.log('amostras:', samples.length, 'frames, duração', samples.at(-1)?.[0], 'ms');
ws.close();
