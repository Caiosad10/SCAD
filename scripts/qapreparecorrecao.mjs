/**
 * Prepara o ambiente de QA para o teste de UI da correção (porta 4188, dados copiados).
 * Deixa o documento DOC com uma versão arquivada e uma correção pendente,
 * além de um documento aprovado extra para a gaveta "Adicionar correção"
 * e um par de .docx com diferenças conhecidas para a comparação de texto.
 * Uso: node scripts/qapreparecorrecao.mjs [porta] [docId]
 */
import fs from 'node:fs/promises';
import { docxDeTexto } from './mkdocx.mjs';

const PORT = process.argv[2] || '4188';
const BASE = `http://127.0.0.1:${PORT}`;
const DOC = process.argv[3] || 'doc_166e6e87fa';
const QA = new URL('../.qa-correcao/files/', import.meta.url);
const PALAVRA_NOME = 'IT 0002 - Inspecao de recebimento.docx';

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

/* 4) par de .docx com diferenças conhecidas: é o cenário do "O que mudou" */
const V1 = [
  'IT 0002 - Instrução de trabalho: inspeção de recebimento',
  '1. Objetivo',
  'Definir como o almoxarifado inspeciona o material recebido dos fornecedores.',
  '2. Responsabilidades',
  'O almoxarife confere a nota fiscal e o romaneio na chegada da carga.',
  '3. Prazo',
  'O registro da inspeção deve ser feito em até três dias uteis.',
  '4. Registro',
  'O comprovante fica arquivado no processo do fornecedor.',
];
const V2 = [
  'IT 0002 - Instrução de trabalho: inspeção de recebimento',
  '1. Objetivo',
  'Definir como o almoxarifado inspeciona o material recebido dos fornecedores.',
  '2. Responsabilidades',
  'O almoxarife confere a nota fiscal, o romaneio e o certificado de qualidade na chegada da carga.',
  '3. Prazo',
  'O registro da inspeção deve ser feito em até um dia util.',
  '4. Registro',
  'O comprovante fica arquivado no processo do fornecedor.',
  '5. Anexos',
  'Anexar o certificado de qualidade assinado pelo fornecedor.',
];

let wordDoc = (final.documents || []).find((item) => item.name === PALAVRA_NOME);
if (!wordDoc) {
  const created = await call('POST', '/api/documents', {
    processId: PID,
    name: PALAVRA_NOME,
    data: docxDeTexto(V1).toString('base64'),
  }, 'usr_sergio');
  wordDoc = (created.state.documents || []).find((item) => item.name === PALAVRA_NOME);
  for (const check of (created.state.checks || []).filter((item) => item.docId === wordDoc.id)) {
    await call('PATCH', `/api/checks/${check.id}`, { status: 'ok' }, 'usr_sergio');
  }
  await call('POST', '/api/review/approve', { docId: wordDoc.id }, 'usr_diogenes');
  console.log(`documento Word criado e aprovado: ${wordDoc.id}`);
}
const wordNow = (await (await fetch(`${BASE}/api/state?processId=${PID}`, { headers: { 'X-SCAD-Actor': 'usr_sergio' } })).json())
  .documents.find((item) => item.id === wordDoc.id);
if (!wordNow.correction) {
  await call('POST', `/api/documents/${wordDoc.id}/correction`, {
    name: PALAVRA_NOME,
    data: docxDeTexto(V2).toString('base64'),
  }, 'usr_sergio');
  console.log(`correção Word pendente: ${wordDoc.id}`);
}

console.log(JSON.stringify({
  nome: doc.name,
  revisao: doc.review?.status,
  correcao: Boolean(doc.correction),
  correcaoVersao: 2 + (doc.versions || []).length,
  arquivadas: (doc.versions || []).length,
  word: wordDoc.id,
}, null, 1));
