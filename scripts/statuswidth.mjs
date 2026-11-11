/** Mede o cabeçalho “Situação” e as células para garantir que nada quebre linha. */
import { writeFileSync } from 'node:fs';

const CDP = process.env.CDP || 'http://127.0.0.1:9338';
const BASE = process.argv[2] || 'http://127.0.0.1:4191';
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
await send('Network.enable');
await send('Network.setCacheDisabled', { cacheDisabled: true });
await send('Emulation.setDeviceMetricsOverride', { width: 834, height: 1194, deviceScaleFactor: 2, mobile: true });

let loaded = waitFor('Page.loadEventFired');
await send('Page.navigate', { url: `${BASE}/#/` });
await loaded;
await sleep(1300);

const header = await evaluate(`(() => {
  const th = document.querySelector('.matrix thead th.is-status');
  if (!th) return null;
  const range = document.createRange();
  range.selectNodeContents(th);
  const rects = [...range.getClientRects()].map((r) => ({ w: Math.round(r.width), h: Math.round(r.height), top: Math.round(r.top) }));
  const cs = getComputedStyle(th);
  const rect = th.getBoundingClientRect();
  return {
    text: th.textContent.trim(),
    width: Math.round(rect.width),
    height: Math.round(rect.height),
    lines: new Set(rects.map((r) => r.top)).size,
    whiteSpace: cs.whiteSpace,
    padding: cs.padding,
    fontSize: cs.fontSize,
    letterSpacing: cs.letterSpacing,
    textWidth: Math.round(Math.max(...rects.map((r) => r.w)))
  };
})()`);
console.log('cabeçalho Situação:', JSON.stringify(header));
check('cabeçalho Situação em uma linha', header?.lines === 1, JSON.stringify(header));
check('“Situação” cabe na largura da coluna', header ? header.textWidth <= header.width : false, JSON.stringify(header));

const cells = await evaluate(`(() => {
  const list = [...document.querySelectorAll('.matrix__status')];
  const overflowing = list.filter((cell) => cell.scrollWidth > cell.clientWidth + 1).length;
  const multiline = list.filter((cell) => {
    const range = document.createRange();
    range.selectNodeContents(cell);
    const tops = [...range.getClientRects()].map((rect) => Math.round(rect.top));
    return new Set(tops).size > 1;
  }).length;
  return {
    total: list.length,
    overflowing,
    multiline,
    widths: [...new Set(list.map((cell) => Math.round(cell.getBoundingClientRect().width)))],
    sampleText: list.slice(0, 3).map((cell) => (cell.textContent || '').trim())
  };
})()`);
console.log('células:', JSON.stringify(cells));
check('nenhuma célula da Situação transborda', cells.overflowing === 0, JSON.stringify(cells));
check('nenhuma célula ocupa duas linhas', cells.multiline === 0, JSON.stringify(cells));

const row = await evaluate(`(() => {
  const tr = document.querySelector('.matrix tbody tr');
  const th = document.querySelector('.matrix thead th.is-status');
  return { rowHeight: Math.round(tr.getBoundingClientRect().height), headerHeight: Math.round(th.getBoundingClientRect().height) };
})()`);
console.log('alturas:', JSON.stringify(row));

const png = await send('Page.captureScreenshot', { format: 'png' });
writeFileSync(new URL('../shots/qa-situacao-largura.png', import.meta.url), Buffer.from(png.data, 'base64'));

// recorte do canto superior direito da matriz (cabeçalho + primeiras linhas)
const crop = await evaluate(`(() => {
  const table = document.querySelector('.matrix table').getBoundingClientRect();
  const head = document.querySelector('.matrix thead th.is-status').getBoundingClientRect();
  const rows = [...document.querySelectorAll('.matrix tbody tr')].slice(0, 7);
  const last = rows[rows.length - 1].getBoundingClientRect();
  const width = 300;
  return {
    x: Math.max(0, Math.round(table.right - width)),
    y: Math.max(0, Math.round(head.top)),
    width,
    height: Math.max(120, Math.round(last.bottom - head.top)),
  };
})()`);
const cropPng = await send('Page.captureScreenshot', { format: 'png', clip: { ...crop, scale: 3 } });
writeFileSync(new URL('../shots/qa-situacao-recorte.png', import.meta.url), Buffer.from(cropPng.data, 'base64'));

// telefone
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await sleep(600);
const phone = await evaluate(`(() => {
  const th = document.querySelector('.matrix thead th.is-status');
  const range = document.createRange();
  range.selectNodeContents(th);
  return {
    lines: new Set([...range.getClientRects()].map((r) => Math.round(r.top))).size,
    overflow: document.documentElement.scrollWidth - window.innerWidth,
    width: Math.round(th.getBoundingClientRect().width)
  };
})()`);
console.log('telefone:', JSON.stringify(phone));
check('cabeçalho em uma linha no telefone', phone.lines === 1, JSON.stringify(phone));
check('sem estouro horizontal no telefone', phone.overflow <= 1, `overflow ${phone.overflow}px`);

console.log(failures ? `\n${failures} FALHA(S)` : '\nlargura da coluna Situação: ok');
ws.close();
process.exitCode = failures ? 1 : 0;
