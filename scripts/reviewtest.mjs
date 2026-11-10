/** Testa o fluxo de revisão (Fase B) e a presença na API. Use em dados de QA. */
const BASE = process.argv[2] || 'http://127.0.0.1:4191';
const SERGIO = 'usr_sergio';
const DIOGENES = 'usr_diogenes';
const PID = process.argv[3] || 'prc_3c8d4787da';

let failures = 0;
function check(name, condition, detail = '') {
  if (condition) {
    console.log(`  ok   ${name}`);
  } else {
    failures += 1;
    console.error(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

async function call(method, path, body, actor = SERGIO, process = PID) {
  const headers = { 'X-SCAD-Actor': actor, 'X-SCAD-Process': process };
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
    /* vazio */
  }
  return { status: res.status, json };
}

const state0 = await call('GET', '/api/state');
const docs = state0.json.documents;
const doneDocs = docs.filter((doc) => doc.review?.status === 'awaiting');
console.log(`documentos: ${docs.length} · aguardando revisão (migração): ${doneDocs.length}`);
check('migração deixa documentos concluídos aguardando revisão', doneDocs.length > 0);

const target = doneDocs[0];
const before = target.review;
console.log('documento de teste:', target.name, JSON.stringify(before));

let res = await call('POST', '/api/review/approve', { docId: target.id });
check('analista não pode aprovar (403)', res.status === 403, `status ${res.status}`);

res = await call('POST', '/api/review/approve', { docId: target.id }, DIOGENES);
check('revisor aprova o documento (200)', res.status === 200, JSON.stringify(res.json)?.slice(0, 120));
const approvedDoc = res.json?.state?.documents?.find((doc) => doc.id === target.id);
check('documento fica aprovado', approvedDoc?.review?.status === 'approved', approvedDoc?.review?.status);
check(
  'todos os checks ficam aprovados',
  res.json?.state?.checks?.filter((check) => check.docId === target.id).every((check) => check.review?.status === 'approved')
);
check(
  'atividade registra o revisor',
  (res.json?.state?.activity || []).some((item) => item.actorName === 'Diogenes' && item.text.startsWith('Documento aprovado'))
);

const firstCheck = res.json.state.checks.find((check) => check.docId === target.id);

res = await call('PATCH', `/api/checks/${firstCheck.id}`, { status: 'nc', note: 'Ajuste depois da aprovação' });
check('analista altera check aprovado → volta para revisão', res.json?.check?.review?.status === 'pending', res.json?.check?.review?.status);
check('documento volta a aguardar revisão', res.json?.docReview?.status === 'awaiting', res.json?.docReview?.status);

res = await call('POST', '/api/review/flag', { docId: target.id, checkId: firstCheck.id, message: '' }, DIOGENES);
check('sinalizar sem mensagem é recusado (400)', res.status === 400, `status ${res.status}`);

res = await call(
  'POST',
  '/api/review/flag',
  { docId: target.id, checkId: firstCheck.id, message: 'Citar a evidência do relatório', checkVersion: '2000-01-01T00:00:00.000Z' },
  DIOGENES
);
check('sinalizar com versão antiga é recusado (409)', res.status === 409, `status ${res.status}`);

const current = (await call('GET', '/api/state')).json.checks.find((check) => check.id === firstCheck.id);
res = await call(
  'POST',
  '/api/review/flag',
  {
    docId: target.id,
    checkId: firstCheck.id,
    message: 'Citar a evidência do relatório',
    checkVersion: current.updatedAt,
  },
  DIOGENES
);
check('revisor sinaliza critério (200)', res.status === 200, JSON.stringify(res.json)?.slice(0, 120));
const flagged = res.json?.state?.checks?.find((check) => check.id === firstCheck.id);
check('check fica sinalizado com mensagem', flagged?.review?.status === 'flagged' && flagged.review.note.includes('evidência'), JSON.stringify(flagged?.review));
check('documento fica em atenção', res.json?.review?.status === 'attention', res.json?.review?.status);
check(
  'demais checks são aprovados automaticamente',
  res.json.state.checks
    .filter((check) => check.docId === target.id && check.id !== firstCheck.id)
    .every((check) => check.review?.status === 'approved')
);

res = await call('POST', '/api/review/approve', { docId: target.id }, DIOGENES);
check('não aprova documento com sinalização (409)', res.status === 409, `status ${res.status}`);

res = await call('PATCH', `/api/checks/${firstCheck.id}`, { status: 'ok', note: 'Evidência citada' });
check('analista corrige check sinalizado → revisão pendente', res.json?.check?.review?.status === 'pending', res.json?.check?.review?.status);
check('documento volta a aguardar revisão', res.json?.docReview?.status === 'awaiting', res.json?.docReview?.status);

res = await call('POST', '/api/review/approve', { docId: target.id, message: 'Revisado e aprovado.' }, DIOGENES);
check('revisor aprova de novo com mensagem', res.status === 200 && res.json?.review?.status === 'approved', res.json?.review?.status);
check(
  'histórico da revisão guarda a sinalização',
  res.json.state.checks.find((check) => check.id === firstCheck.id)?.review?.history?.some((entry) => entry.status === 'flagged')
);

// verificação feita pelo próprio revisor é auto-aprovada
const anyState = (await call('GET', '/api/state')).json;
const autoDoc = anyState.documents.find((doc) => doc.active !== false && doc.review?.status !== 'dispensed');
const autoCheck = anyState.checks.find((check) => check.docId === autoDoc.id);
res = await call('PATCH', `/api/checks/${autoCheck.id}`, { status: 'ok' }, DIOGENES);
check(
  'verificação feita pelo revisor é auto-aprovada',
  res.json?.check?.review?.status === 'approved',
  res.json?.check?.review?.status
);

// presença
await call('POST', '/api/presence', { docId: null }, SERGIO);
await call('POST', '/api/presence', { docId: null }, DIOGENES);
let p = await call('POST', '/api/presence', { docId: target.id }, SERGIO);
check(
  'presença do próprio usuário não aparece para si',
  !p.json?.present?.some((item) => item.actorName === 'Sergio'),
  JSON.stringify(p.json)
);

p = await call('POST', '/api/presence', { docId: target.id }, DIOGENES);
check('outro usuário vê quem está no documento', p.json?.present?.some((item) => item.actorName === 'Sergio' && item.docId === target.id), JSON.stringify(p.json));

p = await call('POST', '/api/presence', { docId: null }, SERGIO);
check('sair do documento remove a presença', !p.json?.present?.some((item) => item.actorName === 'Sergio'), JSON.stringify(p.json));

p = await call('POST', '/api/presence', { docId: 'doc_inexistente' }, SERGIO);
check(
  'documento inexistente não registra presença',
  !p.json?.present?.some((item) => item.actorName === 'Sergio'),
  JSON.stringify(p.json)
);

const ending = await call('GET', '/api/state');
console.log(`\nestado final: rev ${ending.json.rev} · docs ${ending.json.counts.docs} · checks ${ending.json.counts.checks}`);
console.log(failures ? `\n${failures} FALHA(S)` : '\nfluxo de revisão e presença: ok');
process.exitCode = failures ? 1 : 0;
