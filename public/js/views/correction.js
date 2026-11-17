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

/* ------------------------------------------------------- o que mudou */

function cortar(texto, limite = 96) {
  const limpo = String(texto || '').replace(/\s+/g, ' ').trim();
  return limpo.length > limite ? `${limpo.slice(0, limite - 1)}…` : limpo;
}

function segmentos(partes, tag) {
  return (partes || [])
    .map((parte) => (parte.mudou ? `<${tag}>${esc(parte.t)}</${tag}>` : esc(parte.t)))
    .join('');
}

/** Texto do arquivo sem camada de texto (PDF digitalizado, imagem). */
export function diffAvisoHtml(mensagem, dica) {
  return (
    `<div class="diff__aviso">${icon('alert', 18)}` +
    `<p>${esc(mensagem)}</p>` +
    (dica ? `<p class="diff__aviso-dica">${esc(dica)}</p>` : '') +
    `</div>`
  );
}

/**
 * Lista dos trechos alterados, agrupados pela âncora (o parágrafo anterior
 * igual). Cada trecho mostra o que saiu e o que entrou, com as palavras
 * exatas marcadas.
 */
export function diffBodyHtml(resultado, { limite = 80 } = {}) {
  const trechos = resultado?.trechos || [];
  if (!trechos.length) {
    return (
      `<div class="diff__vazio">${icon('check', 18)}` +
      `<p>As duas versões têm <b>o mesmo texto</b> — a diferença, se houver, é de formatação, imagem ou layout, ` +
      `que esta comparação não avalia.</p></div>`
    );
  }

  const visiveis = trechos.slice(0, limite);
  const grupos = [];
  for (const trecho of visiveis) {
    const ultimo = grupos[grupos.length - 1];
    if (ultimo && ultimo.contexto === trecho.contexto) ultimo.itens.push(trecho);
    else grupos.push({ contexto: trecho.contexto, itens: [trecho] });
  }

  const blocos = grupos
    .map((grupo) => {
      const linhas = grupo.itens
        .map((trecho) => {
          if (trecho.tipo === 'mod') {
            return (
              `<p class="diff__line diff__line--del"><span class="diff__mark" aria-hidden="true">−</span>` +
              `<span>${segmentos(trecho.palavras?.antes, 'del')}</span></p>` +
              `<p class="diff__line diff__line--add"><span class="diff__mark" aria-hidden="true">+</span>` +
              `<span>${segmentos(trecho.palavras?.depois, 'ins')}</span></p>`
            );
          }
          if (trecho.tipo === 'del') {
            return (
              `<p class="diff__line diff__line--del"><span class="diff__mark" aria-hidden="true">−</span>` +
              `<span><del>${esc(trecho.antes)}</del></span></p>`
            );
          }
          return (
            `<p class="diff__line diff__line--add"><span class="diff__mark" aria-hidden="true">+</span>` +
            `<span><ins>${esc(trecho.depois)}</ins></span></p>`
          );
        })
        .join('');
      return (
        `<li class="diff__item">` +
        `<p class="diff__ctx">${esc(grupo.contexto ? cortar(grupo.contexto) : 'início do documento')}</p>` +
        linhas +
        `</li>`
      );
    })
    .join('');

  const restantes = trechos.length - visiveis.length;
  return (
    `<ol class="diff">${blocos}</ol>` +
    (restantes > 0 ? `<p class="diff__more">… e mais ${restantes} trecho(s) — abra a versão corrigida para ver o resto.</p>` : '') +
    `<p class="diff__note">Comparação automática do <b>texto</b> dos dois arquivos: imagens, tabelas e formatação não entram. ` +
    `Serve para o revisor achar o que mudou — o documento em si continua valendo como anexo.</p>`
  );
}
