import { esc, fmtTime, stamp, bar } from '../ui.js';
import { icon, statusMark } from '../icons.js';
import {
  criteriaSorted,
  docStats,
  ui,
  reviewOfDoc,
  checkReview,
  currentProfile,
  presenceOnDoc,
  isRequirementsFlow,
  statusOptionList,
  statusLabelFor,
  isItemDoc,
  isPointedStatus,
  correctionVersion,
} from '../store.js';

export function showNoteFor(check, state = null) {
  const customs = isRequirementsFlow(state) ? state?.process?.customStatuses || [] : [];
  const customIds = new Set(customs.map((c) => c.id));
  return (
    check.status === 'nc' ||
    check.status === 'obs' ||
    customIds.has(check.status) ||
    Boolean((check.note || '').trim()) ||
    ui.notesOpen.has(check.id)
  );
}

export function docTagHtml(state, doc) {
  if (doc.active === false) return stamp('na', { label: 'Inativo' });
  const review = reviewOfDoc(state, doc.id);
  const st = docStats(state, doc.id);
  if (review.status === 'approved') return stamp('ok', { label: 'Aprovado' });
  if (review.status === 'attention') return stamp('nc', { label: 'Atenção' });
  if (doc.correction) return stamp('pending', { label: `Corrigido · v${correctionVersion(doc)}` });
  if (review.reopened) return stamp('pending', { label: 'Reaberta' });
  if (review.status === 'awaiting') return stamp('pending', { label: 'Aguardando revisão' });
  if (st.pointed) return stamp('nc', { label: 'Apontamento' });
  if (st.total && st.pending === 0) return stamp('ok', { label: 'Verificado' });
  return stamp('pending', { label: 'Em análise' });
}

export function docSummaryHtml(state, doc) {
  if (doc.active === false) {
    return `<span>Inativo</span><span aria-hidden="true">·</span>${stamp('na', { label: 'Dispensado' })}`;
  }
  const st = docStats(state, doc.id);
  return (
    `<span>${st.done}/${st.total} verificações</span>` +
    `<span aria-hidden="true">·</span>${docTagHtml(state, doc)}`
  );
}

/** Linha discreta de presença: “Diogenes está aqui”. */
export function presenceLine(docId) {
  const here = presenceOnDoc(docId);
  if (!here.length) return '';
  const names = here.map((item) => esc(item.actorName || 'Alguém')).join(' e ');
  return `<span class="presence-dot" aria-hidden="true"></span>${names} ${
    here.length > 1 ? 'estão' : 'está'
  } aqui`;
}

function isReviewer(state) {
  return currentProfile(state)?.role === 'reviewer';
}

function lastReviewEvent(check) {
  const history = Array.isArray(check.review?.history) ? check.review.history : [];
  return history.length ? history[history.length - 1] : null;
}

function reviewChip(review, status) {
  if (status === 'pending') return '';
  if (review === 'approved') {
    return `<span class="review-chip review-chip--ok" title="Aprovada na revisão">${icon('check', 10)} aprovada</span>`;
  }
  if (review === 'flagged') {
    return `<span class="review-chip review-chip--flag" title="Sinalizada pelo revisor">${icon('flag', 10)} sinalizada</span>`;
  }
  return `<span class="review-chip">aguardando revisão</span>`;
}

function attachmentChipHtml(att, disabled, checkId) {
  if (!att) return '';
  const unlink = disabled
    ? ''
    : `<button type="button" class="evidence-chip__x" data-action="evidence-unlink" data-att="${esc(att.id)}" data-check-id="${esc(checkId)}" aria-label="Desvincular evidência" title="Desvincular deste check">${icon(
        'close',
        11
      )}</button>`;
  return `<span class="evidence-chip" role="button" tabindex="0" data-action="evidence-open" data-id="${esc(
    att.id
  )}" title="Ver ${esc(att.name)} sem baixar">${icon('file', 12)}<span class="evidence-chip__name">${esc(
    att.name
  )}</span>${unlink}</span>`;
}

/** Bloco de evidências presas ao item, referenciadas por este check. */
export function evidenceBlockHtml(state, check, doc, disabled) {
  if (!isRequirementsFlow(state) || !isItemDoc(doc)) return '';
  const attachments = Array.isArray(check.attachments) ? check.attachments : [];
  const byId = new Map((state.documents || []).map((d) => [d.id, d]));
  const chips = attachments
    .map((id) => byId.get(id))
    .filter(Boolean)
    .map((att) => attachmentChipHtml(att, disabled, check.id))
    .join('');
  const add = disabled
    ? ''
    : `<button type="button" class="evidence-add" data-action="attach-evidence" data-check-id="${esc(
        check.id
      )}" data-item-id="${esc(doc.id)}">${icon('plus', 12)} Anexar evidência</button>`;
  if (!chips && !add) return '';
  return `<div class="check__evidence" aria-label="Evidências deste critério">${chips}${add}</div>`;
}

function noteBlockHtml(check, disabled, label = 'critério') {
  const note = check.note || '';
  return (
    `<div class="check__note">` +
    `<textarea id="note-${check.id}" data-note-id="${check.id}" rows="2" ${disabled ? 'readonly' : ''} ` +
    `aria-label="Nota de ${esc(label)}" ` +
    `placeholder="Evidência, trecho ou motivo do apontamento…">${esc(note)}</textarea>` +
    `<div class="check__note-bar">` +
    `<span class="autosave" data-save-state="saved">${note ? `salvo · ${esc(fmtTime(check.updatedAt))}` : 'vazio'}</span>` +
    (note && !disabled
      ? `<button type="button" class="note-clear" data-action="clear-note" data-id="${check.id}">limpar</button>`
      : `<span></span>`) +
    `</div></div>`
  );
}

function noteToggleHtml(check, disabled) {
  if (disabled) return '';
  return `<button type="button" class="note-toggle" data-action="note-toggle" data-id="${check.id}">+ nota</button>`;
}

export function renderCheckRow(state, check, criterion, index, options = {}) {
  const status = check.status || 'pending';
  const note = check.note || '';
  const withNote = showNoteFor(check, state);
  const label = criterion?.label || 'Critério removido';
  const code = `C${String(index + 1).padStart(2, '0')}`;
  const doc = (state.documents || []).find((d) => d.id === check.docId);
  const evidenceBlock = evidenceBlockHtml(state, check, doc, Boolean(options.disabled));

  const review = status === 'pending' ? 'pending' : checkReview(check);
  const reviewer = isReviewer(state);
  const OPTIONS = statusOptionList(state);

  const optionButtons = OPTIONS.map(
    (option) =>
      `<button type="button" class="opt opt--${option.custom ? 'custom' : option.status}" data-action="set-check" ` +
      `data-id="${check.id}" data-status="${option.status}" aria-pressed="${status === option.status}" ` +
      `${options.disabled ? 'disabled' : ''} ` +
      `aria-label="${esc(label)}: ${esc(option.label)}" ` +
      `title="${esc(option.label)} (${OPTIONS.indexOf(option) + 1})">` +
      `${statusMark(option.custom ? 'custom' : option.status, 13)}<span>${esc(option.label)}</span></button>`
  ).join('');

  const noteToggle = withNote ? '' : noteToggleHtml(check, Boolean(options.disabled));

  const noteBlock = withNote ? noteBlockHtml(check, Boolean(options.disabled), label) : '';

  const nextButton = options.isLast
    ? ''
    : `<div class="check__next">` +
      `<button type="button" class="btn btn--ghost btn--sm" data-action="next-check" data-id="${check.id}">` +
      `Próximo critério ${icon('chevronDown', 14)}</button></div>`;

  const reviewRow =
    review === 'approved'
      ? `<p class="check__review">${reviewChip('approved', status)}</p>`
      : review === 'flagged'
        ? `<p class="check__review">${reviewChip('flagged', status)}</p>` +
          `<p class="check__flag">${icon('flag', 13)} <b>${esc(check.review?.byName || 'Revisor')}:</b> ${esc(
            check.review?.note || 'critério sinalizado'
          )}${check.review?.at ? ` <span class="check__flag-time">${esc(fmtTime(check.review.at))}</span>` : ''}</p>` +
          (reviewer ? '' : `<p class="check__flag-hint">Corrija o resultado ou a nota: o critério volta para a revisão.</p>`)
        : '';

  const flagAction =
    reviewer && status !== 'pending' && !options.disabled
      ? `<div class="check__review-actions"><button type="button" class="btn btn--ghost btn--sm" ` +
        `data-action="review-flag" data-doc-id="${check.docId}" data-check-id="${check.id}">` +
        `${icon('flag', 14)} ${review === 'flagged' ? 'Sinalizar de novo' : 'Sinalizar critério'}</button></div>`
      : '';

  return (
    `<article class="check check--${status}${options.disabled ? ' check--disabled' : ''} check--review-${review}" data-check-row="${check.id}" tabindex="0" ` +
    `data-review="${review}" data-opts="${esc(OPTIONS.map((option) => option.status).join('|'))}" ` +
    `aria-label="${esc(label)}: ${esc(statusLabelFor(state, status))}">` +
    `<div class="check__head">` +
    `<span class="check__mark">${code}</span>` +
    `<div class="check__label"><h3>${esc(label)}</h3>` +
    (criterion?.hint ? `<p class="check__hint">${esc(criterion.hint)}</p>` : '') +
    `</div>` +
    `<span class="check__stamp">${stamp(status, { label: statusLabelFor(state, status) })}</span>` +
    `</div>` +
    `<div class="check__options" role="group" aria-label="Resultado de ${esc(label)}">` +
    optionButtons +
    noteToggle +
    `</div>` +
    evidenceBlock +
    reviewRow +
    noteBlock +
    flagAction +
    nextButton +
    `</article>`
  );
}

export function checksHeadHtml(state, doc) {
  const st = docStats(state, doc.id);
  const reqs = isRequirementsFlow(state);
  const addButton = reqs
    ? `<button type="button" class="btn btn--ghost btn--sm checks__add" data-action="open-item-dialog" title="Novo item da listagem">${icon(
        'plus',
        14
      )} Adicionar item</button>`
    : `<button type="button" class="btn btn--ghost btn--sm checks__add" data-action="open-import" title="Importar mais documentos">${icon(
        'upload',
        14
      )} Importar mais</button>`;
  const actions = `<div class="checks__actions">${addButton}</div>`;

  if (doc.active === false) {
    return (
      `<div class="checks__head" data-checks-head>` +
      `<div class="checks__summary"><span class="checks__num">—</span>` +
      `<span>verificações suspensas</span></div>` +
      `<div class="checks__meter">${bar(0, 0, { label: 'Documento inativo' })}</div>` +
      actions +
      `</div>`
    );
  }
  return (
    `<div class="checks__head" data-checks-head>` +
    `<div class="checks__summary"><span class="checks__num">${st.done}</span>` +
    `<span>de ${st.total} verificações</span></div>` +
    `<div class="checks__meter">${bar(st.done, st.total, { label: 'Progresso do documento' })}</div>` +
    actions +
    `</div>`
  );
}

function latestReviewEvent(state, docId) {
  let latest = null;
  for (const check of state.checks) {
    if (check.docId !== docId || !check.review?.at) continue;
    if (!latest || check.review.at > latest.at) latest = check.review;
  }
  return latest;
}

export function doneBannerHtml(state, doc) {
  if (doc.active === false) return '';
  const st = docStats(state, doc.id);
  if (!st.total || st.pending > 0) return '';
  const review = reviewOfDoc(state, doc.id);
  const latest = latestReviewEvent(state, doc.id);

  if (review.status === 'approved') {
    return (
      `<div class="done done--approved"><span class="done__icon">${statusMark('ok', 17)}</span>` +
      `<div><h3>Documento aprovado</h3><p>Revisão concluída${
        latest?.byName ? ` por <b>${esc(latest.byName)}</b>` : ''
      }.${latest?.note ? ` “${esc(latest.note)}”` : ''}</p></div></div>`
    );
  }
  if (review.status === 'attention') {
    return (
      `<div class="done done--attention"><span class="done__icon">${statusMark('nc', 17)}</span>` +
      `<div><h3>Revisão com sinalização</h3><p>${
        review.flagged === 1 ? '1 critério sinalizado' : `${review.flagged} critérios sinalizados`
      }. Corrija o resultado ou a nota e o documento volta para a revisão.</p></div></div>`
    );
  }
  const pointedCount = state.checks.filter((c) => c.docId === doc.id && isPointedStatus(state, c.status)).length;
  const summary =
    pointedCount === 0
      ? 'Todos os critérios foram avaliados.'
      : `${pointedCount} ${pointedCount === 1 ? 'apontamento registrado' : 'apontamentos registrados'}.`;

  return (
    `<div class="done"><span class="done__icon">${statusMark('ok', 17)}</span>` +
    `<div><h3>Documento verificado</h3><p>${summary} ${review.status === 'awaiting' ? 'Aguardando revisão.' : ''}</p></div></div>`
  );
}

/** Corpo de verificação compartilhado entre o detalhe do documento e a bancada. */
export function renderChecks(state, doc, options = {}) {
  const crit = criteriaSorted(state);
  const checks = state.checks.filter((c) => c.docId === doc.id);
  const byCriterion = new Map(checks.map((c) => [c.criterionId, c]));

  const rows = crit
    .map((criterion, index) => {
      const check = byCriterion.get(criterion.id);
      if (!check) return '';
      return renderCheckRow(state, check, criterion, index, {
        isLast: index === crit.length - 1,
        disabled: doc.active === false,
      });
    })
    .join('');

  return (
    checksHeadHtml(state, doc) +
    `<div data-done-slot>${doneBannerHtml(state, doc)}</div>` +
    (rows || `<div class="matrix-empty">Nenhum critério definido para este documento.</div>`) +
    (options.footer || '')
  );
}

/** Cabeçalho da sessão de análise atualizado no lugar (números e barra). */
export function patchChecksHead(state, doc) {
  const head = document.querySelector('.checks [data-checks-head]');
  if (!head || !doc) return false;
  const st = docStats(state, doc.id);
  const inactive = doc.active === false;
  const num = head.querySelector('.checks__num');
  if (num) num.textContent = inactive ? '—' : String(st.done);
  const tail = num?.nextElementSibling;
  if (tail) tail.textContent = inactive ? 'verificações suspensas' : `de ${st.total} verificações`;
  const meter = head.querySelector('.checks__meter');
  if (meter) {
    const html = inactive
      ? bar(0, 0, { label: 'Documento inativo' })
      : bar(st.done, st.total, { label: 'Progresso do documento' });
    if (meter.innerHTML !== html) meter.innerHTML = html;
  }
  return true;
}

/**
 * Atualiza a linha do check no lugar — status, selo e bloco de nota — sem
 * recriar o elemento. Devolve false quando é preciso redesenhar a linha
 * (revisão do revisor mudou ou a lista de resultados do processo mudou).
 */
export function patchCheckRow(row, state, check, options = {}) {
  if (!row || !check) return false;
  const status = check.status || 'pending';
  const review = status === 'pending' ? 'pending' : checkReview(check);
  const OPTIONS = statusOptionList(state);
  if (row.dataset.review !== review) return false;
  if (row.dataset.opts !== OPTIONS.map((option) => option.status).join('|')) return false;

  const criterion = state.criteria.find((c) => c.id === check.criterionId);
  const label = criterion?.label || 'Critério removido';
  const doc = (state.documents || []).find((d) => d.id === check.docId);
  const disabled = Boolean(options.disabled) || doc?.active === false;

  row.className = `check check--${status}${disabled ? ' check--disabled' : ''} check--review-${review}`;
  row.setAttribute('aria-label', `${label}: ${statusLabelFor(state, status)}`);

  const stampEl = row.querySelector('.check__stamp');
  const stampHtml = stamp(status, { label: statusLabelFor(state, status) });
  if (stampEl && stampEl.innerHTML !== stampHtml) stampEl.innerHTML = stampHtml;

  for (const button of row.querySelectorAll('.check__options [data-status]')) {
    button.setAttribute('aria-pressed', String(button.dataset.status === status));
  }

  const withNote = showNoteFor(check, state);
  let noteEl = row.querySelector('.check__note');
  if (withNote && !noteEl) {
    const holder = document.createElement('div');
    holder.innerHTML = noteBlockHtml(check, disabled, label);
    const fresh = holder.firstElementChild;
    const anchor = row.querySelector('.check__review, .check__review-actions, .check__next');
    if (anchor) anchor.before(fresh);
    else row.append(fresh);
    noteEl = fresh;
  } else if (!withNote && noteEl) {
    noteEl.remove();
    noteEl = null;
  }
  if (noteEl) {
    const area = noteEl.querySelector('[data-note-id]');
    if (area && document.activeElement !== area && area.value !== (check.note || '')) {
      area.value = check.note || '';
    }
  }

  const toggle = row.querySelector('.note-toggle');
  if (!withNote && !toggle) {
    const holder = document.createElement('div');
    holder.innerHTML = noteToggleHtml(check, disabled);
    const fresh = holder.firstElementChild;
    if (fresh) {
      const lastOption = row.querySelectorAll('.check__options [data-status]');
      const anchor = lastOption[lastOption.length - 1];
      if (anchor) anchor.after(fresh);
      else row.querySelector('.check__options')?.append(fresh);
    }
  } else if (withNote && toggle) {
    toggle.remove();
  }
  return true;
}
