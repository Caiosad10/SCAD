/**
 * Testa a prévia do arquivo na tela de Apontamentos (CDP/Edge headless).
 * O revisor lê o apontamento e abre o documento dali, sem trocar de tela.
 *
 * Uso: node scripts/findingstest.mjs [porta] [processId]
 * Precisa de um CDP em CDP (padrão http://127.0.0.1:9333) e grava em shots/.
 * Só lê: não altera verificação, documento nem arquivo.
 */
import fs from 'node:fs/promises';

const CDP = process.env.CDP || 'http://127.0.0.1:9333';
const PORT = process.argv[2] || '4188';
const BASE = `http://127.0.0.1:${PORT}`;
const PID = process.argv[3] || 'prc_3c8d4787da';
const OUT = 'shots';

let failures = 0;
function check(name, condition, detail = '') {
  if (condition) console.log(`  ok   ${name}`);
  else {
    failures += 1;
    console.error(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

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
  await sleep(1500);
}

async function reload(width = 1440, height = 1000) {
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  const loaded = waitFor('Page.loadEventFired');
  await send('Page.reload');
  await Promise.race([loaded, sleep(2500)]);
  await sleep(1500);
}

async function shot(name) {
  const png = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  await fs.writeFile(`${OUT}/${name}.png`, Buffer.from(png.data, 'base64'));
  console.log(`  shot ${OUT}/${name}.png`);
}

/* -------------------------------- roteiro -------------------------------- */

await send('Page.enable');
await send('Runtime.enable');

await goto('#/documentos');
await evalJs(
  `localStorage.setItem('scad:profile', 'usr_diogenes'); localStorage.setItem('scad:activeProcess', ${JSON.stringify(PID)});`
);
await reload();
await goto('#/apontamentos');

const grupos = await evalJs(`(() => {
  const grupos = [...document.querySelectorAll('.finding-group')];
  const primo = grupos[0];
  return {
    total: grupos.length,
    nome: primo?.querySelector('.finding-group__name')?.textContent?.trim() || '',
    comPrevia: grupos.filter((g) => g.querySelector('[data-action="doc-preview"], [data-action="item-preview"]')).length,
    linhas: document.querySelectorAll('.finding').length,
  };
})()`);

check('a tela de Apontamentos lista os grupos por documento', grupos.total > 0, JSON.stringify({ total: grupos.total }));
check(
  'todo grupo de apontamento oferece o arquivo a um clique',
  grupos.comPrevia === grupos.total,
  `${grupos.comPrevia} de ${grupos.total}`
);
check('as notas continuam na lista (nada saiu da tela)', grupos.linhas >= grupos.total, JSON.stringify({ linhas: grupos.linhas }));

// Abre a prévia do primeiro grupo e confere que é o arquivo daquele documento.
const aberto = await evalJs(`(() => {
  const grupo = document.querySelector('.finding-group');
  const nome = grupo.querySelector('.finding-group__name').textContent.trim();
  grupo.querySelector('[data-action="doc-preview"], [data-action="item-preview"]').click();
  const dialog = [...document.querySelectorAll('dialog[open]')].pop();
  return {
    nome,
    hash: location.hash,
    abriu: Boolean(dialog),
    titulo: dialog?.querySelector('.sheet__title')?.textContent?.trim() || '',
    sobrancelha: dialog?.querySelector('.eyebrow')?.textContent?.trim() || '',
    corpo: (dialog?.querySelector('.sheet__body')?.innerHTML || '').length,
    temFrame: Boolean(dialog?.querySelector('.sheet__body iframe, .sheet__body img, .sheet__body object, .sheet__body pre')),
  };
})()`);
await sleep(1200);

check('clicar no ícone abre a gaveta do arquivo', aberto.abriu, JSON.stringify(aberto));
check('a gaveta abre com o nome do documento do apontamento', aberto.titulo === aberto.nome, `${aberto.titulo} ≠ ${aberto.nome}`);
check('a gaveta mostra o arquivo (frame, imagem ou texto)', aberto.temFrame && aberto.corpo > 120, `corpo: ${aberto.corpo}`);
check('abrir o arquivo não sai da tela de Apontamentos', aberto.hash === '#/apontamentos', aberto.hash);
await shot('apontamentos-01-previa');

const fechou = await evalJs(`(() => {
  const dialog = [...document.querySelectorAll('dialog[open]')].pop();
  if (!dialog) return { fechou: false };
  dialog.querySelector('[data-close]')?.click();
  return { fechou: ![...document.querySelectorAll('dialog[open]')].some((d) => d === dialog), hash: location.hash };
})()`);
await sleep(500);
check('a gaveta fecha e a lista continua ali', fechou.fechou, JSON.stringify(fechou));

// A ação de editar nota continua na linha (não foi espremida para fora).
const linha = await evalJs(`(() => {
  const primeira = document.querySelector('.finding');
  const editar = primeira?.querySelector('[data-action="finding-edit"]');
  const caixa = editar?.getBoundingClientRect();
  return { existe: Boolean(editar), visivel: caixa ? caixa.width > 0 && caixa.height > 0 : false };
})()`);
check('editar a nota continua disponível na linha', linha.existe && linha.visivel, JSON.stringify(linha));

// Como o botão entrou num cabeçalho que já tinha nome e contador, confiro a
// caixa dele por medida (não por olho): dentro do cabeçalho, sem sobrepor o
// contador e encostado na margem direita como as ações da linha.
const caixas = await evalJs(`(() => {
  const grupo = document.querySelector('.finding-group');
  const cabecalho = grupo.querySelector('.finding-group__head').getBoundingClientRect();
  const contador = grupo.querySelector('.finding-group__count').getBoundingClientRect();
  const botao = grupo.querySelector('[data-action="doc-preview"], [data-action="item-preview"]').getBoundingClientRect();
  const arred = (r) => ({ x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height), dir: Math.round(r.right), base: Math.round(r.bottom) });
  return { cabecalho: arred(cabecalho), contador: arred(contador), botao: arred(botao) };
})()`);
check(
  'o botão do arquivo fica dentro do cabeçalho do grupo',
  caixas.botao.y >= caixas.cabecalho.y && caixas.botao.base <= caixas.cabecalho.base,
  JSON.stringify(caixas)
);
check(
  'o botão do arquivo não sobrepõe o contador de apontamentos',
  caixas.botao.x >= caixas.contador.dir,
  `contador termina em ${caixas.contador.dir}, botão começa em ${caixas.botao.x}`
);
check(
  'o botão do arquivo fica na margem direita, junto das ações da linha',
  Math.abs(caixas.cabecalho.dir - caixas.botao.dir - 16) <= 3,
  `folga de ${caixas.cabecalho.dir - caixas.botao.dir} px`
);
check('o botão do arquivo tem área de toque suficiente', caixas.botao.w >= 26 && caixas.botao.h >= 26, JSON.stringify(caixas.botao));

// iPad: o botão existe e não empurra a lista para fora da tela.
await goto('#/apontamentos', { width: 390, height: 900 });
const estreito = await evalJs(`(() => {
  const botao = document.querySelector('.finding-group [data-action="doc-preview"], .finding-group [data-action="item-preview"]');
  const caixa = botao?.getBoundingClientRect();
  return {
    existe: Boolean(botao),
    visivel: caixa ? caixa.width > 0 && caixa.height > 0 : false,
    estoura: document.documentElement.scrollWidth > window.innerWidth + 1,
  };
})()`);
check(
  'no iPad o botão do arquivo aparece sem estourar a largura',
  estreito.existe && estreito.visivel && !estreito.estoura,
  JSON.stringify(estreito)
);
await shot('apontamentos-02-ipad');

// Impressão: o papel leva o apontamento, não o botão da tela.
await send('Emulation.setEmulatedMedia', { media: 'print' });
const impresso = await evalJs(`(() => {
  const botao = document.querySelector('.finding-group [data-action="doc-preview"], .finding-group [data-action="item-preview"]');
  const nome = document.querySelector('.finding-group__name');
  return {
    botaoOculto: botao ? getComputedStyle(botao).display === 'none' : false,
    nomeVisivel: nome ? getComputedStyle(nome).display !== 'none' : false,
  };
})()`);
await send('Emulation.setEmulatedMedia', { media: 'screen' });
check(
  'na impressão o botão do arquivo sai e o nome do documento fica',
  impresso.botaoOculto && impresso.nomeVisivel,
  JSON.stringify(impresso)
);

check('nenhuma exceção de JavaScript', exceptions.length === 0, exceptions.join(' | '));

console.log(failures ? `\n${failures} falha(s)` : '\nTUDO OK');
ws.close();
process.exit(failures ? 1 : 0);
