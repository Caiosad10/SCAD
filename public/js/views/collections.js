/** Telas de coleções e de lista de processos. */
import { esc, plural, fmtInt, bar, emptyState } from '../ui.js';
import { icon } from '../icons.js';
import { processesOfCollection, collectionById, ui } from '../store.js';

function collectionCard(collection, isCurrent) {
  const stats = collection.stats || {};
  return (
    `<a class="card collection-card${isCurrent ? ' is-current' : ''}" href="#" data-action="open-collection" data-id="${collection.id}">` +
    `<div class="collection-card__head">` +
    `<p class="eyebrow eyebrow--bare">Coleção</p>` +
    (isCurrent ? `<span class="stamp stamp--quiet">${icon('bookmark', 11)} em uso</span>` : '') +
    `</div>` +
    `<h2 class="collection-card__title">${esc(collection.name)}</h2>` +
    (collection.description ? `<p class="collection-card__desc">${esc(collection.description)}</p>` : '') +
    `<div class="collection-card__meta">` +
    `<span>${plural(stats.processes || 0, 'processo', 'processos')}</span>` +
    `<span aria-hidden="true">·</span>` +
    `<span>${plural(stats.docs || 0, 'documento', 'documentos')}</span>` +
    `</div>` +
    `<div class="collection-card__progress">` +
    `<div class="collection-card__pct">${stats.pct || 0}<span>%</span></div>` +
    bar(stats.done || 0, stats.checks || 0, { thin: true, label: `Progresso de ${collection.name}` }) +
    `<span class="collection-card__count">${fmtInt(stats.done || 0)} de ${fmtInt(stats.checks || 0)} verificações</span>` +
    `</div>` +
    `<span class="collection-card__go">${icon('arrowRight', 15)}</span>` +
    `</a>`
  );
}

export function renderCollections(state) {
  const collections = state.collections || [];
  const totalProcesses = (state.processes || []).length;

  let body;
  if (!collections.length) {
    body = emptyState({
      iconName: 'bookmark',
      title: 'Nenhuma coleção ainda',
      text: 'Uma coleção agrupa processos de um mesmo trabalho — por exemplo, ISO 9001:2015 com DC, POP e Organograma.',
      action: `<button type="button" class="btn btn--primary" data-action="new-collection">${icon('plus', 16)} Criar coleção</button>`,
    });
  } else {
    body = `<div class="collection-grid">${collections
      .map((collection) =>
        collectionCard(collection, state.process?.collectionId === collection.id)
      )
      .join('')}</div>`;
  }

  return (
    `<div class="page page--collections">` +
    `<div class="page__head">` +
    `<div class="page__head-copy"><p class="eyebrow">Arquivo</p>` +
    `<h2 class="page__title">Coleções</h2>` +
    `<p class="page__sub">${plural(collections.length, 'coleção', 'coleções')} ` +
    `<span aria-hidden="true">·</span> ${plural(totalProcesses, 'processo', 'processos')}</p></div>` +
    `<div class="page__actions">` +
    `<button type="button" class="btn btn--primary" data-action="new-collection">${icon('plus', 16)} Nova coleção</button>` +
    `</div></div>` +
    body +
    `</div>`
  );
}

function processRow(process) {
  const stats = process.stats || {};
  return (
    `<a class="process-row" href="#" data-action="open-process" data-id="${process.id}" data-collection-id="${process.collectionId}">` +
    `<span class="process-row__main">` +
    `<span class="process-row__name">${esc(process.name)}</span>` +
    `<span class="process-row__meta">${plural(stats.docs || 0, 'documento', 'documentos')} ` +
    `<i>·</i> ${fmtInt(stats.checks || 0)} verificações ` +
    (stats.inactiveDocs ? `<i>·</i> ${plural(stats.inactiveDocs, 'inativo', 'inativos')}` : '') +
    `</span></span>` +
    `<span class="process-row__progress"><span>${stats.pct || 0}%</span>${bar(stats.done || 0, stats.checks || 0, {
      thin: true,
      label: `Progresso de ${process.name}`,
    })}</span>` +
    `<span class="process-row__pending">${
      stats.pending ? `${fmtInt(stats.pending)} pendentes` : stats.checks ? 'verificado' : 'sem checks'
    }</span>` +
    `<span class="process-row__go" aria-hidden="true">${icon('arrowRight', 15)}</span>` +
    `</a>`
  );
}

export function renderCollection(state, collectionId) {
  const collection = collectionById(state, collectionId);
  if (!collection) {
    return (
      `<div class="page">` +
      `<a class="backlink" href="#/colecoes">${icon('arrowLeft', 13)} Coleções</a>` +
      emptyState({
        iconName: 'bookmark',
        title: 'Coleção não encontrada',
        text: 'Ela pode ter sido removida em outro dispositivo.',
        action: `<a class="btn btn--secondary" href="#/colecoes">Voltar para coleções</a>`,
      }) +
      `</div>`
    );
  }
  const processes = processesOfCollection(state, collection.id);
  const stats = collection.stats || {};

  return (
    `<div class="page page--collection">` +
    `<a class="backlink" href="#/colecoes">${icon('arrowLeft', 13)} Coleções</a>` +
    `<div class="page__head">` +
    `<div class="page__head-copy"><p class="eyebrow">Coleção</p>` +
    `<h2 class="page__title">${esc(collection.name)}</h2>` +
    `<p class="page__sub">${plural(processes.length, 'processo', 'processos')} ` +
    `<span aria-hidden="true">·</span> ${plural(stats.docs || 0, 'documento', 'documentos')} ` +
    `<span aria-hidden="true">·</span> ${fmtInt(stats.done || 0)} de ${fmtInt(stats.checks || 0)} verificações</p></div>` +
    `<div class="page__actions">` +
    `<button type="button" class="btn btn--primary" data-action="new-process" data-collection-id="${collection.id}">${icon('plus', 16)} Novo processo</button>` +
    `</div></div>` +
    `<section class="collection-hero card">` +
    `<div class="collection-hero__pct">${stats.pct || 0}<span>%</span></div>` +
    `<div class="collection-hero__body">` +
    `<p class="collection-hero__label">Progresso da coleção</p>` +
    bar(stats.done || 0, stats.checks || 0, { label: `Progresso de ${collection.name}` }) +
    `<p class="collection-hero__meta">${fmtInt(stats.done || 0)} de ${fmtInt(stats.checks || 0)} verificações ` +
    `<span aria-hidden="true">·</span> ${plural(stats.pending || 0, 'pendente', 'pendentes')}` +
    (stats.inactiveDocs ? ` <span aria-hidden="true">·</span> ${plural(stats.inactiveDocs, 'documento inativo', 'documentos inativos')}` : '') +
    `</p></div></section>` +
    (processes.length
      ? `<section class="card process-list" aria-label="Processos da coleção">` +
        `<div class="section-head"><h2 class="section-head__title">Processos</h2>` +
        `<span class="section-head__meta">${plural(processes.length, 'processo', 'processos')}</span></div>` +
        processes.map(processRow).join('') +
        `</section>`
      : emptyState({
          iconName: 'docs',
          title: 'Nenhum processo nesta coleção',
          text: 'Crie um processo para começar a importar documentos e definir critérios.',
          action: `<button type="button" class="btn btn--primary" data-action="new-process" data-collection-id="${collection.id}">${icon('plus', 16)} Novo processo</button>`,
        })) +
    `</div>`
  );
}
