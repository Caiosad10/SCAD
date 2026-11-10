/** Captura uma página em PNG via CDP. Uso: node scripts/shot.mjs <url> <arquivo> [largura] [altura] */
import fs from 'node:fs/promises';

const CDP = process.env.CDP || 'http://127.0.0.1:9333';
const [url, file, widthArg, heightArg] = process.argv.slice(2);
const width = Number(widthArg) || 1440;
const height = Number(heightArg) || 1000;

if (!url || !file) {
  console.error('Uso: node scripts/shot.mjs <url> <arquivo> [largura] [altura]');
  process.exit(1);
}

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

await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', {
  width,
  height,
  deviceScaleFactor: 1,
  mobile: false,
});
const loaded = waitFor('Page.loadEventFired');
await send('Page.navigate', { url });
await loaded;
await new Promise((resolve) => setTimeout(resolve, 1300));
const shot = await send('Page.captureScreenshot', { format: 'png' });
await fs.writeFile(file, Buffer.from(shot.data, 'base64'));
console.log(`${file} · ${width}×${height}`);
ws.close();
