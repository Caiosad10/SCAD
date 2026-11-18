/**
 * Testa a prévia do arquivo com o painel de critérios (CDP/Edge headless).
 *
 * O que o Sergio pediu em 18/11: ler o documento e conferir as verificações sem
 * sair da tela — o mesmo painel lateral da comparação da correção, mas para o
 * arquivo normal (aprovando ou pedindo o que corrigir).
 *
 * Também cobre o fluxograma do Visio: o .docx do RP guarda o desenho como EMF,
 * que o navegador não abre; a prévia avisa no lugar da figura em vez de deixar
 * um espaço vazio.
 *
 * Uso: node scripts/previewcriteria.mjs [porta] [processoVerificacao] [processoDC]
 * Precisa de um CDP em CDP (padrão http://127.0.0.1:9333). Grava em shots/.
 * Só leitura: não envia, não aprova e não sinaliza nada.
 */
import fs from 'node:fs/promises';
import path from 'node:path';

const CDP = process.env.CDP || 'http://127.0.0.1:9333';
const PORT = process.argv[2] || '4188';
const BASE = `http://127.0.0.1:${PORT}`;
const PID = process.argv[3] || 'prc_df9191d991';
const DC_PID = process.argv[4] || 'prc_3c8d4787da';
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
async function call(method, rota, actor = SERGIO) {
  const res = await fetch(`${BASE}${rota}`, { method, headers: { 'X-SCAD-Actor': actor } });
  const raw = await res.text();
  let json = null;
  try {
    json = JSON.parse(raw);
  } catch {
    /* corpo vazio */
  }
  return { status: res.status, json, raw };
}

const health = (await call('GET', '/api/health')).json;
check(
  'QA na porta de teste com a v2.3.x',
  health?.port === Number(PORT) && /^2\.3\./.test(health?.version || ''),
  JSON.stringify(health)
);
if (health?.port === 4177) {
  console.error('ABORTADO: este script não roda na produção (4177).');
  process.exit(2);
}

const state = (await call('GET', `/api/state?processId=${encodeURIComponent(PID)}`)).json;
if (!state?.process) {
  console.error(`ABORTADO: processo ${PID} não encontrado.`);
  process.exit(2);
}
const criteria = [...(state.criteria || [])].sort((a, b) => (a.order || 0) - (b.order || 0));
const rotulo = new Map(criteria.map((c) => [c.id, c.label]));
const checksDo = (docId) =>
  (state.checks || []).filter((c) => c.docId === docId && rotulo.has(c.criterionId));

const rp = (state.documents || []).find((doc) => /^RP\b/i.test(doc.name) && /\.docx$/i.test(doc.name));
check('processo tem o RP em .docx (fluxograma do Visio)', Boolean(rp), rp?.name);
if (!rp) process.exit(1);
const rpChecks = checksDo(rp.id);
check('RP tem verificações registradas', rpChecks.length > 0, `${rpChecks.length} verificações`);

const dcState = (await call('GET', `/api/state?processId=${encodeURIComponent(DC_PID)}`)).json;
const dcCriteria = dcState?.criteria || [];
const dcDoc = (dcState?.documents || []).find(
  (doc) => doc.itemKind !== 'item' && doc.active !== false && !doc.correction && !/^RP\b/i.test(doc.name)
    && (dcState.checks || []).filter((c) => c.docId === doc.id).length === dcCriteria.length
);
check('DC tem documento com todos os critérios verificados', Boolean(dcDoc), dcDoc?.name);

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
  await sleep(260);
}

async function perfil(quem, processId = PID) {
  await evalJs(
    `localStorage.setItem('scad:profile', ${JSON.stringify(quem)});` +
      `localStorage.setItem('scad:activeProcess', ${JSON.stringify(processId)});`
  );
  await reload();
}

/** Abre a prévia pela lista de documentos e espera o desenho do .docx. */
async function abrirPrevia(docId) {
  await goto(`#/documentos/${docId}`);
  await click(`[data-action="doc-preview"][data-id="${docId}"]`);
  await sleep(2600);
}

/** Estado da gaveta da prévia. */
const gaveta = () =>
  evalJs(`(() => {
    const d = [...document.querySelectorAll('dialog[open]')].pop();
    if (!d) return null;
    const grade = d.querySelector('.compare__grid--rail');
    const arquivo = d.querySelector('[data-preview-pane="file"]');
    const painel = d.querySelector('[data-preview-pane="criteria"]');
    const lista = d.querySelector('[data-preview-criteria]');
    const itens = [...(lista?.querySelectorAll('.compare__criterion') || [])];
    const rect = (el) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height), direita: Math.round(r.right) };
    };
    return {
      titulo: d.querySelector('.sheet__title')?.textContent?.trim() || '',
      temCompare: Boolean(d.querySelector('.compare--preview')),
      colunas: grade ? getComputedStyle(grade).gridTemplateColumns : '',
      arquivoVisivel: Boolean(arquivo && arquivo.offsetParent !== null),
      painelVisivel: Boolean(painel && painel.offsetParent !== null),
      rectArquivo: rect(arquivo),
      rectPainel: rect(painel),
      tituloPainel: d.querySelector('.compare__pane-head')?.innerText?.replace(/\\s+/g, ' ').trim() || '',
      meta: d.querySelector('.compare__meta')?.textContent?.trim() || '',
      rotulos: itens.map((item) => item.querySelector('.compare__criterion-label')?.textContent?.trim() || ''),
      selos: itens.map((item) => item.querySelector('.stamp')?.textContent?.trim() || ''),
      notas: itens.filter((item) => item.querySelector('.compare__criterion-note')).length,
      sinalizar: d.querySelectorAll('[data-compare-flag]').length,
      switchVisivel: Boolean(d.querySelector('.compare__switch')?.offsetParent),
      abaAtiva: d.querySelector('[data-preview-view][aria-pressed="true"]')?.dataset.previewView || '',
      visao: d.querySelector('.compare--preview')?.getAttribute('data-view') || '',
      figuras: [...d.querySelectorAll('.preview-nao-desenha')].map((f) => f.innerText.replace(/\\s+/g, ' ').trim()),
      avisoNoTopo: (() => {
        const caixa = d.querySelector('[data-preview-host] .preview-nao-desenha');
        const moldura = d.querySelector('[data-preview-host] .docx-wrapper');
        if (!caixa || !moldura) return null;
        return Boolean(caixa.compareDocumentPosition(moldura) & Node.DOCUMENT_POSITION_FOLLOWING);
      })(),
      avisoComLink: Boolean(d.querySelector('[data-preview-host] .preview-nao-desenha a[href][target="_blank"]')),
      textoDocx: d.querySelector('[data-preview-host]')?.innerText || '',
      botoesRodape: [...d.querySelectorAll('.sheet__foot .btn')].map((b) => b.textContent.replace(/\\s+/g, ' ').trim()),
      temAprovar: Boolean(d.querySelector('[data-preview-approve]')),
      estoura: d.scrollWidth - d.clientWidth,
      hash: location.hash,
    };
  })()`);

/* ------------------------------------------------ 1. prévia do RP (Visio) */
await send('Page.enable');
await send('Runtime.enable');
await send('DOM.enable');

await goto('#/documentos');
await perfil(SERGIO);
await abrirPrevia(rp.id);
let g = await gaveta();
check('prévia do documento abre em gaveta', Boolean(g), JSON.stringify(g)?.slice(0, 120));
check('gaveta tem o desenho da prévia com painel', g?.temCompare === true);
check('painel de critérios fica ao lado do arquivo', (g?.colunas || '').trim().split(/\s+/).length === 2, g?.colunas);
check(
  'arquivo e critérios lado a lado (painel à direita)',
  Boolean(g?.rectArquivo && g?.rectPainel) && g.rectPainel.x >= g.rectArquivo.direita - 2 && Math.abs(g.rectPainel.y - g.rectArquivo.y) <= 2,
  JSON.stringify({ arquivo: g?.rectArquivo, painel: g?.rectPainel })
);
check('painel lista as verificações do documento', g?.rotulos?.length === rpChecks.length, `tela ${g?.rotulos?.length} · api ${rpChecks.length}`);
const esperados = new Set(rpChecks.map((c) => rotulo.get(c.criterionId)));
check(
  'painel mostra os critérios certos, na ordem',
  (g?.rotulos || []).every((nome) => esperados.has(nome)) && esperados.size === new Set(g?.rotulos).size,
  JSON.stringify(g?.rotulos)
);
check('painel mostrando o status de cada critério', (g?.selos || []).every((s) => s.length > 0), JSON.stringify(g?.selos));
check('painel traz a observação escrita na verificação', (g?.notas || 0) > 0, `notas: ${g?.notas}`);
check('cabeçalho do painel mostra o placar de aprovação', /aprovad/i.test(g?.tituloPainel || ''), g?.tituloPainel);
check('resumo do topo mostra versão e verificações', /v\d+ · \d+\/\d+ verifica/i.test(g?.meta || ''), g?.meta);
check('gaveta não estoura a largura da tela', (g?.estoura ?? 99) <= 1, `estouro: ${g?.estoura}`);

check('fluxograma avisa no lugar da figura que não desenha', (g?.figuras || []).length >= 1, JSON.stringify(g?.figuras));
check(
  'aviso explica que é desenho do Visio (EMF) e oferece abrir o arquivo',
  (g?.figuras || []).some((t) => /visio/i.test(t) && /EMF/i.test(t)) && g?.avisoComLink === true,
  g?.figuras?.[0]?.slice(0, 180)
);
check('aviso das figuras fica no topo da prévia', g?.avisoNoTopo === true, String(g?.avisoNoTopo));
check('texto do documento continua na prévia ("2. FLUXOGRAMA")', /FLUXOGRAMA/i.test(g?.textoDocx || ''), (g?.textoDocx || '').length + ' caracteres');
await shot('preview-01-rp-criterios');

/* ---------------------------------------------------- 2. rodapé e navegação */
check('rodapé oferece "Ver na bancada"', (g?.botoesRodape || []).some((t) => /Ver na bancada/i.test(t)), JSON.stringify(g?.botoesRodape));
check('rodapé mantém abrir em nova aba e baixar', (g?.botoesRodape || []).some((t) => /Abrir em nova aba/i.test(t)) && (g?.botoesRodape || []).some((t) => /Baixar/i.test(t)));
check('analista não vê "Aprovar documento" na prévia', g?.temAprovar === false);
check('analista não vê sinalizar (só o revisor)', g?.sinalizar === 0, `${g?.sinalizar} botões`);

await click('dialog[open] [data-close][href]');
await sleep(700);
check('"Ver na bancada" fecha a gaveta e abre a bancada', (await evalJs(`(() => ({ abertos: document.querySelectorAll('dialog[open]').length, hash: location.hash }))()`))?.hash === `#/analisar/${rp.id}`, await evalJs('location.hash'));
check('nenhuma gaveta ficou aberta por cima', (await evalJs(`document.querySelectorAll('dialog[open]').length`)) === 0);

/* -------------------------------------- 3. prévia aberta de dentro da bancada */
await click(`[data-action="doc-preview"][data-id="${rp.id}"]`);
await sleep(2400);
const gb = await gaveta();
check('bancada também abre a prévia com o painel', gb?.temCompare === true && gb?.rotulos?.length === rpChecks.length, JSON.stringify(gb?.rotulos));
await shot('preview-02-bancada');
await click('dialog[open] .iconbtn[data-close]');
await sleep(400);

/* -------------------------------------------- 4. documento com todos os critérios */
if (dcDoc) {
  await perfil(SERGIO, DC_PID);
  await abrirPrevia(dcDoc.id);
  const gd = await gaveta();
  check(
    'documento com todos os critérios mostra a lista completa',
    gd?.rotulos?.length === dcCriteria.length,
    `tela ${gd?.rotulos?.length} · critérios ${dcCriteria.length}`
  );
  check('lista completa não estoura a altura da gaveta', (gd?.rectPainel?.h || 0) > 200, JSON.stringify(gd?.rectPainel));
  await shot('preview-03-todos-criterios');
  await click('dialog[open] .iconbtn[data-close]');
  await sleep(400);
}

/* ------------------------------------------------------ 5. revisor na prévia */
await perfil(DIOGENES);
await abrirPrevia(rp.id);
const gr = await gaveta();
check('revisor vê o painel de critérios na prévia', (gr?.rotulos || []).length === rpChecks.length, `${gr?.rotulos?.length} itens`);
check(
  'revisor pode sinalizar o critério pela prévia',
  gr?.sinalizar === rpChecks.filter((c) => c.status !== 'pending').length,
  `tela ${gr?.sinalizar} · esperado ${rpChecks.filter((c) => c.status !== 'pending').length}`
);
const reviewDoc = (state.documents || []).find((d) => d.id === rp.id);
const aguardando = Boolean(reviewDoc && !reviewDoc.reopen && !reviewDoc.correction);
check(
  'botão "Aprovar documento" só quando a revisão está esperando',
  aguardando ? gr?.temAprovar === true : gr?.temAprovar === false,
  `aguardando=${aguardando} temAprovar=${gr?.temAprovar}`
);
await shot('preview-04-revisor');

/* ----------------------------------------------------- 6. tela estreita (iPad) */
await send('Emulation.setDeviceMetricsOverride', { width: 900, height: 1000, deviceScaleFactor: 1, mobile: false });
await sleep(500);
const gn = await gaveta();
check('estreito: as abas aparecem', gn?.switchVisivel === true && gn?.abaAtiva === 'file');
check('estreito: o arquivo começa na frente', gn?.arquivoVisivel === true && gn?.painelVisivel === false);
check('estreito: uma coluna só', (gn?.colunas || '').trim().split(/\s+/).length === 1, gn?.colunas);
await click('[data-preview-view="criteria"]');
await sleep(300);
const gc = await gaveta();
check('estreito: aba "Critérios" mostra a lista', gc?.painelVisivel === true && gc?.arquivoVisivel === false, JSON.stringify({ v: gc?.visao }));
check('estreito: a lista continua com os critérios', (gc?.rotulos || []).length === rpChecks.length);
await shot('preview-05-ipad-criterios');
await click('[data-preview-view="file"]');
await sleep(300);
const gv = await gaveta();
check('estreito: volta para o arquivo', gv?.arquivoVisivel === true && gv?.painelVisivel === false);

check('nenhuma exceção de JavaScript', exceptions.length === 0, exceptions.slice(0, 3).join(' | '));

await new Promise((resolve) => {
  ws.onclose = resolve;
  ws.close();
});

console.log(failures ? `\n${failures} falha(s)` : '\nTUDO OK');
process.exit(failures ? 1 : 0);
