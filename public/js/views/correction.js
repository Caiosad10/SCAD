/** Ações de correção, reabertura e versões compartilhadas entre telas. */
import { icon } from '../icons.js';
import { esc } from '../ui.js';
import { currentProfile, correctionVersion, versionsOf } from '../store.js';

/**
 * Botões que entram depois de "Ver arquivo" no documento e na bancada:
 * adicionar correção (pílula tracejada), ver a correção pendente e reabrir
 * uma revisão já aprovada (só o revisor).
 */
export function correctionActionsHtml(state, doc, review) {
  if (!doc || doc.itemKind === 'item') return '';
  const reviewer = currentProfile(state)?.role === 'reviewer';
  const parts = [];
  if (doc.correction) {
    parts.push(
      `<button type="button" class="btn btn--secondary" data-action="correction-open" data-id="${esc(doc.id)}">` +
        `${icon('file', 15)} ${reviewer ? 'Visualizar documento corrigido' : 'Visualizar correção'}</button>`
    );
  } else if (doc.active !== false) {
    parts.push(
      `<button type="button" class="btn btn--stitch" data-action="correction-add" data-id="${esc(doc.id)}">` +
        `${icon('plus', 15)} Adicionar correção</button>`
    );
  }
  if (reviewer && review?.status === 'approved' && doc.active !== false) {
    parts.push(
      `<button type="button" class="btn btn--ghost" data-action="review-reopen" data-id="${esc(doc.id)}">` +
        `${icon('arrowLeft', 15)} Reabrir revisão</button>`
    );
  }
  return parts.join('');
}

/** "Versões: v1, v2" — aparece só quando já existe arquivo arquivado. */
export function versionsLabel(doc) {
  const total = 1 + versionsOf(doc).length;
  if (total <= 4) {
    return Array.from({ length: total }, (_, index) => `v${index + 1}`).join(', ');
  }
  return `v1 … v${total}`;
}

export function versionsButtonHtml(doc) {
  if (!versionsOf(doc).length) return '';
  return (
    `<button type="button" class="linklike" data-action="versions-open" data-id="${esc(doc.id)}" ` +
    `title="Ver o histórico de versões deste documento">Versões: ${esc(versionsLabel(doc))}</button>`
  );
}

/** Selo da correção pendente com o número da próxima versão. */
export function correctionPillHtml(doc) {
  if (!doc?.correction) return '';
  const version = correctionVersion(doc);
  return (
    `<span class="correction-chip" title="Correção v${version} aguardando comparação e aprovação">` +
    `${icon('file', 12)} Corrigido · v${version}</span>`
  );
}
