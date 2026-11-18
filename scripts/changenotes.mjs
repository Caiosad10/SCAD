/**
 * Testa o "O que mudou" manual (CDP/Edge headless) na bancada de análise.
 *
 * Cobre o que o revisor pediu em 18/11:
 *  - a barra de verificações não oferece mais "Importar mais" (só a listagem
 *    do fluxo de requisitos cresce por ali);
 *  - o painel "O que mudou" sempre começa fechado;
 *  - quando o diff não roda (PDF), quem corrigiu descreve o que mudou e o
 *    revisor lê esse relato — nada de painel vazio.
 *
 * Uso: node scripts/changenotes.mjs [porta] [processId] [processIdRequisitos]
 * Precisa de um CDP em CDP (padrão http://127.0.0.1:9333). Grava em shots/.
 * Altera dados: cria e apaga uma correção de teste no processo indicado.
 */
import fs from 'node:fs/promises';
import path from 'node:path';

const CDP = process.env.CDP || 'http://127.0.0.1:9333';
const PORT = process.argv[2] || '4188';
const BASE = `http://127.0.0.1:${PORT}`;
const PID = process.argv[3] || 'prc_3c8d4787da';
const REQ_PID = process.argv[4] || 'prc_b3623678ea';
const DADOS = process.env.SCAD_DATA || path.resolve('.qa-correcao');
const OUT = 'shots';
const SERGIO = 'usr_sergio';
const DIOGENES = 'usr_diogenes';

let failures = 0;
function check(name, condition, detail = '') {
  if (condition) console.log(`  ok   ${name}`);
  else {
    failures += 1;
    console.error(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

/* ------------------------------------------------------------------- API */
async function call(method, rota, body, actor = SERGIO, process = null) {
  const headers = { 'X-SCAD-Actor': actor };
  if (process) headers['X-SCAD-Process'] = process;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${BASE}${rota}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const raw = await res.text();
  let json = null;
  try {
    json = JSON.parse(raw);
  } catch {
    /* corpo vazio ou binário */
  }
  return { status: res.status, json, raw };
}

const health = (await call('GET', '/api/health')).json;
check('QA na porta de teste com a v2.3.x', health?.port === Number(PORT) && /^2\.3\./.test(health?.version || ''), JSON.stringify(health));
if (health?.port === 4177) {
  console.error('ABORTADO: este script não roda na produção (4177).');
  process.exit(2);
}

let state = (await call('GET', `/api/state?processId=${encodeURIComponent(PID)}`)).json;
if (!state?.process) {
  console.error(`ABORTADO: processo ${PID} não encontrado.`);
  process.exit(2);
}
const docs = (state.documents || []).filter((doc) => doc.itemKind !== 'item' && doc.active !== false);
const pdfDoc = docs.find((doc) => /\.pdf$/i.test(doc.name) && !doc.correction);
const docxDoc = docs.find((doc) => /\.docx?$/i.test(doc.name) && !doc.correction);
check('processo tem um PDF sem correção para o teste', Boolean(pdfDoc), pdfDoc?.name);
check('processo tem um arquivo com texto sem correção para o teste', Boolean(docxDoc), docxDoc?.name);
if (!pdfDoc || !docxDoc) process.exit(1);

/* Correção pendente em PDF criada pela API (sem relato, como antes da v2.3.1). */
const pdfBin = Buffer.from(await (await fetch(`${BASE}/files/${encodeURIComponent(pdfDoc.stored)}`)).arrayBuffer());
const CORRIGIDO = `${pdfDoc.name.replace(/\.pdf$/i, '')}-corrigido.pdf`;
let res = await call(
  'POST',
  `/api/documents/${pdfDoc.id}/correction`,
  { name: CORRIGIDO, data: pdfBin.toString('base64') },
  SERGIO,
  PID
);
check('correção em PDF criada para o teste (201)', res.status === 201, `status ${res.status} ${res.raw?.slice(0, 140)}`);
if (res.status !== 201) process.exit(1);
const limpar = async () => {
  await call('DELETE', `/api/documents/${pdfDoc.id}/correction`, undefined, SERGIO, PID);
};

/* ------------------------------------------------------------------- CDP */
const target = await (await fetch(`${CDP}/json/new?${encodeURIComponent('about:blank')}`, { method: 'PUT' })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
let seq = 0;
const pending = new Map();
const waiters = new Map();
const exceptions = [];

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
  if (message.method === 'Runtime.exceptionThrown') {
    exceptions.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
  }
  if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
    exceptions.push(`console.error: ${message.params.args.map((a) => a.value ?? a.description).join(' ')}`);
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

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function evalJs(expression) {
  const out = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (out.exceptionDetails) throw new Error(out.exceptionDetails.text || 'erro na expressão');
  return out.result?.value;
}

async function goto(hash, { width = 1440, height = 1000 } = {}) {
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  const loaded = waitFor('Page.loadEventFired');
  await send('Page.navigate', { url: `${BASE}/${hash}` });
  await Promise.race([loaded, sleep(2500)]);
  await sleep(1400);
}

async function reload(width = 1440, height = 1000) {
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  const loaded = waitFor('Page.loadEventFired');
  await send('Page.reload');
  await Promise.race([loaded, sleep(2500)]);
  await sleep(1400);
}

async function shot(name) {
  const png = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  await fs.writeFile(`${OUT}/${name}.png`, Buffer.from(png.data, 'base64'));
  console.log(`  shot ${OUT}/${name}.png`);
}

async function click(selector) {
  const ok = await evalJs(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return false;
    el.click();
    return true;
  })()`);
  if (!ok) throw new Error(`não achei ${selector}`);
  await sleep(220);
}

async function tipo(selector, texto) {
  await evalJs(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return false;
    el.focus();
    el.value = ${JSON.stringify(texto)};
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  await sleep(150);
}

async function perfil(quem, processId = PID) {
  await evalJs(
    `localStorage.setItem('scad:profile', ${JSON.stringify(quem)});` +
      `localStorage.setItem('scad:activeProcess', ${JSON.stringify(processId)});`
  );
  await reload();
}

const painel = () =>
  evalJs(`(() => {
    const d = [...document.querySelectorAll('dialog[open]')].pop();
    if (!d) return null;
    const secao = d.querySelector('[data-compare-diff]');
    const corpo = d.querySelector('[data-diff-host]');
    return {
      temSecao: Boolean(secao),
      aberto: corpo ? !corpo.hidden : null,
      dataOpen: secao?.getAttribute('data-open'),
      expandido: d.querySelector('[data-compare-diff-toggle]')?.getAttribute('aria-expanded'),
      resumo: d.querySelector('[data-diff-summary]')?.textContent?.trim() || '',
      corpo: corpo?.innerText?.trim() || '',
      temRelato: Boolean(corpo?.querySelector('.changenote__text')),
      relato: corpo?.querySelector('.changenote__text')?.innerText?.trim() || '',
      temBotaoEditar: Boolean(corpo?.querySelector('[data-change-note-edit]')),
      temCampo: Boolean(corpo?.querySelector('#change-note-input')),
    };
  })()`);

const RELATO = 'Removi o quadro de prazos e corrigi o nome do responsável técnico.';

/* --------------------------------------------------- 1. barra de verificações */
await send('Page.enable');
await send('Runtime.enable');
await send('DOM.enable');
await goto('#/documentos');
await perfil(SERGIO);
await goto(`#/documentos/${pdfDoc.id}`);
await sleep(900);

const barra = await evalJs(`(() => {
  const head = document.querySelector('[data-checks-head]');
  return {
    temHead: Boolean(head),
    texto: head?.innerText?.replace(/\\s+/g, ' ').trim() || '',
    botoes: [...(head?.querySelectorAll('button[data-action]') || [])].map((b) => b.dataset.action),
    importar: Boolean(head?.querySelector('[data-action="open-import"]')),
  };
})()`);
check('bancada do documento mostra a barra de verificações', barra?.temHead === true);
check('barra de verificações não oferece "Importar mais"', barra?.importar === false, JSON.stringify(barra?.botoes));
check('barra continua mostrando o progresso', /verifica/i.test(barra?.texto || ''), barra?.texto);
await shot('changenotes-01-bancada-sem-importar');

/* ------------------------------------------------- 2. listagem (requisitos) */
await perfil(SERGIO, REQ_PID);
await goto('#/apontamentos');
await sleep(600);
const reqState = (await call('GET', `/api/state?processId=${encodeURIComponent(REQ_PID)}`)).json;
const itemDoc = (reqState?.documents || []).find((doc) => doc.itemKind === 'item');
if (itemDoc) {
  await goto(`#/documentos/${itemDoc.id}`);
  await sleep(800);
  const barraReq = await evalJs(`(() => {
    const head = document.querySelector('[data-checks-head]');
    return {
      acoes: [...(head?.querySelectorAll('button[data-action]') || [])].map((b) => b.dataset.action),
      texto: head?.innerText?.replace(/\\s+/g, ' ').trim() || '',
    };
  })()`);
  check(
    'barra de verificações da listagem também está sem ação',
    (barraReq?.acoes || []).length === 0 && /verifica/i.test(barraReq?.texto || ''),
    JSON.stringify(barraReq)
  );
} else {
  console.log('  --   (processo de requisitos sem item; "Adicionar item" não verificado)');
}

/* --------------------------------------- 3. painel fechado, relato do autor */
await perfil(SERGIO);
await goto(`#/documentos/${pdfDoc.id}`);
await click('[data-action="correction-open"]');
for (let i = 0; i < 30; i += 1) {
  const p = await painel();
  if (p?.resumo && !/comparando/i.test(p.resumo)) break;
  await sleep(250);
}
let p = await painel();
check('comparação abre com o painel "O que mudou" fechado', p?.aberto === false && p.dataOpen === 'false' && p.expandido === 'false', JSON.stringify(p?.aberto));
check('resumo do painel diz que não há texto para comparar', /sem texto para comparar/i.test(p?.resumo || ''), p?.resumo);
await shot('changenotes-02-painel-fechado');

await click('[data-compare-diff-toggle]');
p = await painel();
check('painel aberto mostra o espaço do relato', p?.temRelato === true);
check('sem relato, o painel avisa que ninguém descreveu', /não descreveu o que mudou/i.test(p?.corpo || ''), p?.corpo?.slice(0, 120));
check('autor vê o botão para descrever o que mudou', p?.temBotaoEditar === true);
await shot('changenotes-03-painel-sem-relato');

await click('[data-change-note-edit]');
check('editar abre o campo do relato', (await painel())?.temCampo === true);
await tipo('#change-note-input', RELATO);
await shot('changenotes-04-escrevendo');
await click('[data-change-note-save]');
for (let i = 0; i < 20; i += 1) {
  p = await painel();
  if (p?.relato) break;
  await sleep(200);
}
check('relato salvo aparece no painel', p?.relato === RELATO, p?.relato);
check('painel continua aberto depois de salvar', p?.aberto === true);
check('resumo passa a creditar quem corrigiu', /relato de Sergio/i.test(p?.resumo || ''), p?.resumo);
check('botão de editar continua disponível para o autor', p?.temBotaoEditar === true);
await shot('changenotes-05-relato-salvo');

state = (await call('GET', `/api/state?processId=${encodeURIComponent(PID)}`)).json;
const guardado = (state.documents || []).find((doc) => doc.id === pdfDoc.id)?.correction;
check('servidor guarda o relato na correção', guardado?.changeNote === RELATO, JSON.stringify(guardado)?.slice(0, 160));

await click('dialog [data-close]');
await sleep(300);

/* ------------------------------------------- 4. o revisor lê e não edita */
await perfil(DIOGENES);
await goto(`#/documentos/${pdfDoc.id}`);
await click('[data-action="correction-open"]');
for (let i = 0; i < 30; i += 1) {
  p = await painel();
  if (p?.resumo && !/comparando/i.test(p.resumo)) break;
  await sleep(250);
}
check('revisor abre a comparação com o painel fechado', p?.aberto === false);
check('revisor vê de quem é o relato no resumo', /relato de Sergio/i.test(p?.resumo || ''), p?.resumo);
await click('[data-compare-diff-toggle]');
p = await painel();
check('revisor lê o relato do que mudou', p?.relato === RELATO, p?.relato?.slice(0, 80));
check('revisor não edita o relato', p?.temBotaoEditar === false);
await shot('changenotes-06-revisor-le');
await click('dialog [data-close]');
await sleep(300);

/* ------------------------- 5. envio: relato obrigatório só quando não há texto */
await perfil(SERGIO);
await goto(`#/documentos/${docxDoc.id}`);
await sleep(600);
await click('[data-action="correction-add"], [data-action="correction-open"]');
await sleep(500);

const setFile = async (caminho) => {
  const doc = await send('DOM.getDocument', { depth: -1 });
  const found = await send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: '#correction-file' });
  await send('DOM.setFileInputFiles', { files: [caminho], nodeId: found.nodeId });
  await sleep(1200);
};

const docxPath = path.join(DADOS, 'files', docxDoc.stored);
const pdfPath = path.join(DADOS, 'files', pdfDoc.stored);
const estadoEnvio = () =>
  evalJs(`(() => {
    const d = [...document.querySelectorAll('dialog[open]')].pop();
    if (!d) return null;
    const box = d.querySelector('#correction-changed');
    const btn = d.querySelector('[data-confirm]');
    return {
      campoVisivel: box ? !box.hidden : null,
      texto: d.querySelector('#correction-changed-text')?.value || '',
      confirmarDesabilitado: btn ? btn.disabled : null,
      selecionado: d.querySelector('#correction-selected')?.innerText?.trim() || '',
    };
  })()`);

await setFile(docxPath);
let envio = await estadoEnvio();
check('arquivo com texto não pede o relato', envio?.campoVisivel === false, JSON.stringify(envio));
check('arquivo com texto libera o envio', envio?.confirmarDesabilitado === false);

await setFile(pdfPath);
envio = await estadoEnvio();
check('PDF pede o "O que mudou"', envio?.campoVisivel === true, JSON.stringify(envio));
check('envio fica travado sem o relato', envio?.confirmarDesabilitado === true);
await shot('changenotes-07-envio-pede-relato');

await tipo('#correction-changed-text', 'Ajustei o cabeçalho e a data de vigência.');
envio = await estadoEnvio();
check('com o relato, o envio é liberado', envio?.confirmarDesabilitado === false);
await click('dialog [data-cancel]');
await sleep(300);

/* --------------------------------------------------------------- limpeza */
await limpar();
state = (await call('GET', `/api/state?processId=${encodeURIComponent(PID)}`)).json;
const sobrou = (state.documents || []).find((doc) => doc.id === pdfDoc.id)?.correction;
check('correção de teste removida', !sobrou);

check('sem erro de JavaScript na página', exceptions.length === 0, exceptions.slice(0, 2).join(' | '));

ws.close();
console.log(failures === 0 ? '\nTUDO OK' : `\n${failures} FALHA(S)`);
process.exit(failures === 0 ? 0 : 1);
