/** Fluxo completo no navegador: onboarding, importação, verificação e retomada. */
const CDP = 'http://127.0.0.1:9333';
const BASE = process.argv[2] || 'http://127.0.0.1:4177';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const target = await (
  await fetch(`${CDP}/json/new?${encodeURIComponent('about:blank')}`, { method: 'PUT' })
).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
let seq = 0;
const pending = new Map();
const waiters = new Map();
const errors = [];

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
    errors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
  }
  if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
    errors.push(message.params.args.map((a) => a.value ?? a.description).join(' '));
  }
  if (message.method === 'Log.entryAdded' && message.params.entry.level === 'error') {
    errors.push(message.params.entry.text);
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

async function evaluate(expression) {
  const result = await send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
    userGesture: true,
  });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || 'erro');
  return result.result.value;
}

async function go(url) {
  const loaded = waitFor('Page.loadEventFired');
  await send('Page.navigate', { url });
  await loaded;
  await sleep(900);
}

async function apiState() {
  return (await fetch(`${BASE}/api/state`)).json();
}

await send('Page.enable');
await send('Runtime.enable');
await send('Log.enable');
await send('Emulation.setDeviceMetricsOverride', {
  width: 1180,
  height: 820,
  deviceScaleFactor: 1,
  mobile: false,
});

const before = await apiState();
if (before.process) {
  console.log('Servidor já tem processo — reinicie com dados limpos para este teste.');
  process.exit(2);
}

await go(`${BASE}/?flow=1`);
const onboard = await evaluate(`({
  form: !!document.querySelector('#onboard-form'),
  chips: document.querySelectorAll('#criteria-chips .chip').length,
  nav: !!document.querySelector('.nav'),
  title: document.querySelector('.onboard__title')?.textContent.slice(0, 40)
})`);

const created = await evaluate(`(() => {
  document.querySelector('#process-name').value = 'Teste de fluxo';
  document.querySelector('#process-desc').value = 'Processo criado pelo teste automatizado.';
  const input = document.querySelector('#criteria-input');
  input.value = 'Critério extra';
  document.querySelector('[data-action="preset-add"]').click();
  const chips = document.querySelectorAll('#criteria-chips .chip');
  chips[0].querySelector('button')?.click();
  document.querySelector('#onboard-form').requestSubmit();
  return document.querySelectorAll('#criteria-chips .chip').length;
})()`);
await sleep(1600);

const afterCreate = await apiState();
const home = await evaluate(`({
  hash: location.hash,
  nav: document.querySelectorAll('.nav__link').length,
  masthead: document.querySelector('.masthead__title')?.textContent,
  metrics: [...document.querySelectorAll('.metric__value')].map((el) => el.textContent.trim())
})`);

await evaluate(`document.querySelector('.nav__link[href="#/documentos"]').click()`);
await sleep(700);
await evaluate(`document.querySelector('[data-action="open-import"]').click()`);
await sleep(400);
const dialogOpen = await evaluate(`!!document.querySelector('dialog[open] #file-input')`);
await evaluate(`(() => {
  const input = document.querySelector('#file-input');
  const dt = new DataTransfer();
  const pdf = '%PDF-1.4\\n1 0 obj<</Type/Catalog>>endobj\\ntrailer<</Root 1 0 R>>\\n%%EOF';
  dt.items.add(new File([pdf], 'documento-teste.pdf', { type: 'application/pdf' }));
  const png = new Uint8Array([137,80,78,71,13,10,26,10,0,0,0,0]);
  dt.items.add(new File([png], 'imagem-teste.png', { type: 'image/png' }));
  input.files = dt.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
})()`);
await sleep(2600);
const importUi = await evaluate(`({
  states: [...document.querySelectorAll('.import-item__state')].map((el) => el.textContent),
  rows: document.querySelectorAll('.docrow').length,
  toasts: [...document.querySelectorAll('.toast')].map((el) => el.textContent.trim())
})`);
const afterImport = await apiState();
await evaluate(`document.querySelector('[data-done]')?.click()`);
await sleep(300);

await go(`${BASE}/?flow=2#/documentos`);
const detailId = afterImport.documents[0]?.id;
await go(`${BASE}/?flow=3#/documentos/${detailId}`);
const detail = await evaluate(`({
  heading: document.querySelector('.doc-head__title')?.textContent,
  checks: document.querySelectorAll('[data-check-row]').length,
  actions: [...document.querySelectorAll('.page__actions .btn')].map((b) => b.textContent.trim())
})`);

await go(`${BASE}/?flow=4#/analisar/${detailId}`);
const workbench = await evaluate(`({
  heading: document.querySelector('.doc-head__title')?.textContent,
  queue: document.querySelectorAll('.queue__item').length,
  checks: document.querySelectorAll('[data-check-row]').length
})`);

const checkId = await evaluate(`(() => {
  const row = document.querySelector('[data-check-row]');
  row?.querySelector('[data-status="nc"]')?.click();
  return row?.dataset.checkRow || null;
})()`);
await sleep(800);
await evaluate(`(() => {
  const area = document.querySelector('[data-note-id]');
  if (!area) return;
  area.value = 'Faltou assinatura na última página.';
  area.dispatchEvent(new Event('input', { bubbles: true }));
})()`);
await sleep(1200);
const afterCheck = await apiState();
const check = afterCheck.checks.find((c) => c.id === checkId);
const findingsUi = await evaluate(`(() => {
  document.querySelector('.nav__link[href="#/apontamentos"]').click();
  return location.hash;
})()`);
await sleep(900);
const findingRows = await evaluate(
  `({ hash: location.hash, rows: document.querySelectorAll('.finding').length, note: document.querySelector('.finding__note')?.textContent })`
);

const persisted = check?.status === 'nc' && check?.note?.includes('assinatura');

console.log(
  JSON.stringify(
    {
      onboard,
      createdChips: created,
      criteriaCount: afterCreate.criteria.length,
      home,
      dialogOpen,
      importUi,
      importedDocs: afterImport.documents.length,
      checksPerDoc: afterImport.checks.length / Math.max(1, afterImport.documents.length),
      detail,
      workbench,
      findingRows,
      persisted,
      errors,
    },
    null,
    2
  )
);

const failures = [];
if (!onboard.form) failures.push('onboarding não renderizou');
if (onboard.chips !== 4) failures.push('chips iniciais != 4');
if (onboard.nav) failures.push('nav visível no onboarding');
if (afterCreate.criteria.length !== 4) failures.push('critérios criados != 4');
if (home.hash !== '#/' || home.nav !== 5) failures.push('pós-criação não caiu no painel com 5 abas');
if (!dialogOpen) failures.push('diálogo de importação não abriu');
if (afterImport.documents.length !== 2) failures.push('documentos importados != 2');
if (afterImport.checks.length !== 8) failures.push('verificações esperadas != 8');
if (detail.checks !== 4) failures.push('detalhe com verificações != 4');
if (!persisted) failures.push('resultado/nota não persistiu');
if (findingRows.rows !== 1) failures.push('apontamento não apareceu');
if (errors.length) failures.push(`erros de console: ${errors.join(' | ')}`);

if (failures.length) {
  console.error('\nFALHAS:\n - ' + failures.join('\n - '));
  process.exit(1);
}
console.log('\nFluxo completo ok.');
await fetch(`${BASE}/api/reset`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ confirm: true }),
});
console.log('Dados de teste removidos.');
ws.close();
