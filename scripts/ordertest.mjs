/**
 * Testa a ordem da lista de documentos via CDP (Edge headless).
 * Confere: ordem padrão (importação), atividade recente, parado há mais tempo,
 * nome, o filtro de revisão, a data mostrada na linha e a memória da escolha.
 *
 * Uso: node scripts/ordertest.mjs [porta] [processId]
 * Precisa de um CDP em CDP (padrão http://127.0.0.1:9333) e grava em shots/.
 * Só lê o banco: não cria, não altera e não apaga documento.
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

/* ---------- o que o servidor diz (referência para comparar a tela) -------- */

const state = await (await fetch(`${BASE}/api/state?processId=${PID}`)).json();
const listaveis = (state.documents || []).filter((doc) => !doc.itemId);
const checks = state.checks || [];

/** Mesma conta do app: a mexida mais recente do documento. */
function atividade(doc) {
  let latest = doc.addedAt || '';
  const toma = (valor) => {
    if (valor && valor > latest) latest = valor;
  };
  for (const check of checks.filter((c) => c.docId === doc.id)) {
    toma(check.updatedAt);
    toma(check.review?.at);
  }
  toma(doc.correction?.addedAt);
  toma(doc.reopen?.at);
  for (const version of doc.versions || []) toma(version.replacedAt);
  return latest;
}

const porAtividadeRecente = [...listaveis].sort((a, b) => atividade(b).localeCompare(atividade(a))).map((d) => d.name);
const porAtividadeAntiga = [...listaveis].sort((a, b) => atividade(a).localeCompare(atividade(b))).map((d) => d.name);
const porNome = [...listaveis]
  .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR', { numeric: true, sensitivity: 'base' }))
  .map((d) => d.name);
const porImportacao = listaveis.map((d) => d.name);

/* ------------------------------- navegador ------------------------------- */

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
  await sleep(1500);
}

async function shot(name) {
  const png = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  await fs.writeFile(`${OUT}/${name}.png`, Buffer.from(png.data, 'base64'));
  console.log(`  shot ${OUT}/${name}.png`);
}

/** Nomes na ordem em que a lista está desenhada agora. */
async function ordemNaTela() {
  return evalJs(`[...document.querySelectorAll('#doclist .docrow__name')].map((el) => el.textContent.trim())`);
}

/** Escolhe uma opção no seletor de ordem, como o dedo do revisor faria. */
async function escolherOrdem(valor) {
  const ok = await evalJs(`(() => {
    const el = document.querySelector('[data-filter="doc-order"]');
    if (!el) return false;
    el.value = ${JSON.stringify(valor)};
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
  if (!ok) throw new Error('seletor de ordem não encontrado');
  await sleep(600);
}

const iguais = (a, b) => a.length === b.length && a.every((item, i) => item === b[i]);
const resumo = (lista) => lista.slice(0, 3).join(' | ');

/* -------------------------------- roteiro -------------------------------- */

await send('Page.enable');
await send('Runtime.enable');

await goto('#/documentos');
await evalJs(
  `localStorage.setItem('scad:profile', 'usr_diogenes'); localStorage.setItem('scad:activeProcess', ${JSON.stringify(PID)});`
);
await reload();
await goto('#/documentos');

const seletor = await evalJs(`(() => {
  const el = document.querySelector('[data-filter="doc-order"]');
  if (!el) return null;
  return { opcoes: [...el.options].map((o) => o.value), valor: el.value };
})()`);
check(
  'lista traz o seletor de ordem com as quatro opções',
  seletor && iguais(seletor.opcoes, ['default', 'recent', 'stale', 'name']),
  JSON.stringify(seletor)
);

const ordemInicial = await ordemNaTela();
check('ordem padrão mantém a ordem de importação', iguais(ordemInicial, porImportacao), resumo(ordemInicial));

await escolherOrdem('recent');
const recente = await ordemNaTela();
check(
  'ordem "Atividade recente": o documento mexido por último vem primeiro',
  recente[0] === porAtividadeRecente[0],
  `tela: ${recente[0]} · esperado: ${porAtividadeRecente[0]}`
);
check('ordem "Atividade recente": a lista inteira na sequência certa', iguais(recente, porAtividadeRecente), resumo(recente));

const meta = await evalJs(`document.querySelector('#doclist .docrow__meta')?.textContent?.trim() || ''`);
check(
  'linha passa a mostrar a última atividade, não a data de importação',
  /última atividade (há|agora)/i.test(meta) && !/importado/i.test(meta),
  meta
);
await shot('ordem-01-atividade-recente');

await escolherOrdem('stale');
const antiga = await ordemNaTela();
check('ordem "Parado há mais tempo": o mais parado vem primeiro', iguais(antiga, porAtividadeAntiga), resumo(antiga));

await escolherOrdem('name');
const porNomes = await ordemNaTela();
check('ordem "Nome (A–Z)" ordena alfabeticamente', iguais(porNomes, porNome), resumo(porNomes));

// O mesmo critério vale na fila de revisão — é ali que o revisor trabalha.
await evalJs(`document.querySelector('[data-action="filter-docs"][data-filter="review"]')?.click()`);
await sleep(700);
const filtro = await evalJs(`document.querySelector('[data-action="filter-docs"][aria-pressed="true"]')?.dataset.filter || ''`);
const naRevisao = await ordemNaTela();
const nomesOrdenados = [...naRevisao].sort((a, b) => a.localeCompare(b, 'pt-BR', { numeric: true, sensitivity: 'base' }));
if (!naRevisao.length) console.log('  --   fila de revisão vazia neste banco: etapa pulada');
else {
  check(
    'filtro de revisão respeita a ordem alfabética escolhida',
    filtro === 'review' && iguais(naRevisao, nomesOrdenados),
    `${filtro} · ${resumo(naRevisao)}`
  );
}

await reload();
await goto('#/documentos');
const depoisDaRecarga = await evalJs(`(() => ({
  valor: document.querySelector('[data-filter="doc-order"]')?.value || '',
  nomes: [...document.querySelectorAll('#doclist .docrow__name')].map((el) => el.textContent.trim()),
}))()`);
const revisaoAindaAtiva = await evalJs(`document.querySelector('[data-action="filter-docs"][aria-pressed="true"]')?.dataset.filter || ''`);
check(
  'ordem e filtro continuam depois de recarregar a página',
  depoisDaRecarga.valor === 'name' && revisaoAindaAtiva === 'review',
  JSON.stringify({ ordem: depoisDaRecarga.valor, filtro: revisaoAindaAtiva })
);

await evalJs(`document.querySelector('[data-action="filter-docs"][data-filter="all"]')?.click()`);
await sleep(600);
await escolherOrdem('default');
const voltouAoPadrao = await ordemNaTela();
check('voltar para "Padrão" devolve a ordem de importação', iguais(voltouAoPadrao, porImportacao), resumo(voltouAoPadrao));

// O iPad é metade dos acessos: o seletor não pode estourar a largura da lista.
await goto('#/documentos', { width: 390, height: 900 });
const estreito = await evalJs(`(() => {
  const el = document.querySelector('[data-filter="doc-order"]');
  const caixa = el?.getBoundingClientRect();
  return {
    existe: Boolean(el),
    visivel: caixa ? caixa.width > 0 && caixa.height > 0 : false,
    largura: Math.round(caixa?.width || 0),
    estoura: document.documentElement.scrollWidth > window.innerWidth + 1,
  };
})()`);
check(
  'no iPad o seletor de ordem cabe na tela sem estourar a largura',
  estreito.existe && estreito.visivel && !estreito.estoura,
  JSON.stringify(estreito)
);
await shot('ordem-02-ipad');

check('nenhuma exceção de JavaScript', exceptions.length === 0, exceptions.join(' | '));

console.log(failures ? `\n${failures} falha(s)` : '\nTUDO OK');
ws.close();
process.exit(failures ? 1 : 0);
