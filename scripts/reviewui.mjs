/** Testa a revisão na interface: Diogenes aprova/sinaliza, Sergio vê, presença e cascata. */
import { writeFileSync } from 'node:fs';

const CDP = process.env.CDP || 'http://127.0.0.1:9334';
const BASE = process.argv[2] || 'http://127.0.0.1:4191';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
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
const shot = async (name) => {
  const png = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(new URL(`../shots/${name}.png`, import.meta.url), Buffer.from(png.data, 'base64'));
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
await evaluate(`localStorage.setItem('scad:profile', 'usr_diogenes')`);
loaded = waitFor('Page.loadEventFired');
await send('Page.reload', { ignoreCache: false });
await loaded;
await sleep(1400);
// a sessão pode reabrir no último documento: vai para documentos e volta, para
// medir a transição (a cascata só roda na troca de tela)
await evaluate(`location.hash = '#/documentos'`);
await sleep(800);
await evaluate(`location.hash = '#/'`);
await sleep(400);
const cascade = await evaluate(`(() => {
  const view = document.querySelector('.view');
  const first = view?.firstElementChild;
  return first ? getComputedStyle(first).animationName : null;
})()`);
console.log('animação do primeiro bloco do painel:', cascade);
check('painel entra em cascata', /content-rise/.test(cascade || ''), cascade);
await sleep(700);

const mast = await evaluate(`document.querySelector('[data-mast-title]')?.textContent`);
check('cabeçalho mostra "COLEÇÃO - PROCESSO"', / - /g.test(mast || ''), mast);

const dash = await evaluate(`({
  hero: document.querySelector('.hero__title')?.textContent,
  strip: document.querySelector('.review-strip')?.textContent?.replace(/\\s+/g, ' ').trim(),
  chip: document.querySelector('[data-profile-name]')?.textContent,
  approveButtons: document.querySelectorAll('[data-action="review-approve"]').length
})`);
console.log('painel (revisor):', JSON.stringify(dash));
check('painel do revisor aponta a fila de revisão', /revis/i.test(dash.hero || ''), dash.hero);
check('painel mostra a faixa de revisão', Boolean(dash.strip) && /Aguardando revisão/.test(dash.strip), dash.strip);
await shot('qa-revisor-painel');

// cascata do painel: classes de animação aplicadas na troca de tela
await evaluate(`document.querySelector('[data-action="review-queue"]').click()`);
await sleep(1000);
const queue = await evaluate(`({
  hash: location.hash,
  reviewPressed: document.querySelector('[data-action="queue-scope"][data-scope="review"]')?.getAttribute('aria-pressed'),
  queueCount: document.querySelectorAll('.queue__item').length,
  approve: document.querySelectorAll('[data-action="review-approve"]').length,
  title: document.querySelector('.doc-head__title')?.textContent,
  summary: document.querySelector('[data-doc-summary]')?.textContent
})`);
console.log('fila de revisão:', JSON.stringify(queue));
check('fila de revisão ativa e listada', queue.reviewPressed === 'true' && queue.queueCount > 0, JSON.stringify(queue));
check('revisor vê o botão aprovar', queue.approve > 0);
await shot('qa-revisor-fila');

// abre um documento aguardando revisão (não um em atenção)
const awaitingDoc = await evaluate(`(async () => {
  const pid = localStorage.getItem('scad:activeProcess');
  const res = await fetch('/api/state', { headers: { 'X-SCAD-Process': pid } });
  const s = await res.json();
  return (s.documents || []).find((doc) => doc.review?.status === 'awaiting')?.id || null;
})()`);
console.log('documento aguardando revisão:', awaitingDoc);
check('há documento aguardando revisão', Boolean(awaitingDoc));
await evaluate(`location.hash = '#/analisar/${awaitingDoc}'`);
await sleep(900);
await evaluate(`document.querySelector('[data-action="review-approve"]').click()`);
await sleep(500);
const dialogOpen = await evaluate(`!!document.querySelector('.sheet [data-confirm]')`);
check('diálogo de aprovação abre', dialogOpen);
await evaluate(`document.querySelector('#review-approve-message').value = 'Revisado na bancada.'`);
await evaluate(`document.querySelector('.sheet [data-confirm]').click()`);
await sleep(1200);
const afterApprove = await evaluate(`({
  toast: [...document.querySelectorAll('.toast')].map((t) => t.textContent).join(' | '),
  summary: document.querySelector('[data-doc-summary]')?.textContent,
  banner: document.querySelector('.done, .done-card')?.textContent?.replace(/\\s+/g, ' ').trim().slice(0, 80)
})`);
console.log('depois de aprovar:', JSON.stringify(afterApprove));
check('aprovação mostra confirmação', /aprovado/i.test(afterApprove.banner || '') || /Aprovado/i.test(afterApprove.summary || ''), JSON.stringify(afterApprove));
await shot('qa-revisor-aprovado');

// abre outro documento em revisão e sinaliza um critério
await evaluate(`(() => {
  const items = [...document.querySelectorAll('.queue__item')];
  const next = items.find((item) => !item.classList.contains('is-current')) || items[0];
  next?.click();
})()`);
await sleep(900);
const flagButton = await evaluate(`document.querySelector('[data-action="review-flag"]') ? true : false`);
check('revisor vê a ação sinalizar em critérios avaliados', flagButton);
await evaluate(`document.querySelector('[data-action="review-flag"]').click()`);
await sleep(500);
const disabledBefore = await evaluate(`document.querySelector('.sheet [data-confirm]')?.disabled`);
check('sinalizar exige mensagem (botão desabilitado)', disabledBefore === true);
await evaluate(`(() => {
  const area = document.querySelector('#review-flag-message');
  area.value = 'Citar a evidência do relatório de auditoria.';
  area.dispatchEvent(new Event('input', { bubbles: true }));
})()`);
await sleep(200);
const enabledAfter = await evaluate(`document.querySelector('.sheet [data-confirm]')?.disabled === false`);
check('mensagem habilita a sinalização', enabledAfter);
await evaluate(`document.querySelector('.sheet [data-confirm]').click()`);
await sleep(1300);
const afterFlag = await evaluate(`({
  flagText: document.querySelector('.check__flag')?.textContent?.replace(/\\s+/g, ' ').trim(),
  summary: document.querySelector('[data-doc-summary]')?.textContent,
  banner: document.querySelector('.done, .done-card')?.textContent?.replace(/\\s+/g, ' ').trim().slice(0, 90),
  toast: [...document.querySelectorAll('.toast')].map((t) => t.textContent).join(' | ')
})`);
console.log('depois de sinalizar:', JSON.stringify(afterFlag));
check('critério sinalizado mostra a mensagem', /evid[êe]ncia/i.test(afterFlag.flagText || ''), afterFlag.flagText);
check('documento fica em atenção', /aten[çc][ãa]o/i.test(afterFlag.summary || '') || /sinaliza/i.test(afterFlag.banner || ''), JSON.stringify(afterFlag));
const approveOnAttention = await evaluate(`document.querySelectorAll('[data-action="review-approve"]').length`);
check('documento em atenção não oferece aprovar', approveOnAttention === 0, `botões: ${approveOnAttention}`);
await shot('qa-revisor-sinalizado');

// troca para Sergio: sem ações de revisor, mas vê a sinalização
await evaluate(`document.querySelector('[data-action="switch-profile"]').click()`);
await sleep(400);
await evaluate(`[...document.querySelectorAll('[data-profile-id]')].find((b) => b.textContent.includes('Sergio')).click()`);
await sleep(1000);
const asSergio = await evaluate(`({
  chip: document.querySelector('[data-profile-name]')?.textContent,
  approve: document.querySelectorAll('[data-action="review-approve"]').length,
  flag: document.querySelectorAll('[data-action="review-flag"]').length,
  flagText: document.querySelector('.check__flag')?.textContent?.replace(/\\s+/g, ' ').trim(),
  summary: document.querySelector('[data-doc-summary]')?.textContent,
  presence: document.querySelector('[data-presence]')?.textContent?.trim()
})`);
console.log('como Sergio:', JSON.stringify(asSergio));
check('Sergio não vê ações de revisor', asSergio.approve === 0 && asSergio.flag === 0, JSON.stringify(asSergio));
check('Sergio vê a mensagem da sinalização', /evid[êe]ncia/i.test(asSergio.flagText || ''), asSergio.flagText);

// presença: Diogenes entra no mesmo documento pela API e o Sergio deve ver
const docId = await evaluate(`document.querySelector('[data-presence]')?.getAttribute('data-presence')`);
const pid = await evaluate(`localStorage.getItem('scad:activeProcess')`);
const presenceRes = await fetch(`${BASE}/api/presence`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-SCAD-Actor': 'usr_diogenes', 'X-SCAD-Process': pid },
  body: JSON.stringify({ docId }),
});
const presenceJson = await presenceRes.json();
console.log('presença via API:', JSON.stringify(presenceJson));
check(
  'presença de Diogenes registrada (Sergio aparece para ele)',
  presenceJson.present?.some((item) => item.actorName === 'Sergio' && item.docId === docId)
);
await sleep(13500);
const seen = await evaluate(`document.querySelector('[data-presence]')?.textContent?.replace(/\\s+/g, ' ').trim()`);
console.log('presença na tela:', seen);
check('Sergio vê "Diogenes está aqui"', /Diogenes est[áa] aqui/i.test(seen || ''), seen);
await shot('qa-presenca-diogenes');

// filtro de revisão na lista de documentos
await evaluate(`location.hash = '#/documentos'`);
await sleep(800);
await evaluate(`document.querySelector('[data-action="filter-docs"][data-filter="review"]').click()`);
await sleep(500);
const listFilter = await evaluate(`({
  pressed: document.querySelector('[data-action="filter-docs"][data-filter="review"]')?.getAttribute('aria-pressed'),
  rows: document.querySelectorAll('.docrow').length,
  results: document.querySelector('#doc-results')?.textContent
})`);
console.log('filtro de revisão:', JSON.stringify(listFilter));
check('filtro Revisão funciona', listFilter.pressed === 'true', JSON.stringify(listFilter));
await shot('qa-documentos-revisao');

console.log(failures ? `\n${failures} FALHA(S)` : '\nrevisão na interface: ok');
ws.close();
process.exitCode = failures ? 1 : 0;
