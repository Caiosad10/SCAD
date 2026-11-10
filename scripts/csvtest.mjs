/** Valida o CSV exportado (colunas, processo, código) sem alterar dados. */
import fs from 'node:fs/promises';
import path from 'node:path';

const CDP = process.env.CDP || 'http://127.0.0.1:9334';
const BASE = process.argv[2] || 'http://127.0.0.1:4191';
const OUT = path.join(process.cwd(), '.downloads');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const target = await (
  await fetch(`${CDP}/json/new?${encodeURIComponent('about:blank')}`, { method: 'PUT' })
).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
let seq = 0;
const pending = new Map();
const waiters = new Map();
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
  const list = waiters.get(message.method);
  if (list) {
    waiters.delete(message.method);
    list.forEach((fn) => fn(message.params));
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
  const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, userGesture: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || 'erro');
  return result.result.value;
}

await fs.rm(OUT, { recursive: true, force: true });
await fs.mkdir(OUT, { recursive: true });
await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1180, height: 820, deviceScaleFactor: 1, mobile: false });
await send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: OUT });
const loaded = waitFor('Page.loadEventFired');
await send('Page.navigate', { url: `${BASE}/?csv=1#/apontamentos` });
await loaded;
await sleep(1200);
await evaluate(`document.querySelector('[data-action="export-csv"]')?.click()`);
await sleep(1500);
const files = (await fs.readdir(OUT)).filter((name) => name.endsWith('.csv'));
if (!files.length) {
  console.log('CSV não gerado');
  process.exit(1);
}
const content = await fs.readFile(path.join(OUT, files[0]), 'utf8');
const lines = content.split('\r\n').filter(Boolean);
console.log(
  JSON.stringify(
    {
      file: files[0],
      header: lines[0],
      rows: lines.length - 1,
      hasCollection: lines[0].includes('Coleção'),
      hasProcess: lines[0].includes('Processo'),
      hasCode: lines[0].includes('Código'),
      hasSituation: lines[0].includes('Situação do documento'),
      sample: lines[1]?.slice(0, 160),
    },
    null,
    1
  )
);
ws.close();
