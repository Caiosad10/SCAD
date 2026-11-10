import { esc, fmtFullDate, plural, stamp } from '../ui.js';
import { icon } from '../icons.js';
import { criteriaSorted, overall, ui, currentProfile } from '../store.js';

function accessList() {
  const health = ui.health;
  const lan = health?.lan || [];
  const current = window.location.origin;
  const addresses = [{ label: 'Este computador', url: current }];
  for (const item of lan) {
    if (item.url !== current) addresses.push({ label: item.label, url: item.url });
  }
  return (
    `<div class="access-list">` +
    addresses
      .map(
        (item, index) =>
          `<div class="access-item"><div class="url-box">` +
          `<code title="${esc(item.url)}">${esc(item.url)}</code>` +
          `<button type="button" class="iconbtn iconbtn--sm" data-action="copy" data-value="${esc(item.url)}" ` +
          `aria-label="Copiar endereço ${esc(item.url)}" title="Copiar">${icon('copy', 15)}</button>` +
          `</div>` +
          `<span class="access-note">${index === 0 ? 'Endereço atual' : `Rede local — abra este no iPad (${esc(item.label)})`}</span>` +
          `</div>`
      )
      .join('') +
    `</div>`
  );
}

export function renderSettings(state) {
  const s = overall(state);
  const crit = criteriaSorted(state);
  const proc = state.process || {};
  const processChecks = state.checks.length;

  const criteriaRows = crit
    .map(
      (criterion, index) =>
        `<div class="crit-edit" data-criterion-row="${criterion.id}">` +
        `<span class="crit-edit__num">C${String(index + 1).padStart(2, '0')}</span>` +
        `<input type="text" value="${esc(criterion.label)}" data-criterion-label="${criterion.id}" ` +
        `aria-label="Nome do critério ${index + 1}" maxlength="160">` +
        `<div class="crit-edit__actions">` +
        `<button type="button" class="iconbtn iconbtn--sm" data-action="criterion-up" data-id="${criterion.id}" ` +
        `aria-label="Mover ${esc(criterion.label)} para cima" title="Mover para cima" ${index === 0 ? 'disabled' : ''}>${icon(
          'chevronUp',
          14
        )}</button>` +
        `<button type="button" class="iconbtn iconbtn--sm" data-action="criterion-down" data-id="${criterion.id}" ` +
        `aria-label="Mover ${esc(criterion.label)} para baixo" title="Mover para baixo" ${
          index === crit.length - 1 ? 'disabled' : ''
        }>${icon('chevronDown', 14)}</button>` +
        `<button type="button" class="iconbtn iconbtn--sm iconbtn--danger" data-action="criterion-delete" data-id="${
          criterion.id
        }" aria-label="Excluir ${esc(criterion.label)}" title="Excluir">${icon('trash', 14)}</button>` +
        `</div></div>`
    )
    .join('');

  const currentUrl = window.location.origin;

  return (
    `<div class="page page--settings">` +
    `<div class="page__head"><div class="page__head-copy"><p class="eyebrow">Configuração</p>` +
    `<h2 class="page__title">Ajustes</h2>` +
    `<p class="page__sub">${esc(state.collection?.name || 'Coleção')} <span aria-hidden="true">·</span> ${esc(
      proc.name || 'Processo'
    )} <span aria-hidden="true">·</span> criado em ${esc(fmtFullDate(proc.createdAt))}</p></div></div>` +
    `<div class="settings">` +
    `<div class="settings__col">` +
    `<section class="card">` +
    `<div class="section-head"><h2 class="section-head__title">Processo</h2>` +
    `<span class="section-head__meta">${plural(s.docs, 'documento', 'documentos')} · ${plural(
      processChecks,
      'verificação',
      'verificações'
    )}</span></div>` +
    `<form class="card__body" id="process-form">` +
    `<div class="field"><label for="setting-name">Nome do processo</label>` +
    `<input id="setting-name" name="name" type="text" maxlength="120" value="${esc(proc.name || '')}" required></div>` +
    `<div class="field"><label for="setting-desc">Descrição</label>` +
    `<textarea id="setting-desc" name="description" rows="3" maxlength="1000">${esc(proc.description || '')}</textarea></div>` +
    `<div class="form-row"><button class="btn btn--primary" type="submit">${icon('check', 16)} Salvar processo</button>` +
    `<a class="btn btn--ghost btn--sm" href="#/colecoes/${esc(state.collection?.id || '')}">${icon(
      'bookmark',
      14
    )} Ver coleção</a></div>` +
    `<p class="field__hint">O código interno não aparece na interface; as exportações trazem a identificação legível do processo.</p>` +
    `</form></section>` +
    `<section class="card">` +
    `<div class="section-head"><h2 class="section-head__title">Critérios de verificação</h2>` +
    `<span class="section-head__meta">${plural(crit.length, 'critério', 'critérios')}</span></div>` +
    `<div class="card__body">` +
    `<div class="form-row" style="margin-bottom:12px">` +
    `<button class="btn btn--secondary btn--sm" type="button" data-action="copy-criteria" ${
      (state.processes || []).length > 1 ? '' : 'disabled'
    }>${icon('copy', 14)} Copiar critérios de outro processo</button>` +
    `</div>` +
    (crit.length
      ? criteriaRows
      : `<p class="field__hint">Nenhum critério. Adicione ao menos um para gerar verificações.</p>`) +
    `<form class="form-row" id="criterion-form">` +
    `<label class="sr-only" for="criterion-label">Novo critério</label>` +
    `<input id="criterion-label" name="label" type="text" maxlength="160" placeholder="Novo critério…" autocomplete="off" required>` +
    `<button class="btn btn--secondary btn--sm" type="submit">${icon('plus', 15)} Adicionar</button>` +
    `</form>` +
    `<p class="field__hint">Cada critério cria uma verificação pendente em todos os ${plural(
      s.docs,
      'documento',
      'documentos'
    )}. Ao excluir, as verificações daquele critério também saem.</p>` +
    `</div></section>` +
    `</div>` +
    `<div class="settings__col">` +
    `<section class="card">` +
    `<div class="section-head"><h2 class="section-head__title">Perfil</h2>` +
    `<span class="section-head__meta">autoria</span></div>` +
    `<div class="card__body">` +
    `<div class="setting-row"><div class="setting-row__copy"><strong>${esc(
      currentProfile(state)?.name || 'Nenhum perfil escolhido'
    )}</strong><span>${
      currentProfile(state)?.role === 'reviewer'
        ? 'Revisor — aprova e sinaliza verificações.'
        : 'Analista — registra verificações e correções.'
    } Toda alteração nova fica atribuída a este nome.</span></div>` +
    `<button type="button" class="btn btn--secondary btn--sm" data-action="switch-profile">Trocar</button></div>` +
    `</div></section>` +
    `<section class="card">` +
    `<div class="section-head"><h2 class="section-head__title">Dados e backup</h2>` +
    `<span class="section-head__meta">local</span></div>` +
    `<div class="card__body">` +
    `<div class="setting-row"><div class="setting-row__copy"><strong>Backup do processo</strong>` +
    `<span>Metadados, critérios, verificações e notas em JSON. Os arquivos ficam na pasta data/files.</span></div>` +
    `<a class="btn btn--secondary btn--sm" href="${esc('/api/export')}" download>${icon('download', 15)} JSON</a></div>` +
    `<div class="setting-row"><div class="setting-row__copy"><strong>Apontamentos em planilha</strong>` +
    `<span>CSV com documento, critério, resultado e nota — abre no Excel e no Numbers.</span></div>` +
    `<button type="button" class="btn btn--secondary btn--sm" data-action="export-csv">${icon('download', 15)} CSV</button></div>` +
    `<div class="setting-row"><div class="setting-row__copy"><strong>Restaurar backup</strong>` +
    `<span>Substitui o estado atual pelo conteúdo do arquivo JSON.</span></div>` +
    `<button type="button" class="btn btn--ghost btn--sm" data-action="restore-backup">Restaurar</button>` +
    `<input type="file" id="restore-input" accept="application/json,.json" class="sr-only"></div>` +
    `<div class="setting-row"><div class="setting-row__copy"><strong>Reiniciar tudo</strong>` +
    `<span>Apaga processo, critérios, documentos e arquivos. Não há desfazer.</span></div>` +
    `<button type="button" class="btn btn--danger btn--sm" data-action="reset-data">Apagar tudo</button></div>` +
    `</div></section>` +
    `<section class="card">` +
    `<div class="section-head"><h2 class="section-head__title">Acesso no iPad</h2>` +
    `<span class="section-head__meta">rede local</span></div>` +
    `<div class="card__body">` +
    accessList() +
    `<p class="access-note"><strong>Mesma rede Wi-Fi.</strong> Mantenha este computador ligado com o servidor rodando. ` +
    `No iPad, abra o endereço no Safari e use <strong>Compartilhar → Adicionar à Tela de Início</strong> para abrir como app. ` +
    `Se o iPad não conectar, permita o acesso do Node.js no firewall do Windows.</p>` +
    `</div></section>` +
    `<section class="card">` +
    `<div class="section-head"><h2 class="section-head__title">Sobre este experimento</h2>` +
    `<span class="section-head__meta">v0.1</span></div>` +
    `<div class="card__body"><div class="about-list">` +
    `<p><b>Um caderno de análise documental.</b> Documentos, critérios e o resultado de cada verificação — com retomada pelo último documento editado e sincronização entre notebook e iPad pela rede local.</p>` +
    `<p><b>Interface reutilizável.</b> Shell, cabeçalho contextual, cards, stamps de estado, matriz de verificação e barra flutuante em cápsula, conforme o guia do projeto.</p>` +
    `<p><b>Armazenamento.</b> ${plural(processChecks, 'verificação', 'verificações')} e ${plural(
      s.docs,
      'arquivo',
      'arquivos'
    )} em <code>data/db.json</code> e <code>data/files/</code>. Sem nuvem, sem conta.</p>` +
    `<p><b>Atalhos na bancada:</b> <kbd class="inline-kbd">J</kbd> <kbd class="inline-kbd">K</kbd> navegam entre verificações, <kbd class="inline-kbd">1</kbd>–<kbd class="inline-kbd">3</kbd> marcam o resultado e <kbd class="inline-kbd">N</kbd> vai ao próximo documento.</p>` +
    `</div></div></section>` +
    `</div></div></div>`
  );
}
