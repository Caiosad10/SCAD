#!/usr/bin/env node
/**
 * SCAD — Controle de Análise Documental
 * Servidor local sem dependências: serve a SPA, guarda o estado em JSON
 * e os arquivos importados em data/files.
 */
import http from 'node:http';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { exec } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { promises as fs } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_DIR = process.env.SCAD_DATA ? path.resolve(process.env.SCAD_DATA) : path.join(ROOT, 'data');
const FILES_DIR = path.join(DATA_DIR, 'files');
const DB_PATH = path.join(DATA_DIR, 'db.json');
const PORT = Number(process.env.PORT || process.argv[2] || 4177);
const HOST = process.env.HOST || '0.0.0.0';
const VERSION = '0.1.0';
const MAX_BODY = 48 * 1024 * 1024; // ~34 MB de arquivo em base64
const STATUSES = new Set(['pending', 'ok', 'nc', 'obs', 'na']);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.pdf': 'application/pdf',
};

const FILE_MIME = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  heic: 'image/heic',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  txt: 'text/plain; charset=utf-8',
  csv: 'text/csv; charset=utf-8',
};

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/* ---------------------------------------------------------------- estado */

const now = () => new Date().toISOString();
const uid = (prefix) => `${prefix}_${crypto.randomBytes(5).toString('hex')}`;

function emptyState() {
  return {
    rev: 1,
    createdAt: now(),
    updatedAt: now(),
    process: null,
    criteria: [],
    documents: [],
    checks: [],
    meta: { lastDocId: null, lastCheckId: null },
    activity: [],
  };
}

let state = emptyState();

function normalizeState(input) {
  const base = emptyState();
  const s = input && typeof input === 'object' ? input : {};
  return {
    ...base,
    ...s,
    meta: { ...base.meta, ...(s.meta || {}) },
    criteria: Array.isArray(s.criteria) ? s.criteria : [],
    documents: Array.isArray(s.documents) ? s.documents : [],
    checks: Array.isArray(s.checks) ? s.checks : [],
    activity: Array.isArray(s.activity) ? s.activity.slice(0, 200) : [],
  };
}

let saveChain = Promise.resolve();
function persist() {
  const snapshot = JSON.stringify(state, null, 2);
  saveChain = saveChain
    .catch(() => {})
    .then(async () => {
      const tmp = `${DB_PATH}.tmp`;
      await fs.writeFile(tmp, snapshot, 'utf8');
      await fs.rename(tmp, DB_PATH);
    })
    .catch((err) => console.error('[scad] falha ao gravar estado:', err));
  return saveChain;
}

let mutex = Promise.resolve();
/** Serializa mutações para que duas requisições não se atropelem. */
function mutate(fn) {
  const run = mutex.catch(() => {}).then(async () => {
    const result = fn();
    state.rev += 1;
    state.updatedAt = now();
    await persist();
    if (result && typeof result === 'object' && 'rev' in result) result.rev = state.rev;
    return result;
  });
  mutex = run;
  return run;
}

function log(text) {
  state.activity.unshift({ id: uid('act'), at: now(), text });
  state.activity = state.activity.slice(0, 200);
}

/* --------------------------------------------------------------- helpers */

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new HttpError(413, 'Conteúdo grande demais: limite de ~34 MB por arquivo.'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function readJson(req) {
  const buf = await readBody(req);
  if (!buf.length) return {};
  try {
    return JSON.parse(buf.toString('utf8'));
  } catch {
    throw new HttpError(400, 'JSON inválido no corpo da requisição.');
  }
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function text(value, max, field) {
  if (typeof value !== 'string') throw new HttpError(400, `Campo "${field}" é obrigatório.`);
  const v = value.trim();
  if (!v) throw new HttpError(400, `Campo "${field}" não pode ficar vazio.`);
  if (v.length > max) throw new HttpError(400, `Campo "${field}" excede ${max} caracteres.`);
  return v;
}

function optionalText(value, max, field) {
  if (value == null || value === '') return '';
  if (typeof value !== 'string') throw new HttpError(400, `Campo "${field}" inválido.`);
  const v = value.trim();
  if (v.length > max) throw new HttpError(400, `Campo "${field}" excede ${max} caracteres.`);
  return v;
}

function requireProcess() {
  if (!state.process) throw new HttpError(409, 'Nenhum processo criado ainda.');
  return state.process;
}

function findDoc(id) {
  return state.documents.find((d) => d.id === id) || null;
}

function lanUrls() {
  const urls = [];
  const nets = os.networkInterfaces();
  for (const entries of Object.values(nets)) {
    for (const net of entries || []) {
      if (net.family === 'IPv4' && !net.internal) {
        urls.push({ label: net.address, url: `http://${net.address}:${PORT}` });
      }
    }
  }
  return urls;
}

/* ------------------------------------------------------------------ API */

async function handleApi(req, res, pathname) {
  const method = req.method;

  if (pathname === '/api/health' && method === 'GET') {
    return sendJson(res, 200, {
      ok: true,
      app: 'scad',
      version: VERSION,
      port: PORT,
      lan: lanUrls(),
      uptime: Math.round(process.uptime()),
    });
  }

  if (pathname === '/api/state' && method === 'GET') {
    return sendJson(res, 200, state);
  }

  if (pathname === '/api/process' && method === 'POST') {
    const body = await readJson(req);
    const name = text(body.name, 180, 'nome do processo');
    const description = optionalText(body.description, 2000, 'descrição');
    const criteria = Array.isArray(body.criteria) ? body.criteria : [];
    if (!criteria.length) throw new HttpError(400, 'Defina pelo menos um critério de verificação.');

    const created = await mutate(() => {
      if (state.process) throw new HttpError(409, 'Já existe um processo. Redefina os dados para iniciar outro.');
      state.criteria = criteria.map((c, i) => ({
        id: uid('crit'),
        label: text(c?.label ?? 'Critério', 160, 'critério'),
        hint: optionalText(c?.hint, 400, 'orientação'),
        order: i,
      }));
      state.documents = [];
      state.checks = [];
      state.meta = { lastDocId: null, lastCheckId: null };
      state.process = {
        id: uid('prc'),
        code: `PRT-${crypto.randomBytes(2).toString('hex').toUpperCase()}`,
        name,
        description,
        createdAt: now(),
        updatedAt: now(),
      };
      log(`Processo criado: ${name}`);
      return { rev: state.rev, state };
    });
    return sendJson(res, 201, created);
  }

  if (pathname === '/api/process' && method === 'PATCH') {
    const body = await readJson(req);
    const result = await mutate(() => {
      const proc = requireProcess();
      if (body.name != null) proc.name = text(body.name, 180, 'nome do processo');
      if (body.description != null) proc.description = optionalText(body.description, 2000, 'descrição');
      proc.updatedAt = now();
      log(`Processo atualizado: ${proc.name}`);
      return { rev: state.rev, state };
    });
    return sendJson(res, 200, result);
  }

  if (pathname === '/api/criteria' && method === 'POST') {
    const body = await readJson(req);
    const label = text(body.label, 160, 'critério');
    const hint = optionalText(body.hint, 400, 'orientação');
    const result = await mutate(() => {
      requireProcess();
      const criterion = { id: uid('crit'), label, hint, order: state.criteria.length };
      state.criteria.push(criterion);
      for (const doc of state.documents) {
        state.checks.push({
          id: uid('chk'),
          docId: doc.id,
          criterionId: criterion.id,
          status: 'pending',
          note: '',
          updatedAt: now(),
        });
      }
      log(`Critério adicionado: ${label}`);
      return { rev: state.rev, state };
    });
    return sendJson(res, 201, result);
  }

  const criteriaReorder = pathname.match(/^\/api\/criteria\/reorder$/);
  if (criteriaReorder && method === 'POST') {
    const body = await readJson(req);
    const ids = Array.isArray(body.ids) ? body.ids.map(String) : null;
    if (!ids) throw new HttpError(400, 'Lista de critérios inválida.');
    const result = await mutate(() => {
      requireProcess();
      const byId = new Map(state.criteria.map((c) => [c.id, c]));
      const ordered = ids.map((id) => byId.get(id)).filter(Boolean);
      if (ordered.length !== state.criteria.length) {
        throw new HttpError(400, 'A nova ordem precisa conter todos os critérios.');
      }
      state.criteria = ordered.map((c, i) => ({ ...c, order: i }));
      return { rev: state.rev, state };
    });
    return sendJson(res, 200, result);
  }

  const criteriaId = pathname.match(/^\/api\/criteria\/([^/]+)$/);
  if (criteriaId) {
    const id = decodeURIComponent(criteriaId[1]);
    if (method === 'PATCH') {
      const body = await readJson(req);
      const result = await mutate(() => {
        requireProcess();
        const criterion = state.criteria.find((c) => c.id === id);
        if (!criterion) throw new HttpError(404, 'Critério não encontrado.');
        if (body.label != null) criterion.label = text(body.label, 160, 'critério');
        if (body.hint != null) criterion.hint = optionalText(body.hint, 400, 'orientação');
        log(`Critério atualizado: ${criterion.label}`);
        return { rev: state.rev, state };
      });
      return sendJson(res, 200, result);
    }
    if (method === 'DELETE') {
      const result = await mutate(() => {
        requireProcess();
        const criterion = state.criteria.find((c) => c.id === id);
        if (!criterion) throw new HttpError(404, 'Critério não encontrado.');
        state.criteria = state.criteria.filter((c) => c.id !== id).map((c, i) => ({ ...c, order: i }));
        state.checks = state.checks.filter((c) => c.criterionId !== id);
        log(`Critério removido: ${criterion.label}`);
        return { rev: state.rev, state };
      });
      return sendJson(res, 200, result);
    }
  }

  if (pathname === '/api/documents' && method === 'POST') {
    const body = await readJson(req);
    const name = text(body.name, 220, 'nome do arquivo');
    const mime = optionalText(body.mime, 160, 'tipo do arquivo');
    if (typeof body.data !== 'string' || !body.data) throw new HttpError(400, 'Conteúdo do arquivo ausente.');
    let buffer;
    try {
      buffer = Buffer.from(body.data, 'base64');
    } catch {
      throw new HttpError(400, 'Não foi possível ler o arquivo enviado.');
    }
    if (!buffer.length) throw new HttpError(400, 'Arquivo vazio.');

    const ext = (name.includes('.') ? name.split('.').pop() : '').toLowerCase().replace(/[^.a-z0-9]/g, '').slice(0, 10);
    const id = uid('doc');
    const stored = `${id}${ext ? `.${ext}` : '.bin'}`;

    // O tipo é derivado da extensão: o cliente não decide como o arquivo será servido.
    const safeMime = FILE_MIME[ext] || 'application/octet-stream';

    const doc = {
      id,
      name,
      mime: safeMime,
      size: buffer.length,
      stored,
      addedAt: now(),
    };

    try {
      await fs.writeFile(path.join(FILES_DIR, stored), buffer);
    } catch (err) {
      throw new HttpError(500, `Não foi possível gravar o arquivo: ${err.message}`);
    }

    const result = await mutate(() => {
      requireProcess();
      state.documents.push(doc);
      for (const criterion of state.criteria) {
        state.checks.push({
          id: uid('chk'),
          docId: doc.id,
          criterionId: criterion.id,
          status: 'pending',
          note: '',
          updatedAt: now(),
        });
      }
      log(`Documento importado: ${name}`);
      return { rev: state.rev, state, document: doc };
    });
    return sendJson(res, 201, result);
  }

  const docId = pathname.match(/^\/api\/documents\/([^/]+)$/);
  if (docId) {
    const id = decodeURIComponent(docId[1]);
    if (method === 'PATCH') {
      const body = await readJson(req);
      const result = await mutate(() => {
        requireProcess();
        const doc = findDoc(id);
        if (!doc) throw new HttpError(404, 'Documento não encontrado.');
        if (body.name != null) doc.name = text(body.name, 220, 'nome do arquivo');
        log(`Documento renomeado: ${doc.name}`);
        return { rev: state.rev, state };
      });
      return sendJson(res, 200, result);
    }
    if (method === 'DELETE') {
      const doc = findDoc(id);
      if (!doc) throw new HttpError(404, 'Documento não encontrado.');
      const result = await mutate(() => {
        requireProcess();
        state.documents = state.documents.filter((d) => d.id !== id);
        state.checks = state.checks.filter((c) => c.docId !== id);
        if (state.meta.lastDocId === id) state.meta.lastDocId = null;
        log(`Documento removido: ${doc.name}`);
        return { rev: state.rev, state };
      });
      try {
        await fs.unlink(path.join(FILES_DIR, doc.stored));
      } catch {
        /* arquivo já ausente */
      }
      return sendJson(res, 200, result);
    }
  }

  const checkId = pathname.match(/^\/api\/checks\/([^/]+)$/);
  if (checkId && method === 'PATCH') {
    const id = decodeURIComponent(checkId[1]);
    const body = await readJson(req);
    if (body.status != null && !STATUSES.has(body.status)) {
      throw new HttpError(400, 'Resultado de verificação inválido.');
    }
    const note = body.note != null ? optionalText(body.note, 5000, 'nota') : undefined;

    const result = await mutate(() => {
      requireProcess();
      const check = state.checks.find((c) => c.id === id);
      if (!check) throw new HttpError(404, 'Verificação não encontrada.');
      const previous = check.status;
      if (body.status != null) check.status = body.status;
      if (note !== undefined) check.note = note;
      check.updatedAt = now();
      state.meta.lastDocId = check.docId;
      state.meta.lastCheckId = check.id;
      const doc = findDoc(check.docId);
      if (body.status != null && previous !== check.status && doc) {
        const critic = state.criteria.find((c) => c.id === check.criterionId);
        if (check.status === 'nc') log(`Não conforme: ${doc.name} — ${critic?.label || 'critério'}`);
        else if (check.status === 'obs') log(`Observação: ${doc.name} — ${critic?.label || 'critério'}`);
        else if (previous === 'nc' || previous === 'obs') log(`Apontamento resolvido: ${doc.name}`);
      }
      return { rev: state.rev, check: { ...check } };
    });
    return sendJson(res, 200, result);
  }

  if (pathname === '/api/meta' && method === 'POST') {
    const body = await readJson(req);
    const result = await mutate(() => {
      requireProcess();
      if (body.lastDocId !== undefined) {
        const id = body.lastDocId == null ? null : String(body.lastDocId);
        state.meta.lastDocId = id && findDoc(id) ? id : null;
      }
      return { rev: state.rev, state };
    });
    return sendJson(res, 200, result);
  }

  if (pathname === '/api/export' && method === 'GET') {
    const body = JSON.stringify(state, null, 2);
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="scad-backup-${new Date().toISOString().slice(0, 10)}.json"`,
      'Cache-Control': 'no-store',
    });
    return res.end(body);
  }

  if (pathname === '/api/import' && method === 'POST') {
    const body = await readJson(req);
    const incoming = body.state;
    if (!incoming || typeof incoming !== 'object') throw new HttpError(400, 'Backup inválido.');
    const result = await mutate(() => {
      state = normalizeState(incoming);
      state.rev = (Number(incoming.rev) || 1) + 1;
      state.updatedAt = now();
      log('Backup restaurado');
      return { rev: state.rev, state };
    });
    return sendJson(res, 200, result);
  }

  if (pathname === '/api/reset' && method === 'POST') {
    const body = await readJson(req);
    if (body.confirm !== true) throw new HttpError(400, 'Confirmação ausente.');
    const result = await mutate(() => {
      state = emptyState();
      state.rev = 1;
      return { rev: state.rev, state };
    });
    try {
      const entries = await fs.readdir(FILES_DIR);
      await Promise.all(entries.map((entry) => fs.rm(path.join(FILES_DIR, entry), { force: true })));
    } catch {
      /* pasta vazia ou ausente */
    }
    return sendJson(res, 200, result);
  }

  throw new HttpError(404, 'Rota de API não encontrada.');
}

/* --------------------------------------------------------------- arquivos */

async function serveFile(req, res, stored) {
  const doc = state.documents.find((d) => d.stored === stored);
  if (!doc) throw new HttpError(404, 'Arquivo não encontrado.');
  const full = path.join(FILES_DIR, doc.stored);
  let stat;
  try {
    stat = await fs.stat(full);
  } catch {
    throw new HttpError(404, 'Arquivo não encontrado no disco.');
  }

  const mime = doc.mime || FILE_MIME[doc.stored.split('.').pop().toLowerCase()] || 'application/octet-stream';
  const download = new URL(req.url, 'http://localhost').searchParams.get('download') === '1';
  const INLINE_MIME = new Set([
    'application/pdf',
    'image/png',
    'image/jpeg',
    'image/webp',
    'image/gif',
    'image/heic',
    'text/plain; charset=utf-8',
  ]);
  const inline = !download && INLINE_MIME.has(mime);
  const disposition = `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(doc.name)}`;
  const range = req.headers.range;

  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (match) {
      let start = match[1] ? Number(match[1]) : 0;
      let end = match[2] ? Number(match[2]) : stat.size - 1;
      if (Number.isNaN(start) || Number.isNaN(end) || start > end || start >= stat.size) {
        res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` });
        return res.end();
      }
      end = Math.min(end, stat.size - 1);
      res.writeHead(206, {
        'Content-Type': mime,
        'Content-Length': end - start + 1,
        'Content-Range': `bytes ${start}-${end}/${stat.size}`,
        'Accept-Ranges': 'bytes',
        'Content-Disposition': disposition,
        'Cache-Control': 'private, max-age=3600',
      });
      return createReadStream(full, { start, end }).pipe(res);
    }
  }

  res.writeHead(200, {
    'Content-Type': mime,
    'Content-Length': stat.size,
    'Accept-Ranges': 'bytes',
    'Content-Disposition': disposition,
    'Cache-Control': 'private, max-age=3600',
  });
  createReadStream(full).pipe(res);
}

/* ---------------------------------------------------------------- estático */

async function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel === '/') rel = '/index.html';
  const full = path.resolve(PUBLIC_DIR, `.${rel}`);
  const relative = path.relative(PUBLIC_DIR, full);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new HttpError(403, 'Acesso negado.');

  try {
    const stat = await fs.stat(full);
    if (stat.isDirectory()) throw new HttpError(404, 'Não encontrado.');
    const ext = path.extname(full).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Content-Length': stat.size,
      'Cache-Control': ext === '.html' ? 'no-store' : 'no-cache',
      'X-Content-Type-Options': 'nosniff',
    });
    return createReadStream(full).pipe(res);
  } catch (err) {
    if (err instanceof HttpError) throw err;
    // fallback para SPA em rotas sem extensão (ex.: /documentos)
    if (!path.extname(rel)) {
      const index = path.join(PUBLIC_DIR, 'index.html');
      const html = await fs.readFile(index);
      res.writeHead(200, { 'Content-Type': MIME['.html'], 'Content-Length': html.length, 'Cache-Control': 'no-store' });
      return res.end(html);
    }
    throw new HttpError(404, 'Arquivo não encontrado.');
  }
}

/* ------------------------------------------------------------------ HTTP */

const server = http.createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = url.pathname;

    if (pathname.startsWith('/api/')) {
      await handleApi(req, res, pathname);
    } else if (pathname.startsWith('/files/')) {
      await serveFile(req, res, pathname.slice('/files/'.length));
    } else if (req.method === 'GET' || req.method === 'HEAD') {
      await serveStatic(req, res, pathname);
    } else {
      throw new HttpError(405, 'Método não permitido.');
    }
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    if (status === 500) console.error('[scad] erro:', err);
    if (res.headersSent) return res.end();
    sendJson(res, status, { error: err.message || 'Erro interno.' });
  }
});

async function boot() {
  await fs.mkdir(FILES_DIR, { recursive: true });
  try {
    const raw = await fs.readFile(DB_PATH, 'utf8');
    state = normalizeState(JSON.parse(raw));
  } catch (err) {
    if (err?.code !== 'ENOENT') {
      // Banco ilegível: preserva o arquivo para inspeção em vez de sobrescrever.
      try {
        await fs.rename(DB_PATH, `${DB_PATH}.corrupt-${Date.now()}`);
        console.warn('[scad] db.json ilegível; cópia preservada e estado iniciado vazio.');
      } catch {
        /* sem arquivo para preservar */
      }
    }
    state = emptyState();
    await persist();
  }

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`\nA porta ${PORT} já está em uso. Feche o outro SCAD ou rode: node server.mjs 4180\n`);
    } else {
      console.error('Falha no servidor:', err);
    }
    process.exit(1);
  });

  server.listen(PORT, HOST, () => {
    const lan = lanUrls();
    const line = '─'.repeat(58);
    console.log(`\n\x1b[38;5;110m${line}\x1b[0m`);
    console.log('  \x1b[1mSCAD\x1b[0m · Controle de Análise Documental');
    console.log(`  v${VERSION} · dados em ${DATA_DIR}`);
    console.log(`\x1b[38;5;110m${line}\x1b[0m`);
    console.log(`  Local   http://localhost:${PORT}`);
    for (const item of lan) console.log(`  iPad    ${item.url}   (mesma rede Wi-Fi)`);
    console.log(`\x1b[38;5;110m${line}\x1b[0m`);
    console.log('  Ctrl+C para encerrar.\n');

    if (process.argv.includes('--open') && process.platform === 'win32') {
      exec(`start "" "http://localhost:${PORT}"`, () => {});
    }
  });
}

process.on('SIGINT', async () => {
  await saveChain.catch(() => {});
  process.exit(0);
});

boot().catch((err) => {
  console.error('Falha ao iniciar o SCAD:', err);
  process.exit(1);
});
