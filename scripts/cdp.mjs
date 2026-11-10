/** Utilitário de depuração: abre uma URL no Edge/CDP e avalia uma expressão. */
const CDP = process.env.CDP || 'http://127.0.0.1:9333';
const url = process.argv[2];
const expression = process.argv[3] || 'document.body.innerText.slice(0, 500)';
const width = Number(process.env.W || 1440);
const height = Number(process.env.H || 1000);

const target = await (
  await fetch(`${CDP}/json/new?${encodeURIComponent('about:blank')}`, { method: 'PUT' })
).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
let seq = 0;
const pending = new Map();
const waiters = new Map();
const logs = [];

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
    logs.push(`EXCEPTION ${message.params.exceptionDetails.exception?.description}`);
  }
  if (message.method === 'Runtime.consoleAPICalled') {
    logs.push(`CONSOLE ${message.params.type}: ${message.params.args.map((a) => a.value ?? a.description).join(' ')}`);
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
await new Promise((resolve) => setTimeout(resolve, 1400));

const result = await send('Runtime.evaluate', {
  expression,
  returnByValue: true,
  awaitPromise: true,
});
console.log(JSON.stringify(result.result?.value, null, 2));
if (result.exceptionDetails) console.error('ERRO NA EXPRESSÃO:', result.exceptionDetails.text);
if (logs.length) console.error('\nLOG:\n' + logs.join('\n'));

ws.close();
