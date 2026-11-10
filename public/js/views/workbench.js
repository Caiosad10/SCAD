import {
  esc,
  stamp,
  emptyState,
  relTime,
  fileKind,
  fileKindLabel,
} from '../ui.js';
import { icon } from '../icons.js';
import {
  docById,
  docStats,
  docFlag,
  nextPendingDoc,
  overall,
  pendingQueue,
  ui,
} from '../store.js';
import { renderChecks, docSummaryHtml } from './checks.js';

function lastUpdate(state, docId) {
  const checks = state.checks.filter((c) => c.docId === docId);
  const latest = checks.reduce((acc, c) => (!acc || c.updatedAt > acc ? c.updatedAt : acc), '');
  return latest;
}

function queueItem(state, doc, currentId, index) {
  const st = docStats(state, doc.id);
  const flag = docFlag(state, doc.id);
  return (
    `<a class="queue__item${doc.id === currentId ? ' is-current' : ''}" href="#/analisar/${doc.id}" ` +
    `data-queue-item="${doc.id}"${doc.id === currentId ? ' aria-current="page"' : ''}>` +
    `<span class="queue__num">${String(index + 1).padStart(2, '0')}</span>` +
    `<span class="queue__name">${esc(doc.name)}</span>` +
    `<span class="queue__count" data-queue-count="${doc.id}">${
      flag === 'inactive' ? '—' : flag === 'flagged' ? '!' : `${st.done}/${st.total}`
    }</span>` +
    `</a>`
  );
}

export function resolveWorkbenchDoc(state) {
  const direct = docById(state, ui.route.id);
  if (direct) return direct;
  const last = state.meta.lastDocId ? docById(state, state.meta.lastDocId) : null;
  if (last && docStats(state, last.id).pending > 0) return last;
  const pending = nextPendingDoc(state);
  if (pending) return pending;
  return last || state.documents[0] || null;
}

export function renderWorkbench(state) {
  if (!state.documents.length) {
    return (
      `<div class="page">` +
      `<div class="page__head"><div><p class="eyebrow">Bancada de análise</p>` +
      `<h2 class="page__title">Nada para verificar ainda</h2>` +
      `<p class="page__sub">A bancada abre o primeiro documento pendente.</p></div></div>` +
      emptyState({
        iconName: 'upload',
        title: 'Importe os documentos do processo',
        text: 'Cada arquivo recebe uma verificação por critério. Depois é só abrir a bancada e seguir documento por documento.',
        action: `<button type="button" class="btn btn--primary" data-action="open-import">${icon(
          'upload',
          16
        )} Importar documentos</button>`,
      }) +
      `</div>`
    );
  }

  const doc = resolveWorkbenchDoc(state);
  if (!doc) return '';
  const st = docStats(state, doc.id);
  const flag = docFlag(state, doc.id);
  const index = state.documents.findIndex((d) => d.id === doc.id);
  const kind = fileKind(doc.name, doc.mime);
  const s = overall(state);

  const queueDocs = (ui.queueAll ? state.documents : pendingQueue(state)).slice();
  if (!queueDocs.some((d) => d.id === doc.id)) queueDocs.unshift(doc);

  const prev = state.documents[index - 1] || null;
  const next = state.documents[index + 1] || null;
  const nextPending = nextPendingDoc(state, doc.id);
  const finished = st.total > 0 && st.pending === 0;
  const updated = lastUpdate(state, doc.id);

  const queue = queueDocs
    .map((item) => queueItem(state, item, doc.id, state.documents.indexOf(item)))
    .join('');

  const foot =
    `<footer class="checks__foot">` +
    `<span class="kbd-hint"><kbd>J</kbd> <kbd>K</kbd> verificações · <kbd>1</kbd>–<kbd>3</kbd> resultado · <kbd>N</kbd> próximo documento</span>` +
    `<div class="checks__foot-actions">` +
    (prev
      ? `<a class="btn btn--secondary btn--sm" href="#/analisar/${prev.id}">${icon('arrowLeft', 15)} Anterior</a>`
      : `<span></span>`) +
    (nextPending
      ? `<a class="btn btn--primary btn--sm" href="#/analisar/${nextPending.id}" data-action="next-doc">Próximo pendente ${icon(
          'arrowRight',
          15
        )}</a>`
      : next
        ? `<a class="btn btn--primary btn--sm" href="#/analisar/${next.id}">Próximo documento ${icon('arrowRight', 15)}</a>`
        : `<a class="btn btn--secondary btn--sm" href="#/documentos">Ver documentos</a>`) +
    `</div></footer>`;

  const completeCard =
    s.total > 0 && s.pending === 0
      ? `<section class="card done-card">` +
        `<span class="done__icon">${icon('check', 18)}</span>` +
        `<div class="done-card__copy"><h2>Análise concluída</h2>` +
        `<p>${s.nc + s.obs ? `${s.nc} não conforme(s) e ${s.obs} observação(ões) registradas. Revise os apontamentos antes de encerrar.` : 'Todas as verificações foram avaliadas e não há apontamentos.'}</p></div>` +
        `<div class="done-card__actions">` +
        `<a class="btn btn--secondary btn--sm" href="#/apontamentos">Apontamentos</a>` +
        `<button type="button" class="btn btn--primary btn--sm" data-action="export-csv">Exportar CSV</button>` +
        `</div></section>`
      : '';

  return (
    `<div class="page page--workbench">` +
    `<a class="backlink" href="#/documentos">${icon('arrowLeft', 13)} Documentos</a>` +
    `<div class="doc-head">` +
    `<div class="doc-head__copy">` +
    `<p class="eyebrow">Bancada · documento ${index + 1} de ${state.documents.length} · ${fileKindLabel(kind)}</p>` +
    `<h2 class="doc-head__title">${esc(doc.name)}</h2>` +
    `<p class="page__sub" data-doc-summary>${docSummaryHtml(state, doc)}` +
    (updated ? `<span aria-hidden="true">·</span>última edição ${esc(relTime(updated))}` : '') +
    `</p></div>` +
    `<div class="page__actions">` +
    `<button type="button" class="btn btn--secondary" data-action="doc-preview" data-id="${doc.id}">${icon(
      'external',
      15
    )} Ver arquivo</button>` +
    `<button type="button" class="btn ${doc.active === false ? 'btn--secondary' : 'btn--ghost'}" ` +
    `data-action="doc-toggle-active" data-id="${doc.id}">${icon('power', 15)} ${
      doc.active === false ? 'Reativar' : 'Inativar'
    }</button>` +
    `<button type="button" class="iconbtn" data-action="doc-rename" data-id="${doc.id}" aria-label="Renomear documento" title="Renomear">${icon(
      'pen',
      17
    )}</button>` +
    `<button type="button" class="iconbtn iconbtn--danger" data-action="doc-delete" data-id="${doc.id}" aria-label="Excluir documento" title="Excluir">${icon(
      'trash',
      17
    )}</button>` +
    `</div></div>` +
    (doc.active === false
      ? `<div class="doc-inactive-banner">${icon('pause', 16)}<div><strong>Documento inativo — verificação suspensa</strong>` +
        `<span>${esc(doc.inactiveReason || 'Sem motivo registrado')}</span></div></div>`
      : '') +
    completeCard +
    `<div class="workspace">` +
    `<aside class="queue" aria-label="Fila de documentos">` +
    `<div class="queue__head">` +
    `<span class="queue__title">Fila <b>${queueDocs.length}</b></span>` +
    `<div class="segmented segmented--mini" role="group" aria-label="Escopo da fila">` +
    `<button type="button" data-action="queue-scope" data-scope="pending" aria-pressed="${!ui.queueAll}">Pendentes</button>` +
    `<button type="button" data-action="queue-scope" data-scope="all" aria-pressed="${ui.queueAll}">Todos</button>` +
    `</div></div>` +
    `<div class="queue__list">${
      queue ||
      `<div class="queue__empty">Nenhum documento pendente. Bom trabalho.</div>`
    }</div>` +
    `<p class="queue__hint">Documentos verificados continuam acessíveis em “Todos”.</p>` +
    `</aside>` +
    `<section class="card checks" aria-label="Verificações do documento">` +
    renderChecks(state, doc, { footer: foot }) +
    `</section>` +
    `</div></div>`
  );
}
