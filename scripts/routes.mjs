/** Regressão de navegação: todas as telas, sem recarga de página e sem exceções. */
const CDP = process.env.CDP || 'http://127.0.0.1:9334';
const BASE = process.argv[2] || 'http://127.0.0.1:4191';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const target = await (await fetch(`${CDP}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
let seq = 0;
const pending = new Map();
const waiters = new Map();
const errors = [];
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
  if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description || 'exceção');
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
    errors.push(m.params.args.map((a) => a.value ?? a.description).join(' '));
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
await send('Page.navigate', { url: `${BASE}/#/` });
await loaded;
await sleep(1400);

const docs = await evaluate(`(async () => {
  const pid = localStorage.getItem('scad:activeProcess');
  const r = await fetch('/api/state', { headers: { 'X-SCAD-Process': pid || '' } });
  const s = await r.json();
  return { doc: s.documents?.[0]?.id, collection: s.collections?.[0]?.id, process: s.process?.id };
})()`);
console.log('ids:', JSON.stringify(docs));

const routes = [
  ['#/', 'painel'],
  ['#/documentos', 'documentos'],
  [`#/documentos/${docs.doc}`, 'documento'],
  ['#/analisar', 'bancada'],
  ['#/apontamentos', 'apontamentos'],
  ['#/ajustes', 'ajustes'],
  ['#/colecoes', 'coleções'],
  [`#/colecoes/${docs.collection}`, 'coleção']
];

const rows = [];
for (const [hash, name] of routes) {
  await evaluate(`document.querySelector('a.brand')?.click()`);
  await sleep(300);
  await evaluate(`window.scrollTo(0, 0)`);
  // navega por um link interno quando existir; senão usa a barra de endereço do SPA
  await evaluate(`(() => {
    const link = document.querySelector('a[href="${hash}"]');
    if (link) { link.click(); return 'link'; }
    history.pushState(null, '', '${hash}');
    window.dispatchEvent(new PopStateEvent('popstate'));
    return 'push';
  })()`);
  await sleep(650);
  const info = await evaluate(`({
    hash: location.hash,
    boot: !!document.getElementById('boot'),
    entries: performance.getEntriesByType('navigation').length,
    content: (document.getElementById('main')?.innerText || '').trim().length,
    nav: !!document.querySelector('.nav'),
    back: document.querySelector('[data-mast-back-label]')?.textContent || null,
    eyebrow: document.querySelector('[data-mast-eyebrow]')?.textContent || null,
    title: document.querySelector('[data-mast-title]')?.textContent || null
  })`);
  rows.push({ name, ...info });
  console.log(`${name.padEnd(12)} ${JSON.stringify(info)}`);
}

const navEntries = await evaluate(`performance.getEntriesByType('navigation').length`);
console.log('\nentradas de navegação (deve ser 1):', navEntries);
console.log('exceções/erros de console:', errors.length ? errors : 'nenhum');
ws.close();
