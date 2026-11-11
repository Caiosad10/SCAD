/** Smoke test somente-leitura da produção recém-migrada (porta 4177). Não grava nada. */
import { writeFileSync } from 'node:fs';

const CDP = process.env.CDP || 'http://127.0.0.1:9339';
const BASE = process.argv[2] || 'http://127.0.0.1:4177';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(ok ? `  ok   ${name}` : `  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
};

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
await send('Network.enable');
await send('Network.setCacheDisabled', { cacheDisabled: true });
await send('Emulation.setDeviceMetricsOverride', { width: 834, height: 1194, deviceScaleFactor: 2, mobile: true });

let loaded = waitFor('Page.loadEventFired');
await send('Page.navigate', { url: `${BASE}/#/` });
await loaded;
await sleep(1400);

// perfil revisor (só localStorage do navegador de teste)
await evaluate(`localStorage.setItem('scad:profile', 'usr_diogenes')`);
loaded = waitFor('Page.loadEventFired');
await send('Page.reload', { ignoreCache: false });
await loaded;
await sleep(1500);
await evaluate(`location.hash = '#/'`);
await sleep(1000);

const home = await evaluate(`({
  title: document.querySelector('[data-mast-title]')?.textContent,
  back: document.querySelector('[data-mast-back-label]')?.textContent,
  chip: document.querySelector('[data-profile-name]')?.textContent,
  boot: !!document.getElementById('boot'),
  pills: [...document.querySelectorAll('.review-pill__label')].map((n) => n.textContent.trim()),
  hero: document.querySelector('.hero__title')?.textContent,
  rows: document.querySelectorAll('.matrix tbody tr').length,
  statusIcons: document.querySelectorAll('.matrix__status .matrix__smark svg').length,
  pct: document.querySelector('.gauge__value')?.textContent?.trim()
})`);
console.log('painel produção:', JSON.stringify(home));
check('cabeçalho com coleção - processo', home.title === 'ISO 9001:2015 - DC', home.title);
check('botão voltar correto', home.back === 'Voltar para processos', home.back);
check('tela de carregamento já saiu', home.boot === false);
check('41 documentos na matriz', home.rows === 41, String(home.rows));
check('faixa mostra Aguardando revisão', home.pills.includes('Aguardando revisão'), JSON.stringify(home.pills));
check('revisor não vê Atenção', !home.pills.includes('Atenção'), JSON.stringify(home.pills));
check('situação com ícones (4 aguardando)', home.statusIcons === 4, String(home.statusIcons));

await evaluate(`location.hash = '#/documentos'`);
await sleep(900);
const docs = await evaluate(`({
  rows: document.querySelectorAll('.docrow').length,
  tabs: [...document.querySelectorAll('.segmented [data-action="filter-docs"]')].map((b) => b.textContent.replace(/\\s+/g, ' ').trim()),
  addDoc: Boolean(document.querySelector('[data-action="open-import"]'))
})`);
console.log('documentos:', JSON.stringify(docs));
check('lista mostra 41 documentos', docs.rows === 41, String(docs.rows));
check('filtro Revisão/Aprovados disponível', docs.tabs.some((t) => t.startsWith('Revisão')) && docs.tabs.some((t) => t.startsWith('Aprovados')), JSON.stringify(docs.tabs));

await evaluate(`location.hash = '#/analisar'`);
await sleep(900);
const bench = await evaluate(`({
  title: document.querySelector('.doc-head__title')?.textContent,
  checks: document.querySelectorAll('.check[data-check-row]').length,
  queue: document.querySelectorAll('.queue__item').length,
  presence: Boolean(document.querySelector('[data-presence]'))
})`);
console.log('bancada:', JSON.stringify(bench));
check('bancada abre com 6 critérios', bench.checks === 6, String(bench.checks));
check('fila preenchida', bench.queue > 0, String(bench.queue));

const png = await send('Page.captureScreenshot', { format: 'png' });
writeFileSync(new URL('../shots/qa-producao-v2.png', import.meta.url), Buffer.from(png.data, 'base64'));

check('sem erros de console', errors.length === 0, JSON.stringify(errors));
console.log(failures ? `\n${failures} FALHA(S)` : '\nprodução v2 validada (somente leitura)');
ws.close();
process.exitCode = failures ? 1 : 0;
