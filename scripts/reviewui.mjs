/** Testa a revisão na interface: Diogenes aprova/sinaliza, Sergio vê, presença na matriz e cascata. */
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

// cascata do painel (só roda na troca de tela)
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

// revisor: só “Aguardando revisão” (não vê Atenção) + Aprovados
const dash = await evaluate(`({
  hero: document.querySelector('.hero__title')?.textContent,
  chip: document.querySelector('[data-profile-name]')?.textContent,
  pills: [...document.querySelectorAll('.review-pill')].map((pill) => ({
    label: pill.querySelector('.review-pill__label')?.textContent?.trim(),
    count: pill.querySelector('.review-pill__count')?.textContent?.trim(),
    icon: Boolean(pill.querySelector('.review-pill__icon svg')),
    go: Boolean(pill.querySelector('.review-pill__go svg')),
    filter: pill.dataset.filter
  })),
  highlighted: Boolean(document.querySelector('.review-strip__label'))
})`);
console.log('painel (revisor):', JSON.stringify(dash));
const pillLabels = dash.pills.map((pill) => pill.label);
check('painel do revisor aponta a fila de revisão', /revis/i.test(dash.hero || ''), dash.hero);
check('“Revisão” destacado na faixa', dash.highlighted);
check('revisor vê “Aguardando revisão”', pillLabels.includes('Aguardando revisão'), pillLabels.join(', '));
check('revisor NÃO vê “Atenção”', !pillLabels.includes('Atenção'), pillLabels.join(', '));
check('atalho “Aprovados” presente e clicável', pillLabels.includes('Aprovados'), pillLabels.join(', '));
check(
  'atalhos têm ícone, contador e seta',
  dash.pills.every((pill) => pill.icon && pill.count !== undefined && pill.go),
  JSON.stringify(dash.pills)
);
await shot('qa-revisor-painel');

await evaluate(`document.querySelector('[data-action="review-queue"]').click()`);
await sleep(1000);
const queue = await evaluate(`({
  hash: location.hash,
  reviewPressed: document.querySelector('[data-action="queue-scope"][data-scope="review"]')?.getAttribute('aria-pressed'),
  queueCount: document.querySelectorAll('.queue__item').length,
  approve: document.querySelectorAll('[data-action="review-approve"]').length,
  title: document.querySelector('.doc-head__title')?.textContent,
  listHasPresence: Boolean(document.querySelector('[data-presence]'))
})`);
console.log('fila de revisão:', JSON.stringify(queue));
check('fila de revisão ativa e listada', queue.reviewPressed === 'true' && queue.queueCount > 0, JSON.stringify(queue));
check('revisor vê o botão aprovar', queue.approve > 0);
check('“Analisar” não mostra presença', queue.listHasPresence === false);
await shot('qa-revisor-fila');

// abre um documento aguardando revisão
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
  summary: document.querySelector('[data-doc-summary]')?.textContent,
  banner: document.querySelector('.done, .done-card')?.textContent?.replace(/\\s+/g, ' ').trim().slice(0, 80)
})`);
console.log('depois de aprovar:', JSON.stringify(afterApprove));
check(
  'aprovação mostra confirmação',
  /aprovado/i.test(afterApprove.banner || '') || /Aprovado/i.test(afterApprove.summary || ''),
  JSON.stringify(afterApprove)
);
await shot('qa-revisor-aprovado');

// abre um documento em revisão e sinaliza um critério
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
  banner: document.querySelector('.done, .done-card')?.textContent?.replace(/\\s+/g, ' ').trim().slice(0, 90)
})`);
console.log('depois de sinalizar:', JSON.stringify(afterFlag));
check('critério sinalizado mostra a mensagem', /evid[êe]ncia/i.test(afterFlag.flagText || ''), afterFlag.flagText);
check(
  'documento fica em atenção',
  /aten[çc][ãa]o/i.test(afterFlag.summary || '') || /sinaliza/i.test(afterFlag.banner || ''),
  JSON.stringify(afterFlag)
);
const approveOnAttention = await evaluate(`document.querySelectorAll('[data-action="review-approve"]').length`);
check('documento em atenção não oferece aprovar', approveOnAttention === 0, `botões: ${approveOnAttention}`);
await shot('qa-revisor-sinalizado');

const flaggedDocId = await evaluate(`location.hash.split('/').pop()`);

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
  presenceInWorkbench: Boolean(document.querySelector('[data-presence]'))
})`);
console.log('como Sergio:', JSON.stringify(asSergio));
check('Sergio não vê ações de revisor', asSergio.approve === 0 && asSergio.flag === 0, JSON.stringify(asSergio));
check('Sergio vê a mensagem da sinalização', /evid[êe]ncia/i.test(asSergio.flagText || ''), asSergio.flagText);
check('presença saiu da aba Analisar', asSergio.presenceInWorkbench === false);

// presença: Diogenes entra no documento sinalizado e o Sergio vê na matriz do painel
const pid = await evaluate(`localStorage.getItem('scad:activeProcess')`);
const presenceRes = await fetch(`${BASE}/api/presence`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-SCAD-Actor': 'usr_diogenes', 'X-SCAD-Process': pid },
  body: JSON.stringify({ docId: flaggedDocId }),
});
console.log('presença via API (Diogenes no documento):', JSON.stringify(await presenceRes.json()));
await evaluate(`location.hash = '#/'`);
await sleep(2500);
const matrixPresence = await evaluate(`(() => {
  const nodes = [...document.querySelectorAll('.matrix__presence')];
  return {
    total: nodes.length,
    visible: nodes.filter((node) => node.textContent.trim()).length,
    text: nodes.map((node) => node.textContent.replace(/\\s+/g, ' ').trim()).filter(Boolean),
    target: document.querySelector('.matrix__presence[data-presence="${flaggedDocId}"]')?.textContent?.replace(/\\s+/g, ' ').trim()
  };
})()`);
console.log('presença na matriz:', JSON.stringify(matrixPresence));
check('Sergio vê "Diogenes está aqui" na matriz', /Diogenes est[áa] aqui/i.test(matrixPresence.target || ''), matrixPresence.target);
check('só a linha ocupada mostra presença', matrixPresence.visible === 1, JSON.stringify(matrixPresence));
await shot('qa-presenca-matriz');

// coluna Situação: ícone sozinho nos estados de revisão; contagem nas demais
const statusCells = await evaluate(`(() => {
  const cells = [...document.querySelectorAll('.matrix__status')];
  const rows = cells.map((cell) => ({
    icon: Boolean(cell.querySelector('.matrix__smark svg')),
    count: (cell.querySelector('.matrix__status-count')?.textContent || '').trim()
  }));
  return {
    total: cells.length,
    withIcon: rows.filter((row) => row.icon).length,
    withCount: rows.filter((row) => row.count).length,
    both: rows.filter((row) => row.icon && row.count).length,
    neither: rows.filter((row) => !row.icon && !row.count).length,
    longText: cells.filter((cell) => (cell.textContent || '').trim().length > 12).length,
    legend: Boolean(document.querySelector('.matrix__legend--review'))
  };
})()`);
console.log('coluna situação:', JSON.stringify(statusCells));
check('situação usa ícone sozinho nos estados de revisão', statusCells.both === 0, JSON.stringify(statusCells));
check('todas as linhas têm ícone ou contagem', statusCells.neither === 0, JSON.stringify(statusCells));
check('há ícones de situação na matriz', statusCells.withIcon > 0, JSON.stringify(statusCells));
check('contagem nas linhas em análise', statusCells.withCount > 0, JSON.stringify(statusCells));
check('situação sem texto longo quebrando linha', statusCells.longText === 0, JSON.stringify(statusCells));
check('legenda explica os ícones de situação', statusCells.legend);

// Sergio: faixa mostra Atenção (não Aguardando revisão) + Aprovados
const sergioDash = await evaluate(`({
  hero: document.querySelector('.hero__title')?.textContent,
  pills: [...document.querySelectorAll('.review-pill')].map((pill) => ({
    label: pill.querySelector('.review-pill__label')?.textContent?.trim(),
    filter: pill.dataset.filter
  }))
})`);
console.log('painel (analista):', JSON.stringify(sergioDash));
const sergioPills = sergioDash.pills.map((pill) => pill.label);
check('analista vê “Atenção”', sergioPills.includes('Atenção'), sergioPills.join(', '));
check('analista NÃO vê “Aguardando revisão”', !sergioPills.includes('Aguardando revisão'), sergioPills.join(', '));
check('faixa do analista explica a correção', /sinaliza|corrigir/i.test(sergioDash.hero || ''), sergioDash.hero);
await shot('qa-analista-painel');

// atalho “Aprovados” filtra só aprovados
await evaluate(`document.querySelector('.review-pill--ok').click()`);
await sleep(900);
const approvedFilter = await evaluate(`({
  hash: location.hash,
  pressed: document.querySelector('[data-action="filter-docs"][data-filter="approved"]')?.getAttribute('aria-pressed'),
  note: document.querySelector('.filter-note')?.textContent?.replace(/\\s+/g, ' ').trim(),
  rows: document.querySelectorAll('.docrow').length,
  badges: [...document.querySelectorAll('.docrow__stamp')].map((node) => node.textContent.trim())
})`);
console.log('filtro aprovados:', JSON.stringify(approvedFilter));
check('atalho Aprovados abre a lista filtrada', approvedFilter.pressed === 'true', JSON.stringify(approvedFilter));
check('aviso “Mostrando: Aprovados”', /Aprovados/.test(approvedFilter.note || ''), approvedFilter.note);
check('lista só com aprovados', approvedFilter.rows > 0 && approvedFilter.badges.every((badge) => /Aprovado/i.test(badge)), JSON.stringify(approvedFilter.badges));
await shot('qa-documentos-aprovados');

console.log(failures ? `\n${failures} FALHA(S)` : '\nrevisão na interface: ok');
ws.close();
process.exitCode = failures ? 1 : 0;
