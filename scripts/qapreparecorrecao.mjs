/**
 * Prepara o ambiente de QA para o teste de UI da correção (porta 4188, dados copiados).
 * Deixa o documento DOC com uma versão arquivada e uma correção pendente,
 * além de um documento aprovado extra para a gaveta "Adicionar correção".
 * Uso: node scripts/qapreparecorrecao.mjs [porta] [docId]
 */
import fs from 'node:fs/promises';

const PORT = process.argv[2] || '4188';
const BASE = `http://127.0.0.1:${PORT}`;
const DOC = process.argv[3] || 'doc_166e6e87fa';
const QA = new URL('../.qa-correcao/files/', import.meta.url);

if (!BASE.includes('4188')) {
  console.error('ABORTADO: este preparo é só para a instância de QA (4188).');
  process.exit(2);
}

const state0 = await (
  await fetch(`${BASE}/api/state?processId=prc_3c8d4787da`, { headers: { 'X-SCAD-Actor': 'usr_sergio' } })
).json();
const PID = state0.process?.id;
const pdfData = async (name) => (await fs.readFile(new URL(name, QA))).toString('base64');

async function call(method, path, body, actor) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-SCAD-Actor': actor, 'X-SCAD-Process': PID },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* vazio */
  }
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${text.slice(0, 160)}`);
  return json;
}

/* 1) promove uma primeira correção, para o documento ter histórico de versões */
if (!(state0.documents.find((doc) => doc.id === DOC)?.versions || []).length) {
  await call('POST', `/api/documents/${DOC}/correction`, {
    name: 'DC 0001 - Assistente de Logistica (rev.1).pdf',
    data: await pdfData('doc_0ad642a741.pdf'),
  }, 'usr_sergio');
  await call('POST', '/api/review/approve', { docId: DOC }, 'usr_diogenes');
  console.log('versão v2 promovida (histórico com 1 arquivada)');
}

/* 2) deixa uma correção pendente para a comparação */
const state1 = await (await fetch(`${BASE}/api/state?processId=${PID}`, { headers: { 'X-SCAD-Actor': 'usr_sergio' } })).json();
const doc1 = state1.documents.find((doc) => doc.id === DOC);
if (!doc1.correction) {
  await call('POST', `/api/documents/${DOC}/correction`, {
    name: 'DC 0001 - Assistente de Logistica (rev.2).pdf',
    data: await pdfData('doc_0eb8ed20ce.pdf'),
  }, 'usr_sergio');
  console.log('correção pendente criada');
}

/* 3) documento aprovado extra, sem correção, para a gaveta */
const extraReady = state1.documents.some(
  (doc) => doc.id !== DOC && doc.itemKind !== 'item' && !doc.correction && doc.review?.status === 'approved'
);
if (!extraReady) {
  const created = await call('POST', '/api/documents', {
    processId: PID,
    name: 'POP 0002 - Inspecao de recebimento.pdf',
    data: await pdfData('doc_3c70b4dede.pdf'),
  }, 'usr_sergio');
  const fresh = (created.state.documents || []).find((doc) => doc.name === 'POP 0002 - Inspecao de recebimento.pdf');
  for (const check of (created.state.checks || []).filter((check) => check.docId === fresh.id)) {
    await call('PATCH', `/api/checks/${check.id}`, { status: 'ok' }, 'usr_sergio');
  }
  await call('POST', '/api/review/approve', { docId: fresh.id }, 'usr_diogenes');
  console.log(`documento aprovado extra: ${fresh.id}`);
}

const final = await (await fetch(`${BASE}/api/state?processId=${PID}`, { headers: { 'X-SCAD-Actor': 'usr_sergio' } })).json();
const doc = final.documents.find((item) => item.id === DOC);
console.log(JSON.stringify({
  nome: doc.name,
  revisao: doc.review?.status,
  correcao: Boolean(doc.correction),
  correcaoVersao: 2 + (doc.versions || []).length,
  arquivadas: (doc.versions || []).length,
}, null, 1));
