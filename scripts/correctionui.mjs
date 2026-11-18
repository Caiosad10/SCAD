/**
 * Testa a interface da correção/versões/reabertura via CDP (Edge headless).
 * Uso: node scripts/correctionui.mjs [porta] [docId]
 * Precisa de um CDP em CDP (padrão http://127.0.0.1:9333) e grava em shots/.
 */
import fs from 'node:fs/promises';

const CDP = process.env.CDP || 'http://127.0.0.1:9333';
const PORT = process.argv[2] || '4188';
const BASE = `http://127.0.0.1:${PORT}`;
const DOC = process.argv[3] || 'doc_166e6e87fa';
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
  await sleep(1600);
}

async function reload(width = 1440, height = 1000) {
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  const loaded = waitFor('Page.loadEventFired');
  await send('Page.reload');
  await Promise.race([loaded, sleep(2500)]);
  await sleep(1600);
}

async function shot(name) {
  const png = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  await fs.writeFile(`${OUT}/${name}.png`, Buffer.from(png.data, 'base64'));
  console.log(`  shot ${OUT}/${name}.png`);
}

async function setProfile(id) {
  await evalJs(`localStorage.setItem('scad:profile', ${JSON.stringify(id)})`);
}

async function click(selector) {
  const ok = await evalJs(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; el.click(); return true; })()`);
  if (!ok) throw new Error(`elemento não encontrado: ${selector}`);
  await sleep(700);
}

/** Clica dentro da gaveta que está aberta agora (ignora gavetas antigas no DOM). */
async function clickNoDialog(selector) {
  const ok = await evalJs(`(() => { const root = [...document.querySelectorAll('dialog[open]')].pop(); const el = root?.querySelector(${JSON.stringify(selector)}); if (!el) return false; el.click(); return true; })()`);
  if (!ok) throw new Error(`elemento não encontrado na gaveta: ${selector}`);
  await sleep(500);
}

/** Fecha qualquer gaveta que tenha ficado aberta (troca de tela entre passos). */
async function closeAllDialogs() {
  await evalJs(`document.querySelectorAll('dialog[open]').forEach((dialog) => dialog.close())`);
  await sleep(600);
}

/** Espera sobrar uma única gaveta aberta (a que o teste quer examinar). */
async function waitOneDialog() {
  for (let i = 0; i < 40; i += 1) {
    if ((await evalJs('document.querySelectorAll("dialog[open]").length')) === 1) return true;
    await sleep(150);
  }
  return false;
}

await send('Page.enable');
await send('Runtime.enable');
await send('Network.setCacheDisabled', { cacheDisabled: true });
await fs.mkdir(OUT, { recursive: true });

/* estado de referência: quantas versões o documento já tem */
const refState = await (
  await fetch(`${BASE}/api/state?processId=prc_3c8d4787da`, { headers: { 'X-SCAD-Actor': 'usr_sergio' } })
).json();
const refDoc = (refState.documents || []).find((doc) => doc.id === DOC);
const archived = (refDoc?.versions || []).length;
const correctionV = 2 + archived;
const totalV = 1 + archived;
if (!refDoc?.correction) {
  console.error('prepare uma correção pendente antes de rodar o teste de UI.');
  process.exit(2);
}

/* ------------------------------------------------------------- 1. lista */
await goto('#/documentos');
await setProfile('usr_sergio');
await reload();
const listText = await evalJs('document.body.innerText');
const rowInfo = await evalJs(`(() => {
  const row = document.querySelector('[data-doc-id="${DOC}"]');
  return row ? { stamp: row.querySelector('.docrow__stamp')?.innerText || '', meta: row.querySelector('.docrow__meta')?.innerText || '' } : null;
})()`);
check(
  `lista marca o documento como corrigido (v${correctionV})`,
  (rowInfo?.stamp || '').toLowerCase().includes(`corrigido · v${correctionV}`),
  JSON.stringify(rowInfo)
);
check('lista continua numerando os documentos', /\d+ DE \d+/.test(listText), listText.slice(0, 120));
await shot('correcao-01-documentos');

/* ------------------------------------------------- 2. documento (analista) */
await goto(`#/documentos/${DOC}`);
const docText = await evalJs('document.body.innerText');
check('documento mostra a faixa de correção', await evalJs('Boolean(document.querySelector(".doc-correction-banner"))'));
check('documento mostra "Visualizar correção"', docText.includes('Visualizar correção'));
check(
  'documento oferece o histórico de versões',
  archived === 0 || (await evalJs('Boolean(document.querySelector("[data-action=\\"versions-open\\"]"))'))
);
await shot('correcao-02-documento');

/* --------------------------------------------------- 3. comparação larga */
await click('[data-action="correction-open"]');
await waitOneDialog();
const compare = await evalJs(`(() => {
  const c = document.querySelector('.compare');
  if (!c) return null;
  return {
    panes: [...c.querySelectorAll('[data-compare-pane]')].map((el) => el.dataset.comparePane),
    criteria: c.querySelectorAll('.compare__criterion').length,
    view: c.dataset.view,
    approve: Boolean(c.closest('dialog').querySelector('[data-compare-approve]')),
    remove: Boolean(c.closest('dialog').querySelector('[data-compare-remove]')),
    cols: getComputedStyle(c.querySelector('.compare__grid')).gridTemplateColumns,
  };
})()`);
check('comparação abre com os três painéis', JSON.stringify(compare?.panes) === '["original","corrected","criteria"]', JSON.stringify(compare));
check('painel de critérios lista as verificações', (compare?.criteria || 0) > 0, String(compare?.criteria));
check('analista não vê "Aprovar documento"', compare?.approve === false);
check('autor vê "Remover correção"', compare?.remove === true);
check('largura usa as três colunas', (compare?.cols || '').split(' ').length === 3, compare?.cols);
let avisoPdf = '';
for (let i = 0; i < 24; i += 1) {
  avisoPdf = await evalJs(
    `(() => { const d = [...document.querySelectorAll('dialog[open]')].pop(); return d?.querySelector('[data-diff-summary]')?.textContent?.trim() || ''; })()`
  );
  if (avisoPdf && !/comparando/i.test(avisoPdf)) break;
  await sleep(250);
}
const painelPdf = await evalJs(`(() => {
  const d = [...document.querySelectorAll('dialog[open]')].pop();
  const secao = d?.querySelector('[data-compare-diff]');
  const corpo = d?.querySelector('[data-diff-host]');
  return {
    aberto: corpo ? !corpo.hidden : null,
    dataOpen: secao?.getAttribute('data-open'),
    expandido: d?.querySelector('[data-compare-diff-toggle]')?.getAttribute('aria-expanded'),
  };
})()`);
check('PDF digitalizado avisa que não há texto para comparar', /sem texto para comparar/i.test(avisoPdf), avisoPdf);
check(
  'PDF digitalizado: painel "O que mudou" começa fechado',
  painelPdf?.aberto === false && painelPdf?.dataOpen === 'false' && painelPdf?.expandido === 'false',
  JSON.stringify(painelPdf)
);
await clickNoDialog('[data-compare-diff-toggle]');
const corpoPdf = await evalJs(
  `(() => { const d = [...document.querySelectorAll('dialog[open]')].pop(); return d?.querySelector('[data-diff-host]')?.innerText || ''; })()`
);
check(
  'sem diff, o painel guia pela comparação lado a lado',
  (corpoPdf || '').toLowerCase().includes('comparação ao lado'),
  corpoPdf.slice(0, 120)
);
check(
  'sem diff, o painel mostra o espaço do relato de quem corrigiu',
  await evalJs(
    `Boolean([...document.querySelectorAll('dialog[open]')].pop()?.querySelector('[data-diff-host] .changenote'))`
  )
);
await clickNoDialog('[data-compare-diff-toggle]');
await sleep(1200);
await shot('correcao-03-comparacao');

/* -------------------------------------------------- 4. comparação estreita */
await send('Emulation.setDeviceMetricsOverride', { width: 820, height: 1000, deviceScaleFactor: 1, mobile: false });
await sleep(500);
await click('[data-compare-view="criteria"]');
const narrow = await evalJs(`(() => {
  const c = document.querySelector('.compare');
  const pane = c.querySelector('[data-compare-pane="original"]');
  return {
    cols: getComputedStyle(c.querySelector('.compare__grid')).gridTemplateColumns,
    switchVisible: getComputedStyle(c.querySelector('.compare__switch')).display !== 'none',
    originalHidden: getComputedStyle(pane).display === 'none',
    view: c.dataset.view,
  };
})()`);
check('estreito: uma coluna e abas visíveis', narrow?.switchVisible === true && !narrow?.cols.includes(' '), JSON.stringify(narrow));
check('estreito: "Critérios" alterna o painel', narrow?.originalHidden === true && narrow?.view === 'criteria', JSON.stringify(narrow));
await shot('correcao-04-comparacao-criterios');
await click('dialog [data-close]');

/* ------------------------------------- 4b. "O que mudou" com um par de .docx */
const wordDoc = (refState.documents || []).find((item) => item.correction && /\.docx$/i.test(item.name));
if (wordDoc) {
  await closeAllDialogs();
  await goto(`#/documentos/${wordDoc.id}`);
  await click('[data-action="correction-open"]');
  check('só a comparação fica aberta', await waitOneDialog());
  let resumo = '';
  for (let i = 0; i < 60; i += 1) {
    resumo = await evalJs(
      `(() => { const d = [...document.querySelectorAll('dialog[open]')].pop(); return d?.querySelector('[data-diff-summary]')?.textContent?.trim() || ''; })()`
    );
    if (resumo && !/comparando/i.test(resumo)) break;
    await sleep(300);
  }
  check('painel "O que mudou" mede os trechos alterados', /4 trechos alterados/.test(resumo), resumo);
  check(
    'resumo separa adições, remoções e alterações',
    /2 adições/.test(resumo) && /2 alterações/.test(resumo) && !/remoç/.test(resumo),
    resumo
  );
  const estadoPainel = () =>
    evalJs(`(() => {
      const root = [...document.querySelectorAll('dialog[open]')].pop();
      if (!root) return null;
      const secao = root.querySelector('[data-compare-diff]');
      const corpo = root.querySelector('[data-diff-host]');
      const botao = root.querySelector('[data-compare-diff-toggle]');
      return {
        secao: Boolean(secao),
        open: secao?.getAttribute('data-open'),
        expandido: botao?.getAttribute('aria-expanded'),
        aberto: corpo ? !corpo.hidden : null,
      };
    })()`);
  const fechado = await estadoPainel();
  check(
    'painel "O que mudou" começa fechado, só com o resumo',
    fechado?.aberto === false && fechado?.open === 'false' && fechado?.expandido === 'false',
    JSON.stringify(fechado)
  );
  await sleep(200);
  await shot('correcao-12-diff-fechado');
  await clickNoDialog('[data-compare-diff-toggle]');
  const aberto = await estadoPainel();
  check('cabeçalho abre o painel quando o revisor pede', aberto?.aberto === true && aberto?.expandido === 'true', JSON.stringify(aberto));
  await sleep(300);
  const painel = await evalJs(`(() => {
    const root = [...document.querySelectorAll('dialog[open]')].pop();
    if (!root) return null;
    const linhas = (seletor) => [...root.querySelectorAll(seletor)].map((el) => el.textContent.trim());
    return {
      fonte: root.querySelectorAll('.diff__fonte').length,
      nota: root.querySelector('.diff__note')?.textContent?.trim() || '',
      ctx: [...root.querySelectorAll('.diff__ctx')].map((el) => el.textContent.trim()),
      itens: root.querySelectorAll('.diff__item').length,
      ins: linhas('.diff__line--add ins'),
      del: linhas('.diff__line--del del'),
      novas: [...root.querySelectorAll('.diff__line--add')].map((el) => el.innerText.replace(/^\\+?\\s*/, '').trim()),
    };
  })()`);
  check(
    'rodapé avisa que os trechos são texto do arquivo, não do sistema',
    /texto dos dois arquivos/i.test(painel?.nota || '') && /não informação do sistema/i.test(painel?.nota || ''),
    JSON.stringify(painel?.nota)
  );
  check('estilo original do painel mantido (sem caixa de aviso)', painel?.fonte === 0, JSON.stringify(painel?.fonte));
  check(
    'trechos agrupados pela âncora do documento',
    (painel?.ctx || []).some((item) => /2\. Responsabilidades/.test(item)),
    JSON.stringify(painel?.ctx)
  );
  check('palavras acrescentadas ficam destacadas', (painel?.ins || []).some((item) => /certificado de qualidade/.test(item)), JSON.stringify(painel?.ins));
  check('parágrafo novo aparece inteiro', (painel?.novas || []).some((item) => /Anexar o certificado de qualidade/.test(item)), JSON.stringify(painel?.novas));
  check(
    'prazo trocado mostra as palavras que saíram',
    /três\s+dias\s+uteis/.test((painel?.del || []).join(' ').replace(/\s+/g, ' ')),
    JSON.stringify(painel?.del)
  );
  await sleep(400);
  await shot('correcao-11-diff');
  await clickNoDialog('[data-compare-diff-toggle]');
  const recolhido = await estadoPainel();
  await clickNoDialog('[data-compare-diff-toggle]');
  const reaberto = await estadoPainel();
  check(
    'cabeçalho recolhe e reabre o painel',
    recolhido?.aberto === false && reaberto?.aberto === true,
    JSON.stringify({ recolhido: recolhido?.aberto, reaberto: reaberto?.aberto })
  );
  await closeAllDialogs();
  await goto(`#/documentos/${DOC}`);
} else {
  console.log('  --   (sem .docx com correção pendente; painel "O que mudou" pulado)');
}

/* ------------------------------------------------------------ 5. versões */
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
await sleep(300);
if (archived > 0) {
  await click('[data-action="versions-open"]');
  const versions = await evalJs(`(() => {
    const rows = [...document.querySelectorAll('dialog .version-row')];
    return { total: rows.length, current: document.querySelector('dialog .version-row--current')?.innerText || '', text: document.querySelector('dialog')?.innerText || '' };
  })()`);
  check(`histórico lista ${archived} arquivada(s) + atual`, versions?.total === totalV, JSON.stringify({ total: versions?.total }));
  check('linha atual marcada como vigente', (versions?.current || '').toLowerCase().includes('vigente'), versions?.current);
  await shot('correcao-05-versoes');
  await click('dialog [data-close]');
  check('gaveta de versões fecha ao clicar em Fechar', (await evalJs('document.querySelectorAll("dialog[open]").length')) === 0);
} else {
  console.log('  --   (sem versões arquivadas; histórico pulado)');
}

/* --------------------------------------- 6. analista abre "Adicionar correção" */
const state = await (
  await fetch(`${BASE}/api/state?processId=prc_3c8d4787da`, { headers: { 'X-SCAD-Actor': 'usr_sergio' } })
).json();
const other = (state.documents || []).find(
  (doc) => doc.itemKind !== 'item' && !doc.correction && doc.review?.status === 'approved' && doc.id !== DOC
);
if (other) {
  await closeAllDialogs();
  await goto(`#/documentos/${other.id}`);
  check(
    'documento aprovado oferece "Adicionar correção"',
    (await evalJs('document.body.innerText')).includes('Adicionar correção')
  );
  await click('[data-action="correction-add"]');
  const addSheet = await evalJs(`(() => {
    const d = [...document.querySelectorAll('dialog[open]')].pop();
    return d ? { title: d.querySelector('.sheet__title')?.textContent || '', open: document.querySelectorAll('dialog[open]').length, dropzone: Boolean(d.querySelector('#correction-dropzone')), disabled: d.querySelector('[data-confirm]')?.disabled } : null;
  })()`);
  check('gaveta de correção com dropzone e envio bloqueado', addSheet?.dropzone === true && addSheet?.disabled === true && addSheet?.open === 1, JSON.stringify(addSheet));
  await shot('correcao-06-adicionar');
  await click('dialog [data-cancel]');
} else {
  console.log('  --   (sem outro documento aprovado; teste da gaveta pulado)');
}

/* ------------------------------------- 7. revisor aprova e reabre (mesmo doc) */
await closeAllDialogs();
await goto(`#/documentos/${DOC}`);
await setProfile('usr_diogenes');
await reload();
check('revisor vê "Aprovar documento"', (await evalJs('document.body.innerText')).includes('Aprovar documento'));
await click('[data-action="correction-open"]');
check(
  'revisor vê "Aprovar documento" na comparação',
  await evalJs('Boolean(document.querySelector("dialog [data-compare-approve]"))')
);
check('revisor não vê "Remover correção"', (await evalJs('Boolean(document.querySelector("dialog [data-compare-remove]"))')) === false);
await shot('correcao-07-comparacao-revisor');
await click('dialog [data-compare-approve]');
await click('dialog [data-confirm]');
await sleep(1200);
const afterApprove = await evalJs(`(() => ({
  toast: document.querySelector('#toasts')?.innerText || '',
  banner: Boolean(document.querySelector('.doc-correction-banner')),
  text: document.body.innerText,
}))()`);
check('aprovação pela comparação conclui', afterApprove?.toast.includes('aprovado'), afterApprove?.toast);
check('faixa da correção some após aprovar', afterApprove?.banner === false);
check('documento mostra a versão aprovada', afterApprove?.text.toLowerCase().includes('aprovado'), afterApprove?.text.slice(0, 200));

await click('[data-action="review-reopen"]');
await evalJs(`(() => { const a = document.querySelector('#reopen-reason'); a.value = 'Auditoria interna apontou divergência na cláusula 4.2.'; a.dispatchEvent(new Event('input', { bubbles: true })); })()`);
await sleep(200);
await shot('correcao-08-reabrir');
await click('dialog [data-confirm]');
await sleep(1200);
const afterReopen = await evalJs(`(() => ({
  toast: document.querySelector('#toasts')?.innerText || '',
  banner: Boolean(document.querySelector('.doc-reopen-banner')),
  text: document.body.innerText,
}))()`);
check('reabertura conclui com aviso', afterReopen?.toast.includes('Revisão reaberta'), afterReopen?.toast);
check('documento mostra a faixa de reabertura', afterReopen?.banner === true);
check('selo vira "Reaberta"', afterReopen?.text.toLowerCase().includes('reaberta'), afterReopen?.text.slice(0, 300));
await shot('correcao-09-reaberto');

/* ------------------------------------------------------- 8. bancada e exceções */
await goto(`#/analisar/${DOC}`);
const bench = await evalJs('document.body.innerText');
check('bancada mostra a correção enviada', bench.includes('Correção enviada') || bench.includes('Análise concluída'), bench.slice(0, 300));
await shot('correcao-10-bancada');

check('nenhuma exceção de JavaScript', exceptions.length === 0, exceptions.slice(0, 3).join(' | '));

console.log(`\n${failures === 0 ? 'TUDO OK' : `${failures} FALHA(S)`}`);
ws.close();
process.exit(failures === 0 ? 0 : 1);
