/** Verificações extras: critérios pela UI, edição de apontamento, CSV e sincronização. */
import fs from 'node:fs/promises';
import path from 'node:path';

const CDP = 'http://127.0.0.1:9333';
const BASE = process.argv[2] || 'http://127.0.0.1:4188';
const DOWNLOADS = path.join(process.cwd(), 'shots', 'downloads');
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
async function go(hash) {
  const loaded = waitFor('Page.loadEventFired');
  await send('Page.navigate', { url: `${BASE}/?x=${seq}${hash}` });
  await loaded;
  await sleep(1100);
}
async function apiState() {
  return (await fetch(`${BASE}/api/state`)).json();
}

await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1180, height: 820, deviceScaleFactor: 1, mobile: false });
await fs.mkdir(DOWNLOADS, { recursive: true });

const results = [];

/* critérios pela UI */
await go('#/ajustes');
const before = await apiState();
await evaluate(`(() => {
  const input = document.querySelector('#criterion-label');
  input.value = 'Critério temporário';
  document.querySelector('#criterion-form').requestSubmit();
})()`);
await sleep(900);
const afterAdd = await apiState();
await evaluate(`document.querySelector('[data-action="criterion-delete"]')?.click()`);
await sleep(350);
await evaluate(`document.querySelector('dialog[open] [data-confirm]')?.click()`);
await sleep(900);
const afterDel = await apiState();
results.push(['adicionar critério pela UI', afterAdd.criteria.length === before.criteria.length + 1]);
results.push([
  'novo critério gera verificações',
  afterAdd.checks.length === before.checks.length + before.documents.length,
]);
results.push(['excluir critério restaura a contagem', afterDel.checks.length === before.checks.length]);

/* apontamento: editar nota */
await go('#/apontamentos');
await evaluate(`document.querySelector('[data-action="finding-edit"]')?.click()`);
await sleep(300);
const edited = await evaluate(`(() => {
  const area = document.querySelector('dialog[open] #finding-note');
  if (!area) return null;
  const id = [...document.querySelectorAll('.finding__actions [data-check-id]')][0]?.dataset.checkId;
  area.value = area.value + ' [revisado]';
  document.querySelector('dialog[open] [data-save]')?.click();
  return id;
})()`);
await sleep(900);
const afterEdit = await apiState();
results.push([
  'editar nota do apontamento',
  Boolean(edited) && (afterEdit.checks.find((c) => c.id === edited)?.note || '').includes('[revisado]'),
]);

/* CSV */
await send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: DOWNLOADS });
await go('#/apontamentos');
await evaluate(`document.querySelector('[data-action="export-csv"]')?.click()`);
await sleep(1600);
let csv = null;
try {
  const files = (await fs.readdir(DOWNLOADS)).filter((f) => f.endsWith('.csv'));
  if (files.length) {
    const content = await fs.readFile(path.join(DOWNLOADS, files[0]), 'utf8');
    csv = { file: files[0], header: content.split('\r\n')[0], rows: content.split('\r\n').length };
  }
} catch {
  csv = null;
}
results.push(['exportar CSV', Boolean(csv && csv.header.includes('Documento') && csv.rows > 10)]);

/* sincronização entre dispositivos */
await go('#/painel');
const badgeBefore = await evaluate(
  `document.querySelector('.nav__link[href="#/apontamentos"] .nav__badge')?.textContent || '0'`
);
const state = await apiState();
const pendingCheck = state.checks.find((c) => c.status === 'pending');
if (pendingCheck) {
  await fetch(`${BASE}/api/checks/${pendingCheck.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'nc', note: 'Sincronização de teste' }),
  });
}
await sleep(14000);
const badgeAfter = await evaluate(
  `document.querySelector('.nav__link[href="#/apontamentos"] .nav__badge')?.textContent || '0'`
);
const toastText = await evaluate(
  `[...document.querySelectorAll('.toast')].map((t) => t.textContent).join(' | ')`
);
results.push([
  'sincroniza alterações externas',
  Number(badgeAfter) > Number(badgeBefore),
  `${badgeBefore} → ${badgeAfter} · ${toastText}`,
]);

for (const [label, ok, detail] of results) {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
}
if (errors.length) {
  console.error('Erros de console:\n' + errors.join('\n'));
}
const failed = results.filter(([, ok]) => !ok);
console.log(`\n${results.length - failed.length}/${results.length} ok`);
ws.close();
if (failed.length || errors.length) process.exit(1);
