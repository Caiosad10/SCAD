#!/usr/bin/env node
/**
 * SCAD v2 — Coleções → Processos, perfis, autoria e situação do documento.
 * Servidor local sem dependências; dados em data/db.json e data/files.
 * A produção só deve receber este arquivo após migração testada e backup.
 */
import http from 'node:http';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { exec } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { promises as fs } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { AsyncLocalStorage } from 'node:async_hooks';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_DIR = process.env.SCAD_DATA ? path.resolve(process.env.SCAD_DATA) : path.join(ROOT, 'data');
const FILES_DIR = path.join(DATA_DIR, 'files');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const DB_PATH = path.join(DATA_DIR, 'db.json');
const PORT = Number(process.env.PORT || process.argv[2] || 4177);
const HOST = process.env.HOST || '0.0.0.0';
const VERSION = '2.0.0';
const MAX_BODY = 48 * 1024 * 1024;
const CHECK_STATUSES = new Set(['pending', 'ok', 'nc', 'obs']);

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

const requestContext = new AsyncLocalStorage();

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/* ---------------------------------------------------------------- estado */

const now = () => new Date().toISOString();
const uid = (prefix) => `${prefix}_${crypto.randomBytes(5).toString('hex')}`;

const SERGIO_ID = 'usr_sergio';
const DIOGENES_ID = 'usr_diogenes';

function defaultProfiles() {
  return [
    { id: SERGIO_ID, name: 'Sergio', role: 'analyst', createdAt: now() },
    { id: DIOGENES_ID, name: 'Diogenes', role: 'reviewer', createdAt: now() },
  ];
}

function emptyState() {
  return {
    schemaVersion: 2,
    rev: 1,
    createdAt: now(),
    updatedAt: now(),
    profiles: defaultProfiles(),
    collections: [],
    processes: [],
    criteria: [],
    documents: [],
    checks: [],
    meta: { lastDocByProcess: {}, lastCheckId: null },
    activity: [],
  };
}

function array(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeState(input) {
  const base = emptyState();
  const s = input && typeof input === 'object' ? input : {};
  const profiles = array(s.profiles).length ? s.profiles : base.profiles;
  const documents = array(s.documents).map((doc) => ({
    ...doc,
    active: doc.active !== false,
    inactiveReason: typeof doc.inactiveReason === 'string' ? doc.inactiveReason : '',
  }));
  const meta = s.meta && typeof s.meta === 'object' ? s.meta : {};
  return {
    ...base,
    ...s,
    schemaVersion: 2,
    profiles,
    collections: array(s.collections),
    processes: array(s.processes),
    criteria: array(s.criteria),
    documents,
    checks: array(s.checks).map((check) => ({ ...check, review: normalizeReview(check.review) })),
    meta: {
      lastDocByProcess: meta.lastDocByProcess && typeof meta.lastDocByProcess === 'object' ? meta.lastDocByProcess : {},
      lastCheckId: meta.lastCheckId || null,
    },
    activity: array(s.activity).slice(0, 300),
  };
}

function slug(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '')
    .toUpperCase();
}

function makeProcessCode(collectionName, processName, processes) {
  const collectionPart = slug(String(collectionName || '').split(':')[0]) || 'COL';
  const processPart = slug(processName) || 'PROC';
  const base = `${collectionPart}-${processPart}`.slice(0, 28);
  let code = base;
  let index = 2;
  while (processes.some((process) => process.code === code)) {
    code = `${base}-${index}`;
    index += 1;
  }
  return code;
}

/** Converte o estado v1 (processo único) para v2 preservando ids, checks e notas. */
function migrateV1(raw) {
  const state = emptyState();
  state.rev = Number(raw.rev) || 1;
  state.createdAt = raw.createdAt || now();
  state.updatedAt = raw.updatedAt || now();
  state.activity = array(raw.activity).map((item) => ({ ...item, processId: item.processId || null }));
  state.profiles = defaultProfiles();

  const oldProcess = raw.process;
  if (!oldProcess) return state;

  const nameParts = String(oldProcess.name || '').split(' - ');
  const collectionName = nameParts.length > 1 ? nameParts.slice(0, -1).join(' - ').trim() : 'Coleção principal';
  const processName = nameParts.length > 1 ? nameParts[nameParts.length - 1].trim() : String(oldProcess.name || 'Processo');

  const collection = {
    id: uid('col'),
    name: collectionName,
    description: '',
    createdAt: oldProcess.createdAt || state.createdAt,
    updatedAt: oldProcess.updatedAt || state.updatedAt,
  };
  const process = {
    id: oldProcess.id || uid('prc'),
    collectionId: collection.id,
    name: processName,
    code: makeProcessCode(collectionName, processName, []),
    legacyCode: oldProcess.code || null,
    description: oldProcess.description || '',
    createdAt: oldProcess.createdAt || state.createdAt,
    updatedAt: oldProcess.updatedAt || state.updatedAt,
  };

  state.collections = [collection];
  state.processes = [process];
  state.criteria = array(raw.criteria).map((criterion) => ({ ...criterion, processId: process.id }));
  state.documents = array(raw.documents).map((doc) => ({
    ...doc,
    processId: process.id,
    active: true,
    inactiveReason: '',
  }));
  state.checks = array(raw.checks).map((check) => ({ ...check, authorId: SERGIO_ID }));
  state.meta = {
    lastDocByProcess: raw.meta?.lastDocId ? { [process.id]: raw.meta.lastDocId } : {},
    lastCheckId: raw.meta?.lastCheckId || null,
  };
  state.activity = state.activity.map((item) => ({
    ...item,
    processId: process.id,
    collectionId: collection.id,
    actorId: item.actorId || null,
    actorName: item.actorName || null,
  }));
  state.activity.unshift({
    id: uid('act'),
    at: now(),
    text: 'Migração para schema v2: coleções, processos, perfis e situação do documento',
    actorId: null,
    actorName: null,
    processId: process.id,
    collectionId: collection.id,
  });
  state.rev += 1;
  state.updatedAt = now();
  return state;
}

let state = emptyState();

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
  const buffer = await readBody(req);
  if (!buffer.length) return {};
  try {
    return JSON.parse(buffer.toString('utf8'));
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

function findProcess(id) {
  return state.processes.find((process) => process.id === id) || null;
}

function findCollection(id) {
  return state.collections.find((collection) => collection.id === id) || null;
}

function requireProcess(id, field = 'processo') {
  const process = findProcess(id);
  if (!process) throw new HttpError(404, `Processo não encontrado (${field}).`);
  return process;
}

function findDoc(id) {
  return state.documents.find((doc) => doc.id === id) || null;
}

function lanUrls() {
  const urls = [];
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const net of entries || []) {
      if (net.family === 'IPv4' && !net.internal) {
        urls.push({ label: net.address, url: `http://${net.address}:${PORT}` });
      }
    }
  }
  return urls;
}

function actorFrom(req) {
  const id = req.headers['x-scad-actor'];
  if (!id) return null;
  return state.profiles.find((profile) => profile.id === id) || null;
}

function processFromRequest(req) {
  const id = req.headers['x-scad-process'];
  return id && findProcess(id) ? id : null;
}

/* ---------------------------------------------------------------- revisão */

const REVIEW_STATUSES = new Set(['pending', 'approved', 'flagged']);

function normalizeReview(review) {
  const source = review && typeof review === 'object' ? review : {};
  return {
    status: REVIEW_STATUSES.has(source.status) ? source.status : 'pending',
    by: source.by || null,
    byName: source.byName || null,
    at: source.at || null,
    note: typeof source.note === 'string' ? source.note : '',
    checkVersion: source.checkVersion || null,
    history: array(source.history).slice(-8),
  };
}

function setReview(check, status, actor, extra = {}) {
  const entry = {
    status,
    by: actor?.id || null,
    byName: actor?.name || null,
    at: now(),
    note: extra.note || '',
    ...(extra.auto ? { auto: true } : {}),
  };
  const history = array(check.review?.history).slice(-7);
  history.push(entry);
  check.review = {
    status,
    by: entry.by,
    byName: entry.byName,
    at: entry.at,
    note: entry.note,
    checkVersion: check.updatedAt || null,
    history,
  };
}

function requireReviewer(actor) {
  if (!actor) throw new HttpError(401, 'Selecione o perfil do revisor (Diogenes) para aprovar ou sinalizar.');
  if (actor.role !== 'reviewer') throw new HttpError(403, 'Apenas o revisor pode aprovar ou sinalizar verificações.');
  return actor;
}

/** Estado de revisão derivado dos checks do documento. */
function docReview(doc) {
  const checks = state.checks.filter((check) => check.docId === doc.id);
  const done = checks.filter((check) => check.status !== 'pending');
  const flagged = done.filter((check) => check.review?.status === 'flagged');
  const approved = done.filter((check) => check.review?.status === 'approved');
  let status = 'analysis';
  if (doc.active === false) status = 'dispensed';
  else if (!checks.length) status = 'empty';
  else if (done.length < checks.length) status = 'analysis';
  else if (flagged.length) status = 'attention';
  else if (approved.length === done.length) status = 'approved';
  else status = 'awaiting';
  return {
    status,
    total: checks.length,
    done: done.length,
    approved: approved.length,
    flagged: flagged.length,
    awaiting: Math.max(0, done.length - approved.length - flagged.length),
  };
}

/* --------------------------------------------------------------- presença */

const PRESENCE_TTL = 45000;
const presence = new Map();

function prunePresence() {
  const limit = Date.now() - PRESENCE_TTL;
  for (const [key, item] of presence) {
    if (item.at < limit) presence.delete(key);
  }
}

function presenceFor(processId, selfActorId) {
  prunePresence();
  return [...presence.values()]
    .filter((item) => item.processId === processId && item.actorId !== selfActorId && item.docId)
    .map((item) => ({
      actorId: item.actorId,
      actorName: item.actorName,
      docId: item.docId,
      at: new Date(item.at).toISOString(),
    }));
}


function log(text, extra = {}) {
  const context = requestContext.getStore() || {};
  const actor = extra.actor || context.actor || null;
  const processId = extra.processId !== undefined ? extra.processId : context.processId || null;
  const process = processId ? findProcess(processId) : null;
  const collectionId = extra.collectionId || process?.collectionId || null;
  state.activity.unshift({
    id: uid('act'),
    at: now(),
    text,
    actorId: actor?.id || null,
    actorName: actor?.name || null,
    actorRole: actor?.role || null,
    processId,
    collectionId,
  });
  state.activity = state.activity.slice(0, 300);
}

/* ---------------------------------------------------------- estatísticas */

function processStats(processId) {
  const docs = state.documents.filter((doc) => doc.processId === processId);
  const inactiveDocs = docs.filter((doc) => doc.active === false).length;
  const activeDocs = docs.filter((doc) => doc.active !== false);
  const activeDocIds = new Set(activeDocs.map((doc) => doc.id));
  const checks = state.checks.filter((check) => activeDocIds.has(check.docId));
  const total = checks.length;
  const done = checks.filter((check) => check.status !== 'pending').length;
  const nc = checks.filter((check) => check.status === 'nc').length;
  const obs = checks.filter((check) => check.status === 'obs').length;
  const pendingDocs = activeDocs.filter((doc) => {
    const docChecks = checks.filter((check) => check.docId === doc.id);
    return docChecks.some((check) => check.status === 'pending');
  }).length;
  const verifiedDocs = docs.filter((doc) => {
    if (doc.active === false) return true;
    const docChecks = state.checks.filter((check) => check.docId === doc.id);
    return docChecks.length > 0 && docChecks.every((check) => check.status !== 'pending');
  }).length;
  const pct = total
    ? Math.round((done / total) * 100)
    : docs.length > 0 && inactiveDocs === docs.length
      ? 100
      : 0;
  const reviewStates = activeDocs.map((doc) => docReview(doc).status);
  return {
    docs: docs.length,
    activeDocs: activeDocs.length,
    inactiveDocs,
    verifiedDocs,
    pendingDocs,
    checks: total,
    done,
    pending: total - done,
    nc,
    obs,
    pct,
    awaitingDocs: reviewStates.filter((value) => value === 'awaiting').length,
    attentionDocs: reviewStates.filter((value) => value === 'attention').length,
    approvedDocs: reviewStates.filter((value) => value === 'approved').length,
    reviewDocs: reviewStates.filter((value) => value === 'awaiting' || value === 'attention').length,
    suspendedChecks: state.checks.filter(
      (check) => activeDocIds.has(check.docId) === false && docs.some((doc) => doc.id === check.docId)
    ).length,
  };
}

function collectionStats(collectionId) {
  const processes = state.processes.filter((process) => process.collectionId === collectionId);
  const stats = processes.map((process) => processStats(process.id));
  const total = stats.reduce((sum, item) => sum + item.checks, 0);
  const done = stats.reduce((sum, item) => sum + item.done, 0);
  const docs = stats.reduce((sum, item) => sum + item.docs, 0);
  const inactiveDocs = stats.reduce((sum, item) => sum + item.inactiveDocs, 0);
  return {
    processes: processes.length,
    docs,
    inactiveDocs,
    checks: total,
    done,
    pending: stats.reduce((sum, item) => sum + item.pending, 0),
    nc: stats.reduce((sum, item) => sum + item.nc, 0),
    obs: stats.reduce((sum, item) => sum + item.obs, 0),
    awaitingDocs: stats.reduce((sum, item) => sum + item.awaitingDocs, 0),
    attentionDocs: stats.reduce((sum, item) => sum + item.attentionDocs, 0),
    approvedDocs: stats.reduce((sum, item) => sum + item.approvedDocs, 0),
    reviewDocs: stats.reduce((sum, item) => sum + item.reviewDocs, 0),
    pct: total
      ? Math.round((done / total) * 100)
      : docs > 0 && inactiveDocs === docs
        ? 100
        : 0,
  };
}

function scopedActivity(processId, limit = 40) {
  return state.activity
    .filter((item) => (processId ? item.processId === processId : false))
    .slice(0, limit);
}

function scopedState(processId) {
  const collections = state.collections.map((collection) => ({
    ...collection,
    stats: collectionStats(collection.id),
  }));
  const processes = state.processes.map((process) => ({
    ...process,
    stats: processStats(process.id),
  }));
  const base = {
    schemaVersion: 2,
    rev: state.rev,
    updatedAt: state.updatedAt,
    profiles: state.profiles,
    collections,
    processes,
    criteriaCatalog: state.criteria.map(({ id, processId: pid, label, hint }) => ({
      id,
      processId: pid,
      label,
      hint,
    })),
    process: null,
    collection: null,
    criteria: [],
    documents: [],
    checks: [],
    meta: { lastDocId: null, lastCheckId: null },
    activity: [],
    counts: {
      docs: 0,
      inactiveDocs: 0,
      checks: 0,
      done: 0,
      pending: 0,
      nc: 0,
      obs: 0,
      pct: 0,
      suspendedChecks: 0,
    },
  };

  if (!processId) return base;
  const process = findProcess(processId);
  if (!process) return base;
  const collection = findCollection(process.collectionId);
  const docs = state.documents.filter((doc) => doc.processId === processId);
  const docIds = new Set(docs.map((doc) => doc.id));
  const checks = state.checks.filter((check) => docIds.has(check.docId));
  return {
    ...base,
    process,
    collection,
    criteria: state.criteria
      .filter((criterion) => criterion.processId === processId)
      .sort((a, b) => a.order - b.order),
    documents: docs.map((doc) => ({ ...doc, review: docReview(doc) })),
    checks,
    meta: {
      lastDocId: state.meta.lastDocByProcess[processId] || null,
      lastCheckId: state.meta.lastCheckId || null,
    },
    activity: scopedActivity(processId),
    counts: processStats(processId),
  };
}

function sendState(res, processId, extra = {}) {
  return sendJson(res, 200, { rev: state.rev, state: scopedState(processId), ...extra });
}

/* ------------------------------------------------------------------ API */

async function handleApi(req, res, pathname, url) {
  const method = req.method;

  if (pathname === '/api/health' && method === 'GET') {
    return sendJson(res, 200, {
      ok: true,
      app: 'scad',
      version: VERSION,
      schemaVersion: 2,
      port: PORT,
      lan: lanUrls(),
      uptime: Math.round(process.uptime()),
    });
  }

  if (pathname === '/api/state' && method === 'GET') {
    const processId = url.searchParams.get('processId') || processFromRequest(req);
    return sendJson(res, 200, scopedState(processId));
  }

  if (pathname === '/api/collections' && method === 'POST') {
    const body = await readJson(req);
    const name = text(body.name, 120, 'nome da coleção');
    const description = optionalText(body.description, 600, 'descrição');
    const result = await mutate(() => {
      if (state.collections.some((collection) => collection.name.toLowerCase() === name.toLowerCase())) {
        throw new HttpError(409, 'Já existe uma coleção com esse nome.');
      }
      const collection = { id: uid('col'), name, description, createdAt: now(), updatedAt: now() };
      state.collections.push(collection);
      log(`Coleção criada: ${name}`, { collectionId: collection.id, processId: null });
      return { rev: state.rev, state: scopedState(null), createdCollection: collection };
    });
    return sendJson(res, 201, result);
  }

  const collectionIdMatch = pathname.match(/^\/api\/collections\/([^/]+)$/);
  if (collectionIdMatch) {
    const id = decodeURIComponent(collectionIdMatch[1]);
    if (method === 'PATCH') {
      const body = await readJson(req);
      const result = await mutate(() => {
        const collection = findCollection(id);
        if (!collection) throw new HttpError(404, 'Coleção não encontrada.');
        if (body.name != null) collection.name = text(body.name, 120, 'nome da coleção');
        if (body.description != null) collection.description = optionalText(body.description, 600, 'descrição');
        collection.updatedAt = now();
        log(`Coleção atualizada: ${collection.name}`, { collectionId: id, processId: null });
        return { rev: state.rev, state: scopedState(processFromRequest(req)) };
      });
      return sendJson(res, 200, result);
    }
    if (method === 'DELETE') {
      const result = await mutate(() => {
        const collection = findCollection(id);
        if (!collection) throw new HttpError(404, 'Coleção não encontrada.');
        if (state.processes.some((process) => process.collectionId === id)) {
          throw new HttpError(409, 'Exclua ou mova os processos antes de excluir a coleção.');
        }
        state.collections = state.collections.filter((item) => item.id !== id);
        log(`Coleção removida: ${collection.name}`, { collectionId: null, processId: null });
        return { rev: state.rev, state: scopedState(null) };
      });
      return sendJson(res, 200, result);
    }
  }

  if (pathname === '/api/processes' && method === 'POST') {
    const body = await readJson(req);
    const collection = findCollection(body.collectionId);
    if (!collection) throw new HttpError(404, 'Coleção não encontrada.');
    const name = text(body.name, 120, 'nome do processo');
    const description = optionalText(body.description, 1000, 'descrição');
    const result = await mutate(() => {
      if (state.processes.some((p) => p.collectionId === collection.id && p.name.toLowerCase() === name.toLowerCase())) {
        throw new HttpError(409, 'Já existe um processo com esse nome nesta coleção.');
      }
      const process = {
        id: uid('prc'),
        collectionId: collection.id,
        name,
        code: makeProcessCode(collection.name, name, state.processes),
        description,
        createdAt: now(),
        updatedAt: now(),
      };
      state.processes.push(process);
      const criteria = array(body.criteria);
      criteria.forEach((item, index) => {
        const label = text(item?.label, 160, 'critério');
        state.criteria.push({
          id: uid('crit'),
          processId: process.id,
          label,
          hint: optionalText(item?.hint, 400, 'orientação'),
          order: index,
        });
      });
      log(`Processo criado: ${collection.name} - ${name}`, {
        processId: process.id,
        collectionId: collection.id,
      });
      return { rev: state.rev, state: scopedState(process.id), createdProcess: process };
    });
    return sendJson(res, 201, result);
  }

  const processIdMatch = pathname.match(/^\/api\/processes\/([^/]+)$/);
  if (processIdMatch) {
    const id = decodeURIComponent(processIdMatch[1]);
    if (method === 'PATCH') {
      const body = await readJson(req);
      const result = await mutate(() => {
        const process = requireProcess(id);
        if (body.name != null) process.name = text(body.name, 120, 'nome do processo');
        if (body.description != null) process.description = optionalText(body.description, 1000, 'descrição');
        process.updatedAt = now();
        log(`Processo atualizado: ${process.name}`, { processId: id });
        return { rev: state.rev, state: scopedState(id) };
      });
      return sendJson(res, 200, result);
    }
    if (method === 'DELETE') {
      const result = await mutate(() => {
        const process = requireProcess(id);
        if (state.documents.some((doc) => doc.processId === id)) {
          throw new HttpError(409, 'Exclua ou mova os documentos antes de excluir o processo.');
        }
        const docs = new Set(state.documents.filter((doc) => doc.processId === id).map((doc) => doc.id));
        state.processes = state.processes.filter((item) => item.id !== id);
        state.criteria = state.criteria.filter((criterion) => criterion.processId !== id);
        state.checks = state.checks.filter((check) => !docs.has(check.docId));
        log(`Processo removido: ${process.name}`, { processId: null });
        return { rev: state.rev, state: scopedState(processFromRequest(req)) };
      });
      return sendJson(res, 200, result);
    }
  }

  if (pathname === '/api/criteria' && method === 'POST') {
    const body = await readJson(req);
    const process = requireProcess(body.processId);
    const label = text(body.label, 160, 'critério');
    const hint = optionalText(body.hint, 400, 'orientação');
    const result = await mutate(() => {
      const criterion = { id: uid('crit'), processId: process.id, label, hint, order: state.criteria.filter((c) => c.processId === process.id).length };
      state.criteria.push(criterion);
      for (const doc of state.documents.filter((item) => item.processId === process.id)) {
        state.checks.push({
          id: uid('chk'),
          docId: doc.id,
          criterionId: criterion.id,
          status: 'pending',
          note: '',
          updatedAt: now(),
          authorId: null,
        });
      }
      log(`Critério adicionado: ${label}`, { processId: process.id });
      return { rev: state.rev, state: scopedState(process.id) };
    });
    return sendJson(res, 201, result);
  }

  if (pathname === '/api/criteria/copy' && method === 'POST') {
    const body = await readJson(req);
    const target = requireProcess(body.targetProcessId, 'processo de destino');
    const source = requireProcess(body.sourceProcessId, 'processo de origem');
    if (target.id === source.id) throw new HttpError(400, 'Escolha um processo de origem diferente.');
    const ids = Array.isArray(body.criterionIds) ? body.criterionIds.map(String) : null;
    const result = await mutate(() => {
      const sourceCriteria = state.criteria
        .filter((criterion) => criterion.processId === source.id)
        .filter((criterion) => !ids || ids.includes(criterion.id));
      if (!sourceCriteria.length) throw new HttpError(400, 'Nenhum critério selecionado.');
      const existing = new Set(
        state.criteria.filter((criterion) => criterion.processId === target.id).map((criterion) => criterion.label.toLowerCase())
      );
      let order = state.criteria.filter((criterion) => criterion.processId === target.id).length;
      const created = [];
      for (const criterion of sourceCriteria) {
        if (existing.has(criterion.label.toLowerCase())) continue;
        const copy = {
          id: uid('crit'),
          processId: target.id,
          label: criterion.label,
          hint: criterion.hint || '',
          order: order++,
        };
        state.criteria.push(copy);
        existing.add(copy.label.toLowerCase());
        created.push(copy);
        for (const doc of state.documents.filter((item) => item.processId === target.id)) {
          state.checks.push({
            id: uid('chk'),
            docId: doc.id,
            criterionId: copy.id,
            status: 'pending',
            note: '',
            updatedAt: now(),
            authorId: null,
          });
        }
      }
      log(
        `Critérios copiados de ${source.name} para ${target.name}: ${created.length}`,
        { processId: target.id }
      );
      return { rev: state.rev, state: scopedState(target.id), copied: created.length };
    });
    return sendJson(res, 200, result);
  }

  const criteriaReorder = pathname.match(/^\/api\/criteria\/reorder$/);
  if (criteriaReorder && method === 'POST') {
    const body = await readJson(req);
    const ids = Array.isArray(body.ids) ? body.ids.map(String) : null;
    if (!ids) throw new HttpError(400, 'Lista de critérios inválida.');
    const result = await mutate(() => {
      const processId = processFromRequest(req);
      if (!processId) throw new HttpError(400, 'Processo não informado.');
      const byId = new Map(state.criteria.filter((criterion) => criterion.processId === processId).map((criterion) => [criterion.id, criterion]));
      const ordered = ids.map((id) => byId.get(id)).filter(Boolean);
      if (ordered.length !== state.criteria.filter((criterion) => criterion.processId === processId).length) {
        throw new HttpError(400, 'A nova ordem precisa conter todos os critérios do processo.');
      }
      state.criteria = state.criteria.map((criterion) => {
        const index = ordered.findIndex((item) => item.id === criterion.id);
        return index >= 0 ? { ...criterion, order: index } : criterion;
      });
      return { rev: state.rev, state: scopedState(processId) };
    });
    return sendJson(res, 200, result);
  }

  const criterionIdMatch = pathname.match(/^\/api\/criteria\/([^/]+)$/);
  if (criterionIdMatch) {
    const id = decodeURIComponent(criterionIdMatch[1]);
    const criterion = state.criteria.find((item) => item.id === id);
    if (!criterion) throw new HttpError(404, 'Critério não encontrado.');
    if (method === 'PATCH') {
      const body = await readJson(req);
      const result = await mutate(() => {
        if (body.label != null) criterion.label = text(body.label, 160, 'critério');
        if (body.hint != null) criterion.hint = optionalText(body.hint, 400, 'orientação');
        log(`Critério atualizado: ${criterion.label}`, { processId: criterion.processId });
        return { rev: state.rev, state: scopedState(criterion.processId) };
      });
      return sendJson(res, 200, result);
    }
    if (method === 'DELETE') {
      const result = await mutate(() => {
        const processId = criterion.processId;
        state.criteria = state.criteria.filter((item) => item.id !== id);
        state.checks = state.checks.filter((check) => check.criterionId !== id);
        log(`Critério removido: ${criterion.label}`, { processId });
        return { rev: state.rev, state: scopedState(processId) };
      });
      return sendJson(res, 200, result);
    }
  }

  if (pathname === '/api/documents' && method === 'POST') {
    const body = await readJson(req);
    const process = requireProcess(body.processId);
    const name = text(body.name, 220, 'nome do arquivo');
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
    const doc = {
      id,
      processId: process.id,
      name,
      mime: FILE_MIME[ext] || 'application/octet-stream',
      size: buffer.length,
      stored,
      addedAt: now(),
      active: true,
      inactiveReason: '',
    };
    try {
      await fs.writeFile(path.join(FILES_DIR, stored), buffer);
    } catch (err) {
      throw new HttpError(500, `Não foi possível gravar o arquivo: ${err.message}`);
    }
    const result = await mutate(() => {
      state.documents.push(doc);
      for (const criterion of state.criteria.filter((item) => item.processId === process.id)) {
        state.checks.push({
          id: uid('chk'),
          docId: doc.id,
          criterionId: criterion.id,
          status: 'pending',
          note: '',
          updatedAt: now(),
          authorId: null,
        });
      }
      log(`Documento importado: ${name}`, { processId: process.id });
      return { rev: state.rev, state: scopedState(process.id), document: doc };
    });
    return sendJson(res, 201, result);
  }

  const docIdMatch = pathname.match(/^\/api\/documents\/([^/]+)$/);
  if (docIdMatch) {
    const id = decodeURIComponent(docIdMatch[1]);
    const doc = findDoc(id);
    if (!doc) throw new HttpError(404, 'Documento não encontrado.');
    if (method === 'PATCH') {
      const body = await readJson(req);
      const result = await mutate(() => {
        if (body.name != null) doc.name = text(body.name, 220, 'nome do arquivo');
        if (body.active != null) {
          const active = Boolean(body.active);
          if (!active) {
            const reason = text(body.inactiveReason, 500, 'motivo da inatividade');
            doc.active = false;
            doc.inactiveReason = reason;
            doc.inactiveAt = now();
            doc.inactiveBy = requestContext.getStore()?.actor?.id || null;
            log(`Documento inativado: ${doc.name} — ${reason}`, { processId: doc.processId });
          } else {
            doc.active = true;
            doc.inactiveReason = '';
            doc.inactiveAt = null;
            doc.inactiveBy = null;
            log(`Documento reativado: ${doc.name}`, { processId: doc.processId });
          }
        }
        return { rev: state.rev, state: scopedState(doc.processId) };
      });
      return sendJson(res, 200, result);
    }
    if (method === 'DELETE') {
      const result = await mutate(() => {
        state.documents = state.documents.filter((item) => item.id !== id);
        state.checks = state.checks.filter((check) => check.docId !== id);
        const meta = state.meta.lastDocByProcess[doc.processId];
        if (meta === id) delete state.meta.lastDocByProcess[doc.processId];
        log(`Documento removido: ${doc.name}`, { processId: doc.processId });
        return { rev: state.rev, state: scopedState(doc.processId) };
      });
      try {
        await fs.unlink(path.join(FILES_DIR, doc.stored));
      } catch {
        /* arquivo já ausente */
      }
      return sendJson(res, 200, result);
    }
  }

  const checkIdMatch = pathname.match(/^\/api\/checks\/([^/]+)$/);
  if (checkIdMatch && method === 'PATCH') {
    const id = decodeURIComponent(checkIdMatch[1]);
    const body = await readJson(req);
    if (body.status != null && !CHECK_STATUSES.has(body.status)) {
      throw new HttpError(400, 'Resultado de verificação inválido.');
    }
    const note = body.note != null ? optionalText(body.note, 5000, 'nota') : undefined;
    const result = await mutate(() => {
      const check = state.checks.find((item) => item.id === id);
      if (!check) throw new HttpError(404, 'Verificação não encontrada.');
      const doc = findDoc(check.docId);
      if (!doc) throw new HttpError(404, 'Documento da verificação não encontrado.');
      if (doc.active === false) throw new HttpError(409, 'Documento inativo: reative para editar verificações.');
      const previous = check.status;
      const previousNote = check.note || '';
      if (body.status != null) check.status = body.status;
      if (note !== undefined) check.note = note;
      check.updatedAt = now();
      const actor = requestContext.getStore()?.actor;
      if (actor) check.authorId = actor.id;
      const contentChanged = previous !== check.status || (note !== undefined && note !== previousNote);
      // Revisão: verificação feita pelo revisor é auto-aprovada; alteração do
      // analista em check aprovado/sinalizado devolve o check para a revisão.
      if (check.status !== 'pending') {
        if (actor?.role === 'reviewer') {
          if (contentChanged || check.review?.status !== 'approved') {
            setReview(check, 'approved', actor, { auto: true });
          }
        } else if (contentChanged && (check.review?.status === 'approved' || check.review?.status === 'flagged')) {
          setReview(check, 'pending', actor, {});
        }
      } else if (check.review?.status !== 'pending') {
        setReview(check, 'pending', actor, {});
      }
      state.meta.lastDocByProcess[doc.processId] = check.docId;
      state.meta.lastCheckId = check.id;
      const criterion = state.criteria.find((item) => item.id === check.criterionId);
      if (body.status != null && previous !== check.status) {
        const statusLabels = {
          ok: 'Conforme',
          nc: 'Não conforme',
          obs: 'Observação',
          pending: 'Verificação reaberta',
        };
        log(`${statusLabels[check.status] || check.status}: ${doc.name} — ${criterion?.label || 'critério'}`, {
          processId: doc.processId,
        });
      }
      return {
        rev: state.rev,
        check: { ...check },
        docReview: docReview(doc),
        activity: scopedActivity(doc.processId, 40),
      };
    });
    return sendJson(res, 200, result);
  }

  if (pathname === '/api/review/approve' && method === 'POST') {
    const body = await readJson(req);
    const doc = findDoc(String(body.docId || ''));
    if (!doc) throw new HttpError(404, 'Documento não encontrado.');
    const actor = requireReviewer(requestContext.getStore()?.actor);
    const message = optionalText(body.message, 2000, 'mensagem da aprovação');
    const result = await mutate(() => {
      if (doc.active === false) {
        throw new HttpError(409, 'Documento inativo: a dispensa tem fluxo próprio de revisão.');
      }
      const checks = state.checks.filter((check) => check.docId === doc.id);
      const done = checks.filter((check) => check.status !== 'pending');
      if (!checks.length) throw new HttpError(409, 'Documento sem verificações para revisar.');
      if (done.length < checks.length) {
        throw new HttpError(409, 'Ainda há verificações pendentes: o documento não está pronto para revisão.');
      }
      const flagged = done.filter((check) => check.review?.status === 'flagged');
      if (flagged.length) {
        throw new HttpError(
          409,
          'Há critérios sinalizados: o analista precisa corrigir e devolver o documento à revisão antes da aprovação.'
        );
      }
      done.forEach((check) => setReview(check, 'approved', actor, { note: message }));
      log(`Documento aprovado${message ? `: “${message}”` : ''}: ${doc.name}`, { processId: doc.processId });
      return {
        rev: state.rev,
        state: scopedState(doc.processId),
        review: docReview(doc),
        activity: scopedActivity(doc.processId, 40),
      };
    });
    return sendJson(res, 200, result);
  }

  if (pathname === '/api/review/flag' && method === 'POST') {
    const body = await readJson(req);
    const doc = findDoc(String(body.docId || ''));
    if (!doc) throw new HttpError(404, 'Documento não encontrado.');
    const actor = requireReviewer(requestContext.getStore()?.actor);
    const check = state.checks.find((item) => item.id === String(body.checkId || ''));
    if (!check || check.docId !== doc.id) {
      throw new HttpError(404, 'Verificação não encontrada neste documento.');
    }
    const message = text(body.message, 2000, 'mensagem da sinalização');
    const result = await mutate(() => {
      if (doc.active === false) throw new HttpError(409, 'Documento inativo: não há o que sinalizar.');
      if (check.status === 'pending') {
        throw new HttpError(409, 'Só é possível sinalizar verificações já avaliadas.');
      }
      if (body.checkVersion && check.updatedAt && body.checkVersion !== check.updatedAt) {
        throw new HttpError(409, 'A verificação mudou desde que você abriu o documento. Recarregue e revise de novo.');
      }
      state.checks
        .filter((item) => item.docId === doc.id && item.id !== check.id)
        .filter((item) => item.status !== 'pending' && item.review?.status !== 'flagged')
        .forEach((item) => {
          if (item.review?.status !== 'approved') setReview(item, 'approved', actor, { auto: true });
        });
      setReview(check, 'flagged', actor, { note: message });
      const criterion = state.criteria.find((item) => item.id === check.criterionId);
      log(`Critério sinalizado (${criterion?.label || 'critério'}): ${message}`, { processId: doc.processId });
      return {
        rev: state.rev,
        state: scopedState(doc.processId),
        review: docReview(doc),
        activity: scopedActivity(doc.processId, 40),
      };
    });
    return sendJson(res, 200, result);
  }

  if (pathname === '/api/presence' && method === 'POST') {
    const body = await readJson(req);
    const actor = requestContext.getStore()?.actor;
    const processId = processFromRequest(req);
    if (!actor || !processId) return sendJson(res, 200, { present: [] });
    const requested = body.docId ? String(body.docId) : null;
    const doc = requested ? findDoc(requested) : null;
    const docId = doc && doc.processId === processId ? doc.id : null;
    if (docId) {
      presence.set(`${processId}:${actor.id}`, {
        processId,
        actorId: actor.id,
        actorName: actor.name,
        docId,
        at: Date.now(),
      });
    } else {
      presence.delete(`${processId}:${actor.id}`);
    }
    return sendJson(res, 200, { present: presenceFor(processId, actor.id) });
  }

  if (pathname === '/api/meta' && method === 'POST') {
    const body = await readJson(req);
    const process = requireProcess(body.processId);
    const result = await mutate(() => {
      if (body.lastDocId !== undefined) {
        const id = body.lastDocId == null ? null : String(body.lastDocId);
        const doc = id ? findDoc(id) : null;
        if (doc && doc.processId === process.id) state.meta.lastDocByProcess[process.id] = id;
        else delete state.meta.lastDocByProcess[process.id];
      }
      return { rev: state.rev, state: scopedState(process.id) };
    });
    return sendJson(res, 200, result);
  }

  if (pathname === '/api/export' && method === 'GET') {
    const process = processFromRequest(req);
    const payload = process
      ? {
          schemaVersion: 2,
          exportedAt: now(),
          processId: process,
          state,
        }
      : state;
    const body = JSON.stringify(payload, null, 2);
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="scad-backup-${new Date().toISOString().slice(0, 10)}.json"`,
      'Cache-Control': 'no-store',
    });
    return res.end(body);
  }

  if (pathname === '/api/import' && method === 'POST') {
    const body = await readJson(req);
    const incoming = body.state?.state || body.state || body;
    if (!incoming || typeof incoming !== 'object') throw new HttpError(400, 'Backup inválido.');
    const result = await mutate(() => {
      state = incoming.schemaVersion >= 2 ? normalizeState(incoming) : migrateV1(incoming);
      state.rev = (Number(incoming.rev) || 1) + 1;
      state.updatedAt = now();
      log('Backup restaurado', { processId: null });
      return { rev: state.rev, state: scopedState(null) };
    });
    return sendJson(res, 200, result);
  }

  if (pathname === '/api/reset' && method === 'POST') {
    const body = await readJson(req);
    if (body.confirm !== true) throw new HttpError(400, 'Confirmação ausente.');
    const result = await mutate(() => {
      const profiles = state.profiles;
      state = emptyState();
      state.profiles = profiles;
      state.rev = 1;
      log('Dados reiniciados', { processId: null });
      return { rev: state.rev, state: scopedState(null) };
    });
    try {
      const entries = await fs.readdir(FILES_DIR);
      await Promise.all(entries.map((entry) => fs.rm(path.join(FILES_DIR, entry), { force: true })));
    } catch {
      /* pasta vazia */
    }
    return sendJson(res, 200, result);
  }

  throw new HttpError(404, 'Rota de API não encontrada.');
}

/* --------------------------------------------------------------- arquivos */

async function serveFile(req, res, stored) {
  const doc = state.documents.find((item) => item.stored === stored);
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

const server = http.createServer((req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  const actor = actorFrom(req);
  const processId = processFromRequest(req);
  requestContext.run({ actor, processId }, async () => {
    try {
      const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
      const pathname = url.pathname;
      if (pathname.startsWith('/api/')) {
        await handleApi(req, res, pathname, url);
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
});

async function backupBeforeMigration(label) {
  try {
    await fs.mkdir(BACKUP_DIR, { recursive: true });
    const target = path.join(BACKUP_DIR, `db-${label}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
    await fs.copyFile(DB_PATH, target);
    console.log(`[scad] backup pré-migração: ${target}`);
    const entries = (await fs.readdir(BACKUP_DIR)).filter((name) => name.endsWith('.json')).sort();
    while (entries.length > 8) {
      const old = entries.shift();
      await fs.rm(path.join(BACKUP_DIR, old), { force: true });
    }
  } catch (err) {
    console.error('[scad] não foi possível criar backup pré-migração:', err.message);
  }
}

async function boot() {
  await fs.mkdir(FILES_DIR, { recursive: true });
  let parsed = null;
  let readError = null;
  try {
    parsed = JSON.parse(await fs.readFile(DB_PATH, 'utf8'));
  } catch (err) {
    readError = err;
  }

  if (!parsed) {
    if (readError && readError.code !== 'ENOENT') {
      await backupBeforeMigration('corrupt');
    }
    state = emptyState();
    await persist();
  } else if ((parsed.schemaVersion || 1) < 2) {
    await backupBeforeMigration('v1');
    state = normalizeState(migrateV1(parsed));
    await persist();
    console.log('[scad] migração v1 → v2 concluída.');
  } else {
    state = normalizeState(parsed);
  }

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`\nA porta ${PORT} já está em uso. Feche o outro SCAD ou rode: node server.mjs 4180\n`);
    } else {
      console.error('Falha no servidor:', err);
    }
    process.exit(1);
  });

  setInterval(prunePresence, 30000).unref();

  server.listen(PORT, HOST, () => {
    const lan = lanUrls();
    const line = '─'.repeat(58);
    console.log(`\n\x1b[38;5;110m${line}\x1b[0m`);
    console.log('  \x1b[1mSCAD\x1b[0m · Coleções e Processos');
    console.log(`  v${VERSION} · schema ${state.schemaVersion} · dados em ${DATA_DIR}`);
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
