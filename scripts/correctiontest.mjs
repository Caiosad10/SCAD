/**
 * Testa a correção com versionamento e a reabertura de revisão (v2.3).
 * Roda contra um servidor de QA (nunca a produção): `node scripts/correctiontest.mjs 4188`.
 */
const BASE = `http://127.0.0.1:${process.argv[2] || '4188'}`;
const SERGIO = 'usr_sergio';
const DIOGENES = 'usr_diogenes';

let failures = 0;
function check(name, condition, detail = '') {
  if (condition) {
    console.log(`  ok   ${name}`);
  } else {
    failures += 1;
    console.error(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

async function call(method, path, body, actor = SERGIO, process = null) {
  const headers = { 'X-SCAD-Actor': actor };
  if (process) headers['X-SCAD-Process'] = process;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const raw = await res.text();
  let json = null;
  try {
    json = JSON.parse(raw);
  } catch {
    /* corpo vazio ou binário */
  }
  return { status: res.status, json, raw };
}

const b64 = (texto) => Buffer.from(texto, 'utf8').toString('base64');

/* ------------------------------------------------------------- sanidade */
const health = await call('GET', '/api/health');
check(
  'QA na 4188 rodando a v2.3.x',
  health.json?.port === 4188 && /^2\.3\./.test(health.json?.version || ''),
  JSON.stringify(health.json)
);
if (health.json?.port === 4177) {
  console.error('ABORTADO: este script não roda na produção (4177).');
  process.exit(2);
}

const PID = process.argv[3];
if (!PID) {
  console.error('Uso: node scripts/correctiontest.mjs <porta> <processId>');
  process.exit(2);
}

const state0 = (await call('GET', `/api/state?processId=${encodeURIComponent(PID)}`)).json;
console.log(`processo: ${state0.process?.name} (${PID})`);

/* ------------------------------------------------- documento de trabalho */
/* Documento próprio: o teste não depende do que já está no processo. */
const ALVO = `qa-correcao-alvo-${Date.now()}.txt`;
let res = await call('POST', '/api/documents', { processId: PID, name: ALVO, data: b64('versao 1 do documento de teste') }, SERGIO, PID);
check('documento de trabalho criado (201)', res.status === 201, `status ${res.status} ${res.raw?.slice(0, 140)}`);
let target = (res.json?.state?.documents || []).find((doc) => doc.name === ALVO);
if (!target) {
  console.error('FAIL não consegui criar o documento de trabalho.');
  process.exit(1);
}
for (const alvoCheck of (res.json?.state?.checks || []).filter((item) => item.docId === target.id)) {
  await call('PATCH', `/api/checks/${alvoCheck.id}`, { status: 'ok' }, SERGIO, PID);
}
res = await call('POST', '/api/review/approve', { docId: target.id }, DIOGENES, PID);
check('documento de trabalho aprovado', res.status === 200, `status ${res.status}`);
target = (res.json?.state?.documents || []).find((doc) => doc.id === target.id);

const start = { stored: target.stored, name: target.name, size: target.size };
const fetchState = async () =>
  (await call('GET', `/api/state?processId=${encodeURIComponent(PID)}`, undefined, SERGIO, PID)).json;
const docIn = (s, id = target.id) => (s?.documents || []).find((doc) => doc.id === id);

console.log(`\ndocumento: ${start.name} (${target.id}) · estado ${target.review?.status}`);

/* ------------------------------------------------------- envio da correção */
res = await call(
  'POST',
  `/api/documents/${target.id}/correction`,
  { name: 'teste-correcao-v2.txt', data: b64('versao 2 do documento de teste') },
  SERGIO,
  PID
);
check('analista envia correção (201)', res.status === 201, `status ${res.status} ${res.raw?.slice(0, 140)}`);
let doc = docIn(res.json?.state);
check('documento guarda a correção pendente', Boolean(doc?.correction), JSON.stringify(doc?.correction)?.slice(0, 120));
check('correção registra o autor', doc?.correction?.by === SERGIO && doc?.correction?.byName === 'Sergio');
check('estado de revisão vira "aguardando"', doc?.review?.status === 'awaiting', doc?.review?.status);
check('revisão marca correção pendente', doc?.review?.correction === true);
check(
  'atividade registra a correção',
  (res.json?.activity || []).some((item) => item.text.includes('Correção enviada (v2)')),
  (res.json?.activity || []).map((item) => item.text).slice(0, 3).join(' | ')
);

res = await call(
  'POST',
  `/api/documents/${target.id}/correction`,
  { name: 'outra.txt', data: b64('segunda correção') },
  SERGIO,
  PID
);
check('segunda correção pendente é recusada (409)', res.status === 409, `status ${res.status}`);

/* ------------------------------- "O que mudou" escrito por quem corrigiu */
res = await call(
  'PATCH',
  `/api/documents/${target.id}/correction`,
  { changeNote: 'Removi o item 4.2 e corrigi o prazo.' },
  DIOGENES,
  PID
);
check('outra pessoa não descreve o que mudou (403)', res.status === 403, `status ${res.status}`);

res = await call('PATCH', `/api/documents/${target.id}/correction`, { changeNote: '  ' }, SERGIO, PID);
check('relato vazio é aceito e limpa o campo (200)', res.status === 200 && !docIn(res.json?.state)?.correction?.changeNote, `status ${res.status}`);

res = await call('PATCH', `/api/documents/${target.id}/correction`, { changeNote: 42 }, SERGIO, PID);
check('relato que não é texto é recusado (400)', res.status === 400, `status ${res.status}`);

res = await call('PATCH', `/api/documents/${target.id}/correction`, { changeNote: 'x'.repeat(1300) }, SERGIO, PID);
check('relato acima de 1200 caracteres é recusado (400)', res.status === 400, `status ${res.status} ${res.raw?.slice(0, 120)}`);

const RELATO = 'Removi o item 4.2 e corrigi o prazo de 30 para 15 dias.';
res = await call('PATCH', `/api/documents/${target.id}/correction`, { changeNote: RELATO }, SERGIO, PID);
check('autor descreve o que mudou depois de enviar (200)', res.status === 200, `status ${res.status} ${res.raw?.slice(0, 140)}`);
doc = docIn(res.json?.state);
check('correção guarda o relato', doc?.correction?.changeNote === RELATO, JSON.stringify(doc?.correction)?.slice(0, 160));
check(
  'atividade registra o relato',
  (res.json?.activity || []).some((item) => item.text.includes('relato do que mudou')),
  (res.json?.activity || []).map((item) => item.text).slice(0, 3).join(' | ')
);

res = await call('POST', '/api/review/reopen', { docId: target.id, reason: 'teste' }, DIOGENES, PID);
check('reabrir com correção pendente e sem aprovação é recusado (409)', res.status === 409, `status ${res.status}`);

res = await call('DELETE', `/api/documents/${target.id}/correction`, undefined, DIOGENES, PID);
check('outra pessoa não remove a correção (403)', res.status === 403, `status ${res.status}`);

res = await call('POST', '/api/review/reopen', { docId: target.id, reason: 'x' }, SERGIO, PID);
check('analista não reabre revisão (403)', res.status === 403, `status ${res.status}`);

res = await call('POST', '/api/review/approve', { docId: target.id }, SERGIO, PID);
check('analista não aprova (403)', res.status === 403, `status ${res.status}`);

/* --------------------------------------------------- aprovação promove v2 */
const correctionStored = doc?.correction?.stored;
res = await call('POST', '/api/review/approve', { docId: target.id, message: 'ok teste' }, DIOGENES, PID);
check('revisor aprova a correção (200)', res.status === 200, `status ${res.status} ${res.raw?.slice(0, 160)}`);
doc = docIn(res.json?.state);
check('arquivo atual vira o corrigido', doc?.stored === correctionStored, `${doc?.stored} vs ${correctionStored}`);
check('nome acompanha o arquivo corrigido', doc?.name === 'teste-correcao-v2.txt', doc?.name);
check('correção pendente é limpa', !doc?.correction);
check('versão anterior vai para o histórico', doc?.versions?.length === 1, JSON.stringify(doc?.versions)?.slice(0, 140));
check('versão arquivada é o arquivo original', doc?.versions?.[0]?.stored === start.stored);
check('versão arquivada guarda quem substituiu', doc?.versions?.[0]?.replacedByName === 'Diogenes');
check('versão arquivada guarda o relato do que mudou', doc?.versions?.[0]?.changeNote === RELATO, JSON.stringify(doc?.versions?.[0])?.slice(0, 200));
check(
  'atividade registra o relato na aprovação',
  (res.json?.activity || []).some((item) => item.text.includes('o que mudou:')),
  (res.json?.activity || []).map((item) => item.text).slice(0, 4).join(' | ')
);

const resSemCorrecao = await call('PATCH', `/api/documents/${target.id}/correction`, { changeNote: 'x' }, SERGIO, PID);
check('sem correção pendente, relato é recusado (409)', resSemCorrecao.status === 409, `status ${resSemCorrecao.status}`);
check('documento volta a aprovado', doc?.review?.status === 'approved', doc?.review?.status);
check('revisão conta a versão arquivada', doc?.review?.versions === 1, String(doc?.review?.versions));
check(
  'atividade registra a promoção',
  (res.json?.activity || []).some((item) => item.text.includes('correção v2 promovida')),
  (res.json?.activity || []).map((item) => item.text).slice(0, 3).join(' | ')
);

res = await call('GET', `/files/${start.stored}`);
check('arquivo original continua servido (200)', res.status === 200, `status ${res.status}`);

/* ------------------------------------------------------- reabrir revisão */
res = await call('POST', '/api/review/reopen', { docId: target.id }, DIOGENES, PID);
check('reabrir sem motivo é recusado (400)', res.status === 400, `status ${res.status}`);

res = await call(
  'POST',
  '/api/review/reopen',
  { docId: target.id, reason: 'Auditoria apontou divergência na cláusula 4.2.' },
  DIOGENES,
  PID
);
check('revisor reabre a revisão (200)', res.status === 200, `status ${res.status} ${res.raw?.slice(0, 160)}`);
doc = docIn(res.json?.state);
check('documento guarda a reabertura', doc?.reopen?.reason?.includes('Auditoria'), JSON.stringify(doc?.reopen));
check('reabertura registra o autor', doc?.reopen?.byName === 'Diogenes');
check('checks voltam a aguardar aprovação', doc?.review?.status === 'awaiting', doc?.review?.status);
const reopenedChecks = (res.json?.state?.checks || []).filter((check) => check.docId === target.id);
check(
  'verificações mantêm o status e perdem a aprovação',
  reopenedChecks.every((check) => check.review?.status === 'pending' && check.status !== 'pending'),
  reopenedChecks.map((check) => `${check.status}/${check.review?.status}`).join(' ')
);
check(
  'atividade registra a reabertura com motivo',
  (res.json?.activity || []).some((item) => item.text.includes('Revisão reaberta por Diogenes')),
  (res.json?.activity || []).map((item) => item.text).slice(0, 3).join(' | ')
);

res = await call('POST', '/api/review/approve', { docId: target.id }, DIOGENES, PID);
check('revisor reaprova depois da reabertura (200)', res.status === 200, `status ${res.status}`);
doc = docIn(res.json?.state);
check('reabertura é limpa na aprovação', !doc?.reopen);
check('documento aprovado de novo', doc?.review?.status === 'approved', doc?.review?.status);
check(
  'atividade registra aprovação após reabertura',
  (res.json?.activity || []).some((item) => item.text.includes('revisão reaberta por Diogenes aprovada')),
  (res.json?.activity || []).map((item) => item.text).slice(0, 3).join(' | ')
);

/* -------------------------------------------------------- correção v3 + lixo */
const RELATO_V3 = 'Troquei a tabela de prazos e ajustei o nome do responsável.';
res = await call(
  'POST',
  `/api/documents/${target.id}/correction`,
  { name: 'teste-correcao-v3.txt', data: b64('versao 3'), changeNote: RELATO_V3 },
  SERGIO,
  PID
);
check('nova correção usa a versão 3 (201)', res.status === 201, `status ${res.status}`);
doc = docIn(res.json?.state);
check('relato pode vir junto com o envio', doc?.correction?.changeNote === RELATO_V3, JSON.stringify(doc?.correction)?.slice(0, 160));
check('atividade anuncia a v3', (res.json?.activity || []).some((item) => item.text.includes('Correção enviada (v3)')));

res = await call('POST', '/api/review/approve', { docId: target.id }, DIOGENES, PID);
doc = docIn(res.json?.state);
check('segunda promoção empilha mais uma versão', doc?.versions?.length === 2, String(doc?.versions?.length));
check('histórico fica em ordem (v1, v2)', doc?.versions?.[0]?.stored === start.stored && doc?.versions?.[1]?.stored === correctionStored);
check('cada versão guarda o próprio relato', doc?.versions?.[1]?.changeNote === RELATO_V3, JSON.stringify(doc?.versions?.[1])?.slice(0, 160));
check('o relato da v1 continua na v1', doc?.versions?.[0]?.changeNote === RELATO, JSON.stringify(doc?.versions?.[0])?.slice(0, 160));

/* ------------------------------------------------------------ documento novo */
res = await call(
  'POST',
  '/api/documents',
  { processId: PID, name: 'qa-correcao-apagar.txt', data: b64('arquivo novo para teste de exclusão') },
  SERGIO,
  PID
);
check('documento novo criado (201)', res.status === 201, `status ${res.status} ${res.raw?.slice(0, 120)}`);
const fresh = (res.json?.state?.documents || []).find((doc) => doc.name === 'qa-correcao-apagar.txt');
check('documento novo tem checks pendentes', Boolean(fresh));

if (fresh) {
  const freshChecks = (res.json?.state?.checks || []).filter((check) => check.docId === fresh.id);
  for (const check of freshChecks) {
    await call('PATCH', `/api/checks/${check.id}`, { status: 'ok' }, SERGIO, PID);
  }
  res = await call('POST', '/api/review/approve', { docId: fresh.id }, DIOGENES, PID);
  check('documento novo aprovado', res.status === 200, `status ${res.status}`);
  res = await call(
    'POST',
    `/api/documents/${fresh.id}/correction`,
    { name: 'qa-correcao-apagar-v2.txt', data: b64('correção do documento novo') },
    SERGIO,
    PID
  );
  const freshCorrection = docIn(res.json?.state, fresh.id)?.correction?.stored;
  check('correção do documento novo enviada', res.status === 201 && Boolean(freshCorrection), `status ${res.status}`);
  res = await call('POST', '/api/review/approve', { docId: fresh.id }, DIOGENES, PID);
  const freshDoc = docIn(res.json?.state, fresh.id);
  check('documento novo promovido (v2)', freshDoc?.versions?.length === 1, String(freshDoc?.versions?.length));

  res = await call('DELETE', `/api/documents/${fresh.id}`, undefined, SERGIO, PID);
  check('documento com versões é excluído (200)', res.status === 200, `status ${res.status}`);
  check('documento sai do estado', !docIn(res.json?.state, fresh.id));
  const gone = await call('GET', `/files/${freshCorrection}`);
  check('arquivo da correção apagado do disco (404)', gone.status === 404, `status ${gone.status}`);
  const goneOriginal = await call('GET', `/files/${fresh.stored}`);
  check('arquivo original apagado do disco (404)', goneOriginal.status === 404, `status ${goneOriginal.status}`);
}

/* --------------------------------------------------- inativo e item de lista */
res = await call('PATCH', `/api/documents/${target.id}`, { active: false, inactiveReason: 'teste QA' }, SERGIO, PID);
check('documento inativado para o teste', res.status === 200, `status ${res.status}`);
res = await call(
  'POST',
  `/api/documents/${target.id}/correction`,
  { name: 'inativo.txt', data: b64('nao deveria entrar') },
  SERGIO,
  PID
);
check('documento inativo recusa correção (409)', res.status === 409, `status ${res.status}`);
await call('PATCH', `/api/documents/${target.id}`, { active: true }, SERGIO, PID);

const itemProcess = (state0.processes || []).find((process) => process.flow === 'requirements');
let item = null;
if (itemProcess) {
  const itemState = (
    await call('GET', `/api/state?processId=${encodeURIComponent(itemProcess.id)}`, undefined, SERGIO, itemProcess.id)
  ).json;
  item = itemState?.documents?.find((doc) => doc.itemKind === 'item') || null;
}
if (item) {
  res = await call(
    'POST',
    `/api/documents/${item.id}/correction`,
    { name: 'item.txt', data: b64('item') },
    SERGIO,
    item.processId
  );
  check('item de listagem recusa correção (400)', res.status === 400, `status ${res.status}`);
} else {
  console.log('  --   (sem item de listagem neste processo; teste pulado)');
}

/* ------------------------------------------------------------- resultado */
console.log(`\n${failures === 0 ? 'TUDO OK' : `${failures} FALHA(S)`}`);
process.exit(failures === 0 ? 0 : 1);
