/**
 * Teste de fumaça da API do SCAD.
 *
 * Sem argumentos, sobe um servidor descartável em .tmp-data:4199, testa e limpa tudo.
 * Com argumento, testa o servidor informado — ATENÇÃO: ele reinicia os dados no fim.
 *
 * Uso: node scripts/smoke.mjs [http://127.0.0.1:4177]
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';

const explicit = process.argv[2] || process.env.SCAD_URL;
const PORT = 4199;
const base = explicit || `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let child = null;
let tmpDir = null;

async function waitForServer() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`${base}/api/health`);
      if (response.ok) return;
    } catch {
      /* ainda subindo */
    }
    await sleep(150);
  }
  throw new Error(`Servidor não respondeu em ${base}`);
}

async function call(method, url, body) {
  const response = await fetch(`${base}${url}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* resposta binária */
  }
  return { status: response.status, json, text, headers: response.headers };
}

const results = [];
function check(name, fn) {
  try {
    fn();
    results.push({ name, ok: true });
    console.log(`  ok   ${name}`);
  } catch (err) {
    results.push({ name, ok: false, err });
    console.error(`  FAIL ${name}\n       ${err.message}`);
  }
}

async function run() {
  if (!explicit) {
    tmpDir = path.join(process.cwd(), '.tmp-data');
    await fs.rm(tmpDir, { recursive: true, force: true });
    child = spawn(process.execPath, ['server.mjs', String(PORT)], {
      cwd: process.cwd(),
      env: { ...process.env, SCAD_DATA: tmpDir, PORT: String(PORT) },
      stdio: 'ignore',
      windowsHide: true,
    });
    await waitForServer();
  }

  const health = await call('GET', '/api/health');
  check('health 200', () => assert.equal(health.status, 200));
  check('health informa app e versão', () => {
    assert.equal(health.json.app, 'scad');
    assert.ok(health.json.version);
  });

  let state = (await call('GET', '/api/state')).json;
  check('estado inicial vazio', () => {
    assert.equal(state.process, null);
    assert.equal(state.documents.length, 0);
  });

  const created = await call('POST', '/api/process', {
    name: 'Processo de teste',
    description: 'Criado pelo smoke test',
    criteria: [{ label: 'Legibilidade' }, { label: 'Vigência' }, { label: 'Assinatura' }],
  });
  check('criar processo 201', () => assert.equal(created.status, 201));
  state = created.json.state;
  check('processo com 3 critérios', () => assert.equal(state.criteria.length, 3));

  const content = Buffer.from('Documento de teste do SCAD').toString('base64');
  const uploaded = await call('POST', '/api/documents', {
    name: 'contrato-teste.pdf',
    mime: 'application/pdf',
    data: content,
  });
  check('upload de documento 201', () => assert.equal(uploaded.status, 201));
  state = uploaded.json.state;
  const doc = state.documents[0];
  check('documento gera um check por critério', () => {
    assert.equal(state.checks.length, 3);
    assert.ok(state.checks.every((c) => c.docId === doc.id && c.status === 'pending'));
  });

  const file = await fetch(`${base}/files/${doc.stored}`);
  const fileText = await file.text();
  check('arquivo servido pela rota /files', () => assert.equal(file.status, 200));
  check('conteúdo do arquivo preservado', () => assert.equal(fileText, 'Documento de teste do SCAD'));

  const firstCheck = state.checks[0];
  const patched = await call('PATCH', `/api/checks/${firstCheck.id}`, {
    status: 'nc',
    note: 'Assinatura ausente na página 2',
  });
  check('PATCH de check 200', () => assert.equal(patched.status, 200));
  check('PATCH devolve o check atualizado', () => {
    assert.equal(patched.json.check.status, 'nc');
    assert.equal(patched.json.check.note, 'Assinatura ausente na página 2');
  });
  check('rev incrementou', () => assert.ok(patched.json.rev > created.json.rev));

  const newCriterion = await call('POST', '/api/criteria', { label: 'Carimbo' });
  check('novo critério 201', () => assert.equal(newCriterion.status, 201));
  state = newCriterion.json.state;
  check('novo critério cria check pendente no documento existente', () => {
    assert.equal(state.checks.length, 4);
    const added = state.criteria.find((c) => c.label === 'Carimbo');
    assert.ok(state.checks.some((c) => c.criterionId === added.id && c.status === 'pending'));
  });

  const removedCriterionId = state.criteria[0].id;
  const deleted = await call('DELETE', `/api/criteria/${removedCriterionId}`);
  state = deleted.json.state;
  check('excluir critério remove só os checks dele', () => {
    assert.equal(state.checks.length, 3);
    assert.ok(state.checks.every((c) => c.criterionId !== removedCriterionId));
  });

  const exported = await call('GET', '/api/export');
  check('export JSON tem cabeçalho de download', () => {
    assert.equal(exported.status, 200);
    assert.match(exported.headers.get('content-disposition') || '', /attachment/);
  });

  const bad = await call('POST', '/api/process', { name: 'x', criteria: [] });
  check('rejeita processo sem critérios', () => assert.equal(bad.status, 400));

  const reset = await call('POST', '/api/reset', { confirm: true });
  check('reset limpa o estado', () => {
    assert.equal(reset.status, 200);
    assert.equal(reset.json.state.process, null);
    assert.equal(reset.json.state.documents.length, 0);
  });

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} verificações ok`);
  if (failed.length) process.exitCode = 1;
}

try {
  await run();
} catch (err) {
  console.error(err);
  process.exitCode = 1;
} finally {
  if (child) {
    child.kill();
    await sleep(350);
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    await fs.rm(path.join(tmpDir, 'db.json'), { force: true }).catch(() => {});
  }
}
