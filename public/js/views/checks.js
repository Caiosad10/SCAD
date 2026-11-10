import { esc, fmtTime, stamp, bar, STATUS_LABEL } from '../ui.js';
import { icon, statusMark } from '../icons.js';
import {
  criteriaSorted,
  docStats,
  ui,
  reviewOfDoc,
  checkReview,
  currentProfile,
  presenceOnDoc,
} from '../store.js';

const OPTIONS = [
  { status: 'ok', label: 'Conforme' },
  { status: 'nc', label: 'Não conforme' },
  { status: 'obs', label: 'Observação' },
];

export function showNoteFor(check) {
  return (
    check.status === 'nc' ||
    check.status === 'obs' ||
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
  if (review.status === 'awaiting') return stamp('pending', { label: 'Aguardando revisão' });
  if (st.nc) return stamp('nc', { label: 'Apontamento' });
  if (st.obs) return stamp('obs', { label: 'Apontamento' });
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

export function renderCheckRow(state, check, criterion, index, options = {}) {
  const status = check.status || 'pending';
  const note = check.note || '';
  const withNote = showNoteFor(check);
  const label = criterion?.label || 'Critério removido';
  const code = `C${String(index + 1).padStart(2, '0')}`;
  const review = status === 'pending' ? 'pending' : checkReview(check);
  const reviewer = isReviewer(state);

  const optionButtons = OPTIONS.map(
    (option) =>
      `<button type="button" class="opt opt--${option.status}" data-action="set-check" ` +
      `data-id="${check.id}" data-status="${option.status}" aria-pressed="${status === option.status}" ` +
      `${options.disabled ? 'disabled' : ''} ` +
      `aria-label="${esc(label)}: ${esc(STATUS_LABEL[option.status])}" ` +
      `title="${esc(STATUS_LABEL[option.status])} (${OPTIONS.indexOf(option) + 1})">` +
      `${statusMark(option.status, 13)}<span>${esc(option.label)}</span></button>`
  ).join('');

  const noteToggle =
    withNote || options.disabled
      ? ''
      : `<button type="button" class="note-toggle" data-action="note-toggle" data-id="${check.id}">+ nota</button>`;

  const noteBlock = withNote
    ? `<div class="check__note">` +
      `<textarea id="note-${check.id}" data-note-id="${check.id}" rows="2" ${options.disabled ? 'readonly' : ''} ` +
      `aria-label="Nota de ${esc(label)}" ` +
      `placeholder="Evidência, trecho ou motivo do apontamento…">${esc(note)}</textarea>` +
      `<div class="check__note-bar">` +
      `<span class="autosave" data-save-state="saved">${note ? `salvo · ${esc(fmtTime(check.updatedAt))}` : 'vazio'}</span>` +
      (note && !options.disabled
        ? `<button type="button" class="note-clear" data-action="clear-note" data-id="${check.id}">limpar</button>`
        : `<span></span>`) +
      `</div></div>`
    : '';

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
    `aria-label="${esc(label)}: ${esc(STATUS_LABEL[status])}">` +
    `<div class="check__head">` +
    `<span class="check__mark">${code}</span>` +
    `<div class="check__label"><h3>${esc(label)}</h3>` +
    (criterion?.hint ? `<p class="check__hint">${esc(criterion.hint)}</p>` : '') +
    `</div>` +
    `<span class="check__stamp">${stamp(status)}</span>` +
    `</div>` +
    `<div class="check__options" role="group" aria-label="Resultado de ${esc(label)}">` +
    optionButtons +
    noteToggle +
    `</div>` +
    reviewRow +
    noteBlock +
    flagAction +
    nextButton +
    `</article>`
  );
}

export function checksHeadHtml(state, doc) {
  const st = docStats(state, doc.id);
  if (doc.active === false) {
    return (
      `<div class="checks__head" data-checks-head>` +
      `<div class="checks__summary"><span class="checks__num">—</span>` +
      `<span>verificações suspensas</span></div>` +
      `<div class="checks__meter">${bar(0, 0, { label: 'Documento inativo' })}</div>` +
      `</div>`
    );
  }
  return (
    `<div class="checks__head" data-checks-head>` +
    `<div class="checks__summary"><span class="checks__num">${st.done}</span>` +
    `<span>de ${st.total} verificações</span></div>` +
    `<div class="checks__meter">${bar(st.done, st.total, { label: 'Progresso do documento' })}</div>` +
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
  return (
    `<div class="done"><span class="done__icon">${statusMark('ok', 17)}</span>` +
    `<div><h3>Documento verificado</h3><p>${
      st.nc || st.obs
        ? `${st.nc} não conforme(s) e ${st.obs} observação(ões) registradas.`
        : 'Todos os critérios foram avaliados.'
    } ${review.status === 'awaiting' ? 'Aguardando revisão.' : ''}</p></div></div>`
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
