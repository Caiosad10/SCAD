import { esc, fmtTime, stamp, bar, STATUS_LABEL } from '../ui.js';
import { icon, statusMark } from '../icons.js';
import { criteriaSorted, docStats, ui } from '../store.js';

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
  const st = docStats(state, doc.id);
  if (st.nc) return stamp('nc', { label: 'Apontamento' });
  if (st.obs) return stamp('obs', { label: 'Apontamento' });
  if (st.total && st.pending === 0) return stamp('ok', { label: 'Verificado' });
  return stamp('pending', { label: 'Em análise' });
}

export function docSummaryHtml(state, doc) {
  const st = docStats(state, doc.id);
  return (
    `<span>${st.done}/${st.total} verificações</span>` +
    `<span aria-hidden="true">·</span>${docTagHtml(state, doc)}`
  );
}

export function renderCheckRow(state, check, criterion, index, options = {}) {
  const status = check.status || 'pending';
  const note = check.note || '';
  const withNote = showNoteFor(check);
  const label = criterion?.label || 'Critério removido';
  const code = `C${String(index + 1).padStart(2, '0')}`;

  const optionButtons = OPTIONS.map(
    (option) =>
      `<button type="button" class="opt opt--${option.status}" data-action="set-check" ` +
      `data-id="${check.id}" data-status="${option.status}" aria-pressed="${status === option.status}" ` +
      `aria-label="${esc(label)}: ${esc(STATUS_LABEL[option.status])}" ` +
      `title="${esc(STATUS_LABEL[option.status])} (${OPTIONS.indexOf(option) + 1})">` +
      `${statusMark(option.status, 13)}<span>${esc(option.label)}</span></button>`
  ).join('');

  const noteToggle = withNote
    ? ''
    : `<button type="button" class="note-toggle" data-action="note-toggle" data-id="${check.id}">+ nota</button>`;

  const noteBlock = withNote
    ? `<div class="check__note">` +
      `<textarea id="note-${check.id}" data-note-id="${check.id}" rows="2" ` +
      `aria-label="Nota de ${esc(label)}" ` +
      `placeholder="Evidência, trecho ou motivo do apontamento…">${esc(note)}</textarea>` +
      `<div class="check__note-bar">` +
      `<span class="autosave" data-save-state="saved">${note ? `salvo · ${esc(fmtTime(check.updatedAt))}` : 'vazio'}</span>` +
      (note
        ? `<button type="button" class="note-clear" data-action="clear-note" data-id="${check.id}">limpar</button>`
        : `<span></span>`) +
      `</div></div>`
    : '';

  const nextButton = options.isLast
    ? ''
    : `<div class="check__next">` +
      `<button type="button" class="btn btn--ghost btn--sm" data-action="next-check" data-id="${check.id}">` +
      `Próximo critério ${icon('chevronDown', 14)}</button></div>`;

  return (
    `<article class="check check--${status}" data-check-row="${check.id}" tabindex="0" ` +
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
    noteBlock +
    nextButton +
    `</article>`
  );
}

export function checksHeadHtml(state, doc) {
  const st = docStats(state, doc.id);
  return (
    `<div class="checks__head" data-checks-head>` +
    `<div class="checks__summary"><span class="checks__num">${st.done}</span>` +
    `<span>de ${st.total} verificações</span></div>` +
    `<div class="checks__meter">${bar(st.done, st.total, { label: 'Progresso do documento' })}</div>` +
    `</div>`
  );
}

export function doneBannerHtml(state, doc) {
  const st = docStats(state, doc.id);
  if (!st.total || st.pending > 0) return '';
  return (
    `<div class="done"><span class="done__icon">${statusMark('ok', 17)}</span>` +
    `<div><h3>Documento verificado</h3><p>${
      st.nc || st.obs
        ? `${st.nc} não conforme(s) e ${st.obs} observação(ões) registradas.`
        : 'Todos os critérios foram avaliados.'
    }</p></div></div>`
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
      return renderCheckRow(state, check, criterion, index, { isLast: index === crit.length - 1 });
    })
    .join('');

  return (
    checksHeadHtml(state, doc) +
    `<div data-done-slot>${doneBannerHtml(state, doc)}</div>` +
    (rows || `<div class="matrix-empty">Nenhum critério definido para este documento.</div>`) +
    (options.footer || '')
  );
}
