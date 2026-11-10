import {
  esc,
  fmtBytes,
  fmtDate,
  plural,
  stamp,
  bar,
  emptyState,
  fileKind,
  fileKindLabel,
  fileGlyph,
  fileExt,
} from '../ui.js';
import { icon, statusMark } from '../icons.js';
import {
  docById,
  docStats,
  docFlag,
  criteriaSorted,
  overall,
  ui,
  reviewOfDoc,
  currentProfile,
} from '../store.js';
import { renderChecks, docTagHtml, presenceLine } from './checks.js';

const FILTERS = [
  { id: 'all', label: 'Todos' },
  { id: 'pending', label: 'Pendentes' },
  { id: 'done', label: 'Concluídos' },
  { id: 'flagged', label: 'Com apontamento' },
  { id: 'review', label: 'Revisão' },
  { id: 'inactive', label: 'Inativos' },
];

function docStamp(state, doc) {
  if (doc.active === false) return stamp('na', { label: 'Inativo' });
  const review = reviewOfDoc(state, doc.id);
  const st = docStats(state, doc.id);
  if (review.status === 'approved') return stamp('ok', { label: 'Aprovado' });
  if (review.status === 'attention') return stamp('nc', { label: 'Atenção' });
  if (review.status === 'awaiting') return stamp('pending', { label: 'Revisão' });
  if (st.nc) return stamp('nc', { label: 'Apontamento' });
  if (st.obs) return stamp('obs', { label: 'Apontamento' });
  if (st.pending) return stamp('pending', { label: 'Em análise' });
  return stamp('ok', { label: 'Verificado' });
}

export function filterDocuments(state) {
  const query = ui.docQuery.trim().toLowerCase();
  return state.documents
    .map((doc, index) => ({ doc, index }))
    .filter(({ doc }) => {
      if (query && !doc.name.toLowerCase().includes(query)) return false;
      const flag = docFlag(state, doc.id);
      if (ui.docFilter === 'inactive') return flag === 'inactive';
      if (ui.docFilter === 'pending') return flag !== 'inactive' && docStats(state, doc.id).pending > 0;
      if (ui.docFilter === 'done') return flag !== 'inactive' && docStats(state, doc.id).pending === 0;
      if (ui.docFilter === 'flagged') return flag === 'flagged';
      if (ui.docFilter === 'review') {
        const review = reviewOfDoc(state, doc.id).status;
        return review === 'awaiting' || review === 'attention';
      }
      if (ui.docFilter === 'awaiting') return reviewOfDoc(state, doc.id).status === 'awaiting';
      if (ui.docFilter === 'attention') return reviewOfDoc(state, doc.id).status === 'attention';
      return true;
    });
}

function filterCounts(state) {
  const counts = { all: state.documents.length, pending: 0, done: 0, flagged: 0, review: 0, inactive: 0 };
  for (const doc of state.documents) {
    if (doc.active === false) {
      counts.inactive += 1;
      continue;
    }
    const st = docStats(state, doc.id);
    if (st.pending) counts.pending += 1;
    else counts.done += 1;
    if (st.nc || st.obs) counts.flagged += 1;
    const review = reviewOfDoc(state, doc.id).status;
    if (review === 'awaiting' || review === 'attention') counts.review += 1;
  }
  return counts;
}

export function renderDocumentsList(state) {
  const docs = filterDocuments(state);
  const counts = filterCounts(state);

  if (!state.documents.length) {
    return emptyState({
      iconName: 'docs',
      title: 'Nenhum documento importado',
      text: 'Traga os arquivos deste processo — PDFs, imagens, planilhas ou textos. Cada um recebe uma verificação por critério.',
      action: `<button type="button" class="btn btn--primary" data-action="open-import">${icon('upload', 16)} Importar documentos</button>`,
    });
  }

  if (!docs.length) {
    return emptyState({
      iconName: 'search',
      title: 'Nenhum documento neste filtro',
      text: 'Ajuste a busca ou volte para todos os documentos.',
      action: `<button type="button" class="btn btn--secondary" data-action="clear-doc-filters">Limpar busca e filtros</button>`,
    });
  }

  const rows = docs
    .map(({ doc, index }) => {
      const st = docStats(state, doc.id);
      const kind = fileKind(doc.name, doc.mime);
      const inactive = doc.active === false;
      const dots = inactive
        ? criteriaSorted(state)
            .map(() => `<span class="docrow__dot docrow__dot--off" title="Verificação suspensa">—</span>`)
            .join('')
        : criteriaSorted(state)
            .map((criterion) => {
              const check = state.checks.find((c) => c.docId === doc.id && c.criterionId === criterion.id);
              const status = check?.status || 'pending';
              return (
                `<span class="docrow__dot" title="${esc(criterion.label)}: ${esc(status)}">` +
                `${statusMark(status, 13)}</span>`
              );
            })
            .join('');

      return (
        `<a class="docrow${inactive ? ' is-inactive' : ''}" href="#/documentos/${doc.id}" data-doc-id="${doc.id}">` +
        `<span class="docrow__index">${String(index + 1).padStart(2, '0')}</span>` +
        `<span class="docrow__icon docrow__icon--${kind}">${fileGlyph(kind, 15)}` +
        `<span class="docrow__ext">${esc(fileExt(doc.name))}</span></span>` +
        `<span class="docrow__main">` +
        `<span class="docrow__name">${esc(doc.name)}</span>` +
        `<span class="docrow__meta">${
          inactive
            ? `<b>Inativo</b> <i>·</i> ${esc(doc.inactiveReason || 'sem motivo registrado')}`
            : `${esc(fileKindLabel(kind))} <i>·</i> ${fmtBytes(doc.size)} <i>·</i> ${st.done}/${st.total} verificações <i>·</i> ${esc(fmtDate(doc.addedAt))}`
        }</span>` +
        `</span>` +
        `<span class="docrow__dots" aria-hidden="true">${dots}</span>` +
        `<span class="docrow__progress"><span>${inactive ? '—' : `${st.pct}%`}</span>${bar(
          inactive ? 0 : st.done,
          inactive ? 0 : st.total,
          { thin: true, label: 'Progresso' }
        )}</span>` +
        `<span class="docrow__stamp">${docStamp(state, doc)}</span>` +
        `<span class="docrow__go" aria-hidden="true">${icon('chevronRight', 15)}</span>` +
        `</a>`
      );
    })
    .join('');

  return `<div class="doclist card">${rows}</div>`;
}

export function renderDocuments(state) {
  const counts = filterCounts(state);
  const crit = criteriaSorted(state);
  const s = overall(state);
  // A faixa de revisão do painel abre já filtrado por “aguardando” ou “atenção”;
  // na barra de filtros ambos aparecem como o filtro “Revisão”.
  const activeFilter = ui.docFilter === 'awaiting' || ui.docFilter === 'attention' ? 'review' : ui.docFilter;

  const tabs = FILTERS.map(
    (filter) =>
      `<button type="button" data-action="filter-docs" data-filter="${filter.id}" ` +
      `aria-pressed="${activeFilter === filter.id}">${esc(filter.label)}` +
      `<span class="segmented__count">${counts[filter.id]}</span></button>`
  ).join('');

  return (
    `<div class="page page--documents">` +
    `<div class="page__head">` +
    `<div class="page__head-copy"><p class="eyebrow">Acervo</p>` +
    `<h2 class="page__title">Documentos</h2>` +
    `<p class="page__sub">${plural(state.documents.length, 'arquivo', 'arquivos')} ` +
    `<span aria-hidden="true">·</span> ${plural(s.total, 'verificação', 'verificações')} ` +
    `<span aria-hidden="true">·</span> ${plural(crit.length, 'critério', 'critérios')}</p></div>` +
    `<div class="page__actions">` +
    `<label class="search">${icon('search', 16)}` +
    `<input type="search" data-filter="doc-query" value="${esc(ui.docQuery)}" ` +
    `placeholder="Buscar documento…" aria-label="Buscar documento"></label>` +
    `<button type="button" class="btn btn--primary" data-action="open-import">${icon('upload', 16)} Importar</button>` +
    `</div></div>` +
    (state.documents.length
      ? `<div class="toolbar">` +
        `<div class="segmented" role="group" aria-label="Filtrar documentos">${tabs}</div>` +
        `<span class="toolbar__count" id="doc-results">${filterDocuments(state).length} de ${state.documents.length}</span>` +
        `</div>`
      : '') +
    `<div id="doclist">${renderDocumentsList(state)}</div>` +
    `</div>`
  );
}

export function renderDocument(state, docId) {
  const doc = docById(state, docId);
  if (!doc) {
    return (
      `<div class="page">` +
      `<a class="backlink" href="#/documentos">${icon('arrowLeft', 13)} Documentos</a>` +
      emptyState({
        iconName: 'file',
        title: 'Documento não encontrado',
        text: 'Ele pode ter sido removido em outro dispositivo.',
        action: `<a class="btn btn--secondary" href="#/documentos">Voltar para documentos</a>`,
      }) +
      `</div>`
    );
  }

  const index = state.documents.findIndex((d) => d.id === doc.id);
  const st = docStats(state, doc.id);
  const kind = fileKind(doc.name, doc.mime);
  const review = reviewOfDoc(state, doc.id);
  const canApprove = currentProfile(state)?.role === 'reviewer' && review.status === 'awaiting';

  return (
    `<div class="page page--document">` +
    `<a class="backlink" href="#/documentos">${icon('arrowLeft', 13)} Documentos</a>` +
    `<div class="doc-head">` +
    `<div class="doc-head__copy">` +
    `<p class="eyebrow">Documento ${index + 1} de ${state.documents.length} · ${fileKindLabel(kind)}</p>` +
    `<h2 class="doc-head__title">${esc(doc.name)}</h2>` +
    `<p class="doc-presence" data-presence="${doc.id}">${presenceLine(doc.id)}</p>` +
    `<p class="page__sub">${fmtBytes(doc.size)} <span aria-hidden="true">·</span> importado em ${esc(
      fmtDate(doc.addedAt)
    )} <span aria-hidden="true">·</span> <span data-doc-summary>${
      doc.active === false ? 'Inativo' : `${st.done}/${st.total} verificações`
    }</span> <span aria-hidden="true">·</span> ${docTagHtml(state, doc)}</p>` +
    `</div>` +
    `<div class="page__actions">` +
    (canApprove
      ? `<button type="button" class="btn btn--primary" data-action="review-approve" data-id="${doc.id}">${icon(
          'check',
          15
        )} Aprovar documento</button>`
      : '') +
    `<a class="btn ${canApprove ? 'btn--secondary' : 'btn--primary'}" href="#/analisar/${doc.id}">${icon(
      'analyze',
      16
    )} Ir para a bancada</a>` +
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
    `<section class="card checks" aria-label="Verificações do documento">` +
    renderChecks(state, doc) +
    `</section>` +
    `</div>`
  );
}
