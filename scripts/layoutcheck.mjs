/** Confere layout da faixa de revisão e o efeito da presença na altura da matriz. */
const CDP = process.env.CDP || 'http://127.0.0.1:9334';
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
await send('Emulation.setDeviceMetricsOverride', { width: 834, height: 1194, deviceScaleFactor: 1, mobile: true });

let loaded = waitFor('Page.loadEventFired');
await send('Page.navigate', { url: `${BASE}/#/` });
await loaded;
await sleep(1200);
await evaluate(`localStorage.setItem('scad:profile', 'usr_sergio')`);
loaded = waitFor('Page.loadEventFired');
await send('Page.reload', { ignoreCache: false });
await loaded;
await sleep(1400);
// a sessão reabre na última tela (lista de documentos): volta ao painel
await evaluate(`location.hash = '#/'`);
await sleep(1000);

const strip = await evaluate(`(() => {
  const node = document.querySelector('.review-strip');
  if (!node) return { found: false };
  const box = node.getBoundingClientRect();
  const pills = [...node.querySelectorAll('.review-pill')].map((pill) => {
    const rect = pill.getBoundingClientRect();
    return { label: pill.textContent.replace(/\\s+/g, ' ').trim(), w: Math.round(rect.width), h: Math.round(rect.height) };
  });
  return {
    found: true,
    width: Math.round(box.width),
    height: Math.round(box.height),
    pills,
    bodyOverflow: document.documentElement.scrollWidth - window.innerWidth
  };
})()`);
console.log('faixa:', JSON.stringify(strip));
check('faixa de revisão presente', strip.found);
check('sem estouro horizontal da página', (strip.bodyOverflow ?? 0) <= 0, `overflow ${strip.bodyOverflow}px`);
check(
  'atalhos com alvo de toque >= 32px',
  (strip.pills || []).every((pill) => pill.h >= 32),
  JSON.stringify(strip.pills)
);

const ids = await evaluate(`(async () => {
  const pid = localStorage.getItem('scad:activeProcess');
  const res = await fetch('/api/state', { headers: { 'X-SCAD-Process': pid } });
  const s = await res.json();
  return { pid, docs: (s.documents || []).slice(0, 2).map((doc) => doc.id) };
})()`);

const setPresence = (docId) =>
  fetch(`${BASE}/api/presence`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-SCAD-Actor': 'usr_diogenes', 'X-SCAD-Process': ids.pid },
    body: JSON.stringify({ docId }),
  });

const measure = async (docId) =>
  evaluate(`(() => {
    const node = document.querySelector('.matrix__presence[data-presence="${docId}"]');
    const row = node?.closest('tr');
    const other = [...document.querySelectorAll('.matrix tbody tr')].find((tr) => tr !== row);
    return {
      height: row ? Math.round(row.getBoundingClientRect().height) : null,
      otherHeight: other ? Math.round(other.getBoundingClientRect().height) : null,
      text: node?.textContent?.replace(/\\s+/g, ' ').trim() || '',
      visible: [...document.querySelectorAll('.matrix__presence')].filter((n) => n.textContent.trim()).length
    };
  })()`);

// estado limpo: ninguém por aqui
await setPresence(null);
await sleep(13500);
const baseline = await measure(ids.docs[0]);
console.log('linha sem presença:', JSON.stringify(baseline));
check('sem alerta quando ninguém está no documento', baseline.visible === 0 && baseline.text === '', JSON.stringify(baseline));

// Diogenes entra no documento
await setPresence(ids.docs[0]);
const deadline = Date.now() + 20000;
let during = baseline;
while (Date.now() < deadline && !/Diogenes/.test(during.text)) {
  await sleep(1000);
  during = await measure(ids.docs[0]);
}
console.log('linha com presença:', JSON.stringify(during));
check('presença aparece na linha do documento', /Diogenes est[áa] aqui/i.test(during.text), during.text);
check('presença é discreta (<= 22px de acréscimo)', during.height - baseline.height <= 22, `${baseline.height} → ${during.height}`);
check('outra linha mantém a altura', during.otherHeight === baseline.otherHeight, `${baseline.otherHeight} → ${during.otherHeight}`);

// Diogenes sai: a linha volta ao tamanho de antes
await setPresence(null);
const backDeadline = Date.now() + 20000;
let after = during;
while (Date.now() < backDeadline && after.visible > 0) {
  await sleep(1000);
  after = await measure(ids.docs[0]);
}
console.log('linha depois de sair:', JSON.stringify(after));
check('alerta desaparece ao sair', after.visible === 0 && after.text === '', JSON.stringify(after));
check('tabela volta à altura original', after.height === baseline.height, `${baseline.height} → ${after.height}`);

// viewport de telefone: faixa e matriz sem estourar a página
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
await sleep(700);
const phone = await evaluate(`(() => {
  const strip = document.querySelector('.review-strip')?.getBoundingClientRect();
  return {
    overflow: document.documentElement.scrollWidth - window.innerWidth,
    stripWidth: strip ? Math.round(strip.width) : null,
    innerWidth: window.innerWidth,
    statusWidth: Math.round(document.querySelector('.matrix__status')?.getBoundingClientRect().width || 0)
  };
})()`);
console.log('telefone:', JSON.stringify(phone));
check('telefone sem estouro horizontal', phone.overflow <= 1, `overflow ${phone.overflow}px`);
check('coluna Situação legível com ícone', phone.statusWidth >= 60, `${phone.statusWidth}px`);

console.log(failures ? `\n${failures} FALHA(S)` : '\nlayout e presença: ok');
ws.close();
process.exitCode = failures ? 1 : 0;
