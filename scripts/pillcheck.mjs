/** Confere se a pílula cobre o item ativo durante e depois da expansão da barra. */
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
await sleep(800);

await evaluate(`(() => {
  window.__pillCheck = [];
  const t0 = performance.now();
  const tick = () => {
    const pill = document.querySelector('.nav__pill');
    const active = document.querySelector('.nav__link[aria-current="page"]');
    const nav = document.querySelector('.nav');
    if (pill && active && nav) {
      const p = pill.getBoundingClientRect();
      const a = active.getBoundingClientRect();
      const n = nav.getBoundingClientRect();
      window.__pillCheck.push([
        Math.round(performance.now() - t0),
        Math.round(p.width), Math.round(a.width),
        Math.round(p.left - a.left), Math.round(p.top - a.top),
        Math.round(p.height - a.height),
        Number(getComputedStyle(nav).opacity).toFixed(2)
      ]);
    }
    if (performance.now() - t0 < 1200) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  return true;
})()`);
await evaluate(`document.querySelector('[data-action="open-process"]').click()`);
await sleep(1500);
const samples = await evaluate(`window.__pillCheck`);
console.log('ms | pílula W / link W | dx | dy | dH | opacidade');
for (const s of samples.filter((_, i) => i % 4 === 0)) console.log(s.join(' | '));
const last = samples.at(-1);
console.log('final:', last ? (Math.abs(last[2] - last[1]) <= 2 && Math.abs(last[3]) <= 2 && Math.abs(last[4]) <= 2 && Math.abs(last[5]) <= 2 ? 'pílula alinhada' : 'DESALINHADA') : 'sem amostras');
const worst = samples.reduce((acc, s) => Math.max(acc, Math.abs(s[3] - (s[3] || 0))), 0);
console.log('desvio máximo horizontal', Math.max(...samples.map((s) => Math.abs(s[3]))), 'px');
ws.close();
