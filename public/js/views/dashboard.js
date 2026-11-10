import {
  esc,
  fmtInt,
  fmtFullDate,
  relTime,
  stamp,
  bar,
  ring,
  sectionHead,
  fmtBytes,
  STATUS_LABEL,
} from '../ui.js';
import { icon, statusMark } from '../icons.js';
import {
  criteriaSorted,
  docById,
  docStats,
  nextPendingDoc,
  overall,
  reviewOfDoc,
  currentProfile,
} from '../store.js';

function countLabel(n, one, many) {
  return `${fmtInt(n)} ${n === 1 ? one : many}`;
}

function metric({ label, value, unit = '', sub = '', mark = '', tone = '', href = '', action = '', filter = '' }) {
  const tag = href ? 'a' : 'div';
  const attrs = href
    ? ` href="${href}"${action ? ` data-action="${action}" data-filter="${filter}"` : ''}` +
      ` aria-label="${esc(label)}: ${esc(value)}${unit ? ` ${esc(unit)}` : ''}. ${esc(sub)}"`
    : '';
  return (
    `<${tag} class="metric${tone ? ` metric--${tone}` : ''}${href ? ' metric--link' : ''}"${attrs}>` +
    `<p class="metric__label">${esc(label)}</p>` +
    `<p class="metric__value">${esc(value)}${unit ? `<span class="metric__unit">${esc(unit)}</span>` : ''}</p>` +
    `<p class="metric__sub">${esc(sub)}</p>` +
    (href ? `<span class="metric__go" aria-hidden="true">${icon('arrowRight', 13)}</span>` : '') +
    (mark ? `<span class="metric__mark">${mark}</span>` : '') +
    `</${tag}>`
  );
}

export function renderDashboard(state) {
  const s = overall(state);
  const crit = criteriaSorted(state);
  const docs = state.documents;
  const lastDoc = state.meta.lastDocId ? docById(state, state.meta.lastDocId) : null;
  const continueDoc = lastDoc && docStats(state, lastDoc.id).pending > 0 ? lastDoc : nextPendingDoc(state);
  const complete = s.total > 0 && s.pending === 0;
  const started = s.done > 0;

  const stampText = complete ? 'Concluído' : docs.length ? 'Em análise' : 'Sem documentos';
  const stampClass = complete ? ' hero__stamp--ok' : docs.length ? '' : ' hero__stamp--idle';

  let title;
  let lead;
  let actions;
  const reviewer = currentProfile(state)?.role === 'reviewer';

  if (reviewer && (s.reviewAwaiting || s.reviewAttention)) {
    title = 'Há documentos esperando sua revisão.';
    const parts = [];
    if (s.reviewAwaiting) {
      parts.push(countLabel(s.reviewAwaiting, 'documento aguardando revisão', 'documentos aguardando revisão'));
    }
    if (s.reviewAttention) {
      parts.push(countLabel(s.reviewAttention, 'documento com sinalização', 'documentos com sinalização'));
    }
    if (s.reviewApproved) {
      parts.push(countLabel(s.reviewApproved, 'já aprovado', 'já aprovados'));
    }
    lead = `${parts.join(' · ')}.`;
    actions =
      `<button type="button" class="btn btn--primary" data-action="review-queue">${icon('check', 16)} Revisar fila</button>` +
      `<a class="btn btn--ghost" href="#/documentos">Ver documentos</a>`;
  } else if (!docs.length) {
    title = 'O arquivo está aberto, mas ainda sem documentos.';
    lead = `Os critérios já existem (${crit.length}). Importe os documentos e o SCAD cria automaticamente ${crit.length} verificação${crit.length === 1 ? '' : 'ões'} para cada arquivo.`;
    actions =
      `<button type="button" class="btn btn--primary" data-action="open-import">${icon('upload', 16)} Importar documentos</button>` +
      `<a class="btn btn--ghost" href="#/ajustes">Revisar critérios</a>`;
  } else if (complete) {
    title = 'Todas as verificações foram concluídas.';
    lead = s.nc + s.obs
      ? `Restam ${countLabel(s.nc + s.obs, 'apontamento para revisar', 'apontamentos para revisar')} antes de encerrar o processo.`
      : 'Nenhum apontamento registrado. O processo pode ser encerrado e exportado.';
    actions =
      `<a class="btn btn--primary" href="#/apontamentos">${icon('findings', 16)} Revisar apontamentos</a>` +
      `<a class="btn btn--ghost" href="#/documentos">Ver documentos</a>`;
  } else if (started) {
    title = 'A análise está em curso.';
    lead = lastDoc
      ? `Você parou em <b>${esc(lastDoc.name)}</b>. ${countLabel(s.pending, 'verificação pendente', 'verificações pendentes')} no processo.`
      : `Faltam ${countLabel(s.pending, 'verificação', 'verificações')} para concluir o processo.`;
    actions =
      (continueDoc
        ? `<a class="btn btn--primary" href="#/analisar/${continueDoc.id}">${icon('arrowRight', 16)} Continuar análise</a>`
        : '') +
      `<a class="btn btn--ghost" href="#/documentos">Ver documentos</a>`;
  } else {
    title = 'Tudo pronto para a primeira verificação.';
    lead = `${countLabel(docs.length, 'documento', 'documentos')} × ${countLabel(crit.length, 'critério', 'critérios')} = ${countLabel(s.total, 'verificação', 'verificações')}. Abra a bancada e comece pelo primeiro documento.`;
    actions =
      (continueDoc
        ? `<a class="btn btn--primary" href="#/analisar/${continueDoc.id}">${icon('analyze', 16)} Começar a análise</a>`
        : '') +
      `<button type="button" class="btn btn--ghost" data-action="open-import">${icon('upload', 15)} Importar mais</button>`;
  }

  const counts = [];
  if (s.total) {
    counts.push(stamp('ok', { quiet: true, label: countLabel(s.ok, 'conforme', 'conformes') }));
    counts.push(stamp('nc', { quiet: true, label: countLabel(s.nc, 'não conforme', 'não conformes') }));
    counts.push(stamp('obs', { quiet: true, label: countLabel(s.obs, 'observação', 'observações') }));
    if (s.inactiveDocs) {
      counts.push(stamp('na', { quiet: true, label: countLabel(s.inactiveDocs, 'inativo', 'inativos') }));
    }
    counts.push(stamp('pending', { quiet: true, label: countLabel(s.pending, 'pendente', 'pendentes') }));
  }

  const hero =
    `<section class="card hero" aria-labelledby="hero-title">` +
    `<span class="hero__stamp${stampClass}">${esc(stampText)}</span>` +
    `<div class="hero__body">` +
    `<div class="hero__text">` +
    `<p class="eyebrow">Sessão de análise</p>` +
    `<h2 class="hero__title" id="hero-title">${esc(title)}</h2>` +
    `<p class="hero__lead">${lead}</p>` +
    (counts.length ? `<div class="hero__counts">${counts.join('')}</div>` : '') +
    `<div class="hero__actions">${actions}</div>` +
    `</div>` +
    `<div class="gauge" role="img" aria-label="${s.pct}% das verificações concluídas">` +
    ring(s.pct) +
    `<div class="gauge__center"><span class="gauge__value">${s.pct}<span>%</span></span>` +
    `<span class="gauge__label">concluído</span></div>` +
    `</div>` +
    `</div>` +
    `</section>`;

  const metrics =
    `<div class="metrics">` +
    metric({
      label: 'Documentos',
      value: fmtInt(s.docs),
      sub: s.docs
        ? [
            s.pendingDocs ? `${countLabel(s.pendingDocs, 'com pendência', 'com pendências')}` : 'todos verificados',
            s.inactiveDocs ? `${countLabel(s.inactiveDocs, 'inativo', 'inativos')}` : '',
          ]
            .filter(Boolean)
            .join(' · ')
        : 'nenhum importado',
      mark: icon('docs', 26),
      tone: 'docs',
      href: '#/documentos',
    }) +
    metric({
      label: 'Verificações',
      value: fmtInt(s.total),
      unit: 'no total',
      sub: `${fmtInt(s.done)} concluídas${s.suspended ? ` · ${fmtInt(s.suspended)} suspensas` : ''}`,
      mark: icon('analyze', 26),
      tone: 'docs',
    }) +
    metric({
      label: 'Não conformes',
      value: fmtInt(s.nc),
      sub: s.nc ? 'registradas no processo' : 'nenhuma até agora',
      mark: statusMark('nc', 24),
      tone: 'nc',
      href: '#/apontamentos',
      action: 'metric-filter',
      filter: 'nc',
    }) +
    metric({
      label: 'Observações',
      value: fmtInt(s.obs),
      sub: s.obs ? 'itens para acompanhar' : 'nenhuma até agora',
      mark: statusMark('obs', 24),
      tone: 'obs',
      href: '#/apontamentos',
      action: 'metric-filter',
      filter: 'obs',
    }) +
    `</div>`;

  const reviewStrip =
    s.reviewAwaiting || s.reviewAttention || s.reviewApproved
      ? `<div class="review-strip">` +
        `<span class="review-strip__label">Revisão</span>` +
        `<a class="review-strip__link" href="#/documentos" data-action="review-filter" data-filter="awaiting">` +
        `Aguardando revisão <b>${fmtInt(s.reviewAwaiting)}</b></a>` +
        `<span class="review-strip__sep" aria-hidden="true">·</span>` +
        `<a class="review-strip__link" href="#/documentos" data-action="review-filter" data-filter="attention">` +
        `Atenção <b>${fmtInt(s.reviewAttention)}</b></a>` +
        `<span class="review-strip__ok">Aprovados <b>${fmtInt(s.reviewApproved)}</b></span>` +
        `</div>`
      : '';

  let matrixBody;
  if (!docs.length) {
    matrixBody =
      `<div class="matrix-empty">` +
      `Sem documentos. Depois da importação, cada arquivo aparece aqui com uma coluna por critério.` +
      `</div>`;
  } else if (!crit.length) {
    matrixBody = `<div class="matrix-empty">Nenhum critério definido. <a href="#/ajustes">Adicionar critério</a>.</div>`;
  } else {
    const head =
      `<thead><tr><th scope="col" class="matrix__dochead">Documento</th>` +
      crit
        .map(
          (c, i) =>
            `<th scope="col" title="${esc(c.label)}">` +
            `<span class="matrix__code">C${String(i + 1).padStart(2, '0')}</span>` +
            `<span class="matrix__label">${esc(c.label)}</span></th>`
        )
        .join('') +
      `<th scope="col" class="is-status">Situação</th></tr></thead>`;
    const cols =
      `<colgroup><col style="width:26%">` +
      crit.map(() => '<col>').join('') +
      `<col style="width:64px"></colgroup>`;

    const rows = docs
      .map((doc, index) => {
        const st = docStats(state, doc.id);
        const inactive = doc.active === false;
        const review = reviewOfDoc(state, doc.id);
        const statusText = inactive
          ? 'Inativo'
          : review.status === 'approved'
            ? 'Aprovado'
            : review.status === 'attention'
              ? 'Atenção'
              : review.status === 'awaiting'
                ? 'Revisão'
                : `${st.done}/${st.total}`;
        const cells = inactive
          ? crit
              .map(
                (criterion) =>
                  `<td><div class="matrix__cellwrap"><span class="matrix__dash" title="${esc(
                    criterion.label
                  )}: verificação suspensa">—</span></div></td>`
              )
              .join('')
          : crit
              .map((criterion) => {
                const check = state.checks.find((c) => c.docId === doc.id && c.criterionId === criterion.id);
                const status = check?.status || 'pending';
                const label = `${doc.name}, ${criterion.label}: ${STATUS_LABEL[status]}`;
                return (
                  `<td><div class="matrix__cellwrap">` +
                  `<a class="matrix__cell matrix__cell--${status}" href="#/analisar/${doc.id}" ` +
                  `title="${esc(criterion.label)} — ${esc(STATUS_LABEL[status])}" aria-label="${esc(label)}">` +
                  `${statusMark(status, 22)}</a>` +
                  `</div></td>`
                );
              })
              .join('');
        return (
          `<tr class="${inactive ? 'matrix__row--inactive' : ''}">` +
          `<td><a class="matrix__doc" href="#/analisar/${doc.id}">` +
          `<span class="matrix__num">${String(index + 1).padStart(2, '0')}</span>` +
          `<span class="matrix__name">${esc(doc.name)}</span></a></td>` +
          cells +
          `<td class="matrix__status"><span class="matrix__status-text matrix__status-text--${esc(
            review.status
          )}">${esc(statusText)}</span></td>` +
          `</tr>`
        );
      })
      .join('');

    const minWidth = 210 + crit.length * 86 + 58;
    matrixBody =
      `<div class="matrix__scroll matrix"><table style="min-width:${minWidth}px">${cols}${head}<tbody>${rows}</tbody></table></div>` +
      `<div class="matrix__legend">` +
      `<span>${statusMark('pending', 15)} pendente</span>` +
      `<span>${statusMark('ok', 15)} conforme</span>` +
      `<span>${statusMark('nc', 15)} não conforme</span>` +
      `<span>${statusMark('obs', 15)} observação</span>` +
      `<span class="matrix__legend-inactive">— inativo</span>` +
      `</div>`;
  }

  const matrix =
    `<section class="card">` +
    sectionHead({
      title: 'Matriz de verificação',
      meta: docs.length && crit.length ? `${docs.length} × ${crit.length}` : '',
      action:
        docs.length && crit.length
          ? `<a class="section-head__action" href="#/documentos">Ver documentos</a>`
          : '',
    }) +
    matrixBody +
    `</section>`;

  const critRows = crit.length
    ? crit
        .map((criterion, index) => {
          const checks = state.checks.filter((c) => c.criterionId === criterion.id);
          const done = checks.filter((c) => c.status !== 'pending').length;
          const total = checks.length;
          const pct = total ? Math.round((done / total) * 100) : 0;
          return (
            `<div class="crit-row">` +
            `<div class="crit-row__top">` +
            `<span class="crit-row__num">C${String(index + 1).padStart(2, '0')}</span>` +
            `<span class="crit-row__label">${esc(criterion.label)}</span>` +
            `<span class="crit-row__count">${done}/${total}</span>` +
            `</div>` +
            bar(done, total, { thin: true, label: `Progresso de ${criterion.label}` }) +
            `</div>`
          );
        })
        .join('')
    : `<div class="act-empty">Nenhum critério definido.</div>`;

  const activity = (state.activity || []).slice(0, 6);
  const activityHtml = activity.length
    ? activity
        .map(
          (item) =>
            `<div class="act"><span class="act__dot" aria-hidden="true"></span>` +
            `<span>${item.actorName ? `<b class="act__actor">${esc(item.actorName)}</b> ` : ''}${esc(
              item.text
            )}</span>` +
            `<span class="act__time">${esc(relTime(item.at))}</span></div>`
        )
        .join('')
    : `<div class="act-empty">As importações e verificações aparecem aqui.</div>`;

  const lower =
    `<div class="dash-lower">` +
    `<section class="card">` +
    sectionHead({
      title: 'Por critério',
      action: `<a class="section-head__action" href="#/ajustes">Ajustar</a>`,
    }) +
    `<div class="crit-list">${critRows}</div>` +
    `</section>` +
    `<section class="card">` +
    sectionHead({ title: 'Atividade' }) +
    `<div class="activity">${activityHtml}</div>` +
    `</section>` +
    `</div>`;

  return (
    `<div class="view view--dashboard">` +
    hero +
    metrics +
    reviewStrip +
    matrix +
    lower +
    `</div>`
  );
}
