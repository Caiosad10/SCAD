/** Confere o grifo de “Revisão” e a coluna Situação (ícone só nos estados de revisão). */
import { writeFileSync } from 'node:fs';

const CDP = process.env.CDP || 'http://127.0.0.1:9337';
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
await sleep(1200);
await evaluate(`localStorage.setItem('scad:profile', 'usr_diogenes')`);
loaded = waitFor('Page.loadEventFired');
await send('Page.reload', { ignoreCache: false });
await loaded;
await sleep(1400);
await evaluate(`location.hash = '#/documentos'`);
await sleep(700);
await evaluate(`location.hash = '#/'`);
await sleep(900);

const label = await evaluate(`(() => {
  const node = document.querySelector('.review-strip__label');
  if (!node) return null;
  const cs = getComputedStyle(node);
  const rect = node.getBoundingClientRect();
  const text = node.textContent.trim();
  return {
    text,
    width: Math.round(rect.width),
    height: Math.round(rect.height),
    lineHeight: cs.lineHeight,
    fontSize: cs.fontSize,
    background: cs.backgroundColor,
    backgroundImage: cs.backgroundImage,
    padding: cs.padding,
    fullyOpaque: cs.backgroundColor !== 'rgba(0, 0, 0, 0)' && cs.backgroundColor !== 'transparent',
    gradient: cs.backgroundImage !== 'none'
  };
})()`);
console.log('rótulo Revisão:', JSON.stringify(label));
check('rótulo presente', Boolean(label) && label.text === 'Revisão', JSON.stringify(label));
check('grifo tem cor sólida de fundo (não gradiente)', label?.fullyOpaque && !label?.gradient, JSON.stringify(label));
check(
  'grifo cobre a altura do texto (padding + altura > fonte)',
  label ? label.height >= Number.parseFloat(label.fontSize) + 6 : false,
  JSON.stringify(label)
);

// captura para inspeção visual (recorte da faixa)
const stripBox = await evaluate(`(() => {
  const node = document.querySelector('.review-strip');
  const rect = node.getBoundingClientRect();
  return { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) };
})()`);
const pad = 6;
const png = await send('Page.captureScreenshot', {
  format: 'png',
  clip: {
    x: Math.max(0, stripBox.x - pad),
    y: Math.max(0, stripBox.y - pad),
    width: stripBox.w + pad * 2,
    height: stripBox.h + pad * 2,
    scale: 3,
  },
});
writeFileSync(new URL('../shots/qa-faixa-revisao.png', import.meta.url), Buffer.from(png.data, 'base64'));
const labelPng = await send('Page.captureScreenshot', {
  format: 'png',
  clip: { x: Math.max(0, stripBox.x), y: Math.max(0, stripBox.y), width: 120, height: 44, scale: 6 },
});
writeFileSync(new URL('../shots/qa-faixa-revisao-grifada.png', import.meta.url), Buffer.from(labelPng.data, 'base64'));

const status = await evaluate(`(() => {
  const cells = [...document.querySelectorAll('.matrix__status')];
  const rows = cells.map((cell) => {
    const icon = cell.querySelector('.matrix__smark svg');
    const count = cell.querySelector('.matrix__status-count');
    return {
      icon: Boolean(icon),
      count: (count?.textContent || '').trim(),
      text: (cell.textContent || '').trim(),
      title: cell.querySelector('.matrix__smark')?.getAttribute('title') || ''
    };
  });
  return {
    total: cells.length,
    withIcon: rows.filter((r) => r.icon).length,
    withCount: rows.filter((r) => r.count).length,
    both: rows.filter((r) => r.icon && r.count).length,
    neither: rows.filter((r) => !r.icon && !r.count).length,
    iconTexts: [...new Set(rows.filter((r) => r.icon).map((r) => r.text))],
    iconTitles: [...new Set(rows.filter((r) => r.icon).map((r) => r.title))],
    countSample: rows.filter((r) => r.count).slice(0, 3).map((r) => r.text),
    columnWidth: Math.round(cells[0]?.getBoundingClientRect().width || 0),
    bodyOverflow: document.documentElement.scrollWidth - window.innerWidth
  };
})()`);
console.log('coluna Situação:', JSON.stringify(status));
check('linhas de revisão mostram só o ícone', status.both === 0, JSON.stringify(status));
check('todas as linhas têm ícone ou contagem', status.neither === 0, JSON.stringify(status));
check('há ícones de revisão na matriz', status.withIcon > 0, JSON.stringify(status));
check('ícones sem texto de contagem', status.iconTexts.every((text) => !/\d/.test(text)), JSON.stringify(status.iconTexts));
check('contagem aparece nas demais linhas', status.countSample.every((text) => /^\d+\/\d+$/.test(text)) || status.withCount === 0, JSON.stringify(status.countSample));
check('coluna compacta', status.columnWidth <= 80, `${status.columnWidth}px`);
check('sem estouro horizontal', status.bodyOverflow <= 0, `overflow ${status.bodyOverflow}px`);

const png2 = await send('Page.captureScreenshot', { format: 'png' });
writeFileSync(new URL('../shots/qa-matriz-situacao-icone.png', import.meta.url), Buffer.from(png2.data, 'base64'));

console.log(failures ? `\n${failures} FALHA(S)` : '\ngrifo e coluna situacao: ok');
ws.close();
process.exitCode = failures ? 1 : 0;
