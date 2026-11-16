import { esc, stamp, emptyState, relTime, fmtTime, plural } from '../ui.js';
import { icon } from '../icons.js';
import { findings, overall, ui, customStatuses, statusLabelFor, isPointedStatus } from '../store.js';

function matchFinding(item, query) {
  if (!query) return true;
  const haystack = `${item.doc.name} ${item.criterion?.label || ''} ${item.check.note || ''}`.toLowerCase();
  return haystack.includes(query);
}

export function filteredFindings(state) {
  const query = ui.findQuery.trim().toLowerCase();
  return findings(state).filter((item) => {
    if (ui.findFilter === 'nc' && item.check.status !== 'nc') return false;
    if (ui.findFilter === 'obs' && item.check.status !== 'obs') return false;
    if (
      ui.findFilter &&
      ui.findFilter !== 'all' &&
      ui.findFilter !== 'nc' &&
      ui.findFilter !== 'obs' &&
      item.check.status !== ui.findFilter
    ) {
      return false;
    }
    return matchFinding(item, query);
  });
}

/** Rótulo da severidade do apontamento para filtros e leitura. */
function findingStamp(state, status) {
  const label = statusLabelFor(state, status);
  if (status === 'nc' || status === 'obs') return stamp(status);
  return stamp('custom', { label });
}

function countsByStatus(all, state) {
  const out = { all: all.length, nc: 0, obs: 0 };
  for (const custom of customStatuses(state)) out[custom.id] = 0;
  for (const item of all) {
    out[item.check.status] = (out[item.check.status] || 0) + 1;
  }
  return out;
}

export function renderFindings(state) {
  const all = findings(state);
  const items = filteredFindings(state);
  const s = overall(state);
  const counts = countsByStatus(all, state);
  const customs = customStatuses(state);

  const filters = [
    { id: 'all', label: 'Todos', count: counts.all },
    { id: 'nc', label: 'Não conformes', count: counts.nc },
    { id: 'obs', label: 'Observações', count: counts.obs },
    ...customs.map((custom) => ({ id: custom.id, label: custom.label, count: counts[custom.id] || 0 })),
  ]
    .map(
      (filter) =>
        `<button type="button" data-action="filter-findings" data-filter="${filter.id}" ` +
        `aria-pressed="${ui.findFilter === filter.id}">${esc(filter.label)}` +
        `<span class="segmented__count">${filter.count}</span></button>`
    )
    .join('');

  return (
    `<div class="page page--findings">` +
    `<div class="page__head">` +
    `<div class="page__head-copy"><p class="eyebrow">Registro</p>` +
    `<h2 class="page__title">Apontamentos</h2>` +
    `<p class="page__sub">${all.length} apontamento${all.length === 1 ? '' : 's'} <span aria-hidden="true">·</span> ${plural(s.docs, 'item', 'itens')}</p></div>` +
    `<div class="page__actions">` +
    `<button type="button" class="btn btn--secondary" data-action="export-csv">${icon('download', 15)} Exportar CSV</button>` +
    `<button type="button" class="iconbtn" data-action="print" aria-label="Imprimir apontamentos" title="Imprimir">${icon(
      'print',
      17
    )}</button>` +
    `</div></div>` +
    (all.length
      ? `<div class="toolbar">` +
        `<div class="segmented" role="group" aria-label="Filtrar apontamentos">${filters}</div>` +
        `<div class="toolbar__right">` +
        `<label class="search">${icon('search', 16)}` +
        `<input type="search" data-filter="find-query" value="${esc(ui.findQuery)}" ` +
        `placeholder="Buscar em notas e critérios…" aria-label="Buscar apontamentos"></label>` +
        `</div></div>`
      : '') +
    `<div id="findings-results">${renderFindingsResults(state)}</div>` +
    `</div>`
  );
}

export function renderFindingsResults(state) {
  const all = findings(state);
  const items = filteredFindings(state);
  const nc = all.filter((f) => f.check.status === 'nc').length;
  const obs = all.filter((f) => f.check.status === 'obs').length;

  if (!all.length) {
    return emptyState({
      iconName: 'findings',
      title: 'Nenhum apontamento registrado',
      text: 'Ao marcar uma verificação como “Não conforme”, “Observação” ou outro estado de apontamento (ex.: “Ausente”), o registro aparece aqui com a nota e o critério.',
      action: `<a class="btn btn--secondary" href="#/analisar">${icon('analyze', 16)} Ir para a bancada</a>`,
    });
  }

  if (!items.length) {
    return emptyState({
      iconName: 'search',
      title: 'Nenhum apontamento neste filtro',
      text: 'Ajuste a busca, o tipo de apontamento ou limpe os filtros.',
      action: `<button type="button" class="btn btn--secondary" data-action="clear-finding-filters">Limpar busca e filtros</button>`,
    });
  }

  const groups = new Map();
  for (const item of items) {
    if (!groups.has(item.doc.id)) groups.set(item.doc.id, { doc: item.doc, items: [] });
    groups.get(item.doc.id).items.push(item);
  }

  return [...groups.values()]
    .map(({ doc, items: groupItems }) => {
      const rows = groupItems
        .map(({ check, criterion }) => {
          const note = (check.note || '').trim();
          return (
            `<div class="finding">` +
            `<div>${findingStamp(state, check.status)}</div>` +
            `<div class="finding__body">` +
            `<p class="finding__crit">${esc(criterion?.label || 'Critério removido')}</p>` +
            `<p class="finding__note${note ? '' : ' is-empty'}">${esc(
              note || 'Sem nota registrada — descreva o apontamento para não perder o contexto.'
            )}</p>` +
            `<p class="finding__meta">atualizado ${esc(relTime(check.updatedAt))} · ${esc(fmtTime(check.updatedAt))}</p>` +
            `</div>` +
            `<div class="finding__actions">` +
            `<button type="button" class="iconbtn iconbtn--sm" data-action="finding-edit" data-check-id="${check.id}" ` +
            `data-doc-id="${doc.id}" aria-label="Editar nota do apontamento" title="Editar nota">${icon('pen', 15)}</button>` +
            `<a class="iconbtn iconbtn--sm" href="#/analisar/${doc.id}" aria-label="Abrir documento na bancada" title="Abrir na bancada">${icon(
              'arrowRight',
              15
            )}</a>` +
            `</div></div>`
          );
        })
        .join('');

      return (
        `<section class="card finding-group">` +
        `<div class="finding-group__head">` +
        `<a class="finding-group__name" href="#/documentos/${doc.id}">${esc(doc.name)}</a>` +
        `<span class="finding-group__count">${plural(groupItems.length, 'apontamento', 'apontamentos')}</span>` +
        `</div>${rows}</section>`
      );
    })
    .join('');
}
