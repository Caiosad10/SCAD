/** Utilidades de interface, componentes compartilhados, toasts e diálogos. */
import { icon, statusMark } from './icons.js';

/* --------------------------------------------------------------- textos */

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ESCAPES[c]);
}

export function fmtInt(n) {
  return new Intl.NumberFormat('pt-BR').format(Number(n) || 0);
}

export function plural(n, singular, pluralForm) {
  return `${fmtInt(n)} ${n === 1 ? singular : pluralForm}`;
}

export function fmtBytes(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10240 ? 1 : 0).replace('.', ',')} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(1).replace('.', ',')} GB`;
}

const dateFmt = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short' });
const timeFmt = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' });
const fullFmt = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });

export function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return dateFmt.format(d).replace('.', '');
}

export function fmtTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return timeFmt.format(d);
}

export function fmtFullDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return fullFmt.format(d);
}

export function relTime(iso) {
  if (!iso) return '';
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return 'agora';
  const min = Math.round(ms / 60000);
  if (min < 1) return 'agora';
  if (min < 60) return `há ${min} min`;
  const hours = Math.round(min / 60);
  if (hours < 24) return `há ${hours} h`;
  const days = Math.round(hours / 24);
  if (days < 7) return `há ${days} d`;
  return fmtDate(iso);
}

export function isEditing() {
  const el = document.activeElement;
  if (!el) return false;
  return (
    el.tagName === 'INPUT' ||
    el.tagName === 'TEXTAREA' ||
    el.tagName === 'SELECT' ||
    el.isContentEditable
  );
}

/* --------------------------------------------------------------- arquivos */

export function fileExt(name = '') {
  const match = /\.([a-z0-9]+)$/i.exec(name);
  return match ? match[1].toUpperCase() : 'ARQ';
}

export function fileKind(name = '', mime = '') {
  const ext = (fileExt(name) === 'ARQ' ? '' : fileExt(name)).toLowerCase();
  if (ext === 'pdf') return 'pdf';
  if (['png', 'jpg', 'jpeg', 'webp', 'gif', 'heic', 'heif'].includes(ext) || mime.startsWith('image/')) return 'image';
  if (['xls', 'xlsx', 'csv', 'ods'].includes(ext) || mime.includes('spreadsheet')) return 'sheet';
  if (['doc', 'docx', 'odt', 'txt', 'rtf', 'md'].includes(ext) || mime.includes('word') || mime.startsWith('text/')) return 'doc';
  return 'file';
}

export function fileKindLabel(kind) {
  return (
    {
      pdf: 'PDF',
      image: 'Imagem',
      sheet: 'Planilha',
      doc: 'Documento',
      file: 'Arquivo',
    }[kind] || 'Arquivo'
  );
}

export function fileGlyph(kind, size = 16) {
  if (kind === 'image') return icon('image', size);
  if (kind === 'sheet') return icon('sheet', size);
  if (kind === 'pdf') return icon('file', size);
  return icon('file', size);
}

/* --------------------------------------------------------------- estados */

export const STATUS_LABEL = {
  pending: 'Pendente',
  ok: 'Conforme',
  nc: 'Não conforme',
  obs: 'Observação',
  na: 'Não se aplica',
};

export const STATUS_ORDER = ['ok', 'nc', 'obs'];

export function stamp(status, options = {}) {
  const label = options.label || STATUS_LABEL[status] || 'Pendente';
  const quiet = options.quiet ? ' stamp--quiet' : '';
  return `<span class="stamp stamp--${status}${quiet}">${statusMark(status, 11)}${esc(label)}</span>`;
}

export function statusTag(status) {
  if (status === 'ok') return stamp('ok');
  if (status === 'nc') return stamp('nc');
  if (status === 'obs') return stamp('obs');
  if (status === 'na') return stamp('na');
  return stamp('pending');
}

/* ----------------------------------------------------------- componentes */

export function bar(done, total, options = {}) {
  const pct = total ? Math.max(0, Math.min(100, Math.round((done / total) * 100))) : 0;
  const classes = ['bar'];
  if (options.thin) classes.push('bar--thin');
  if (options.ok) classes.push('bar--ok');
  if (options.track) classes.push('bar--track');
  return (
    `<div class="${classes.join(' ')}" role="progressbar" aria-valuenow="${pct}" ` +
    `aria-valuemin="0" aria-valuemax="100" aria-label="${esc(options.label || 'progresso')}">` +
    `<div class="bar__fill" style="width:${pct}%"></div></div>`
  );
}

export function ring(pct, size = 172, stroke = 9) {
  const clamped = Math.max(0, Math.min(100, Number(pct) || 0));
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const offset = c * (1 - clamped / 100);
  return (
    `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" aria-hidden="true" focusable="false">` +
    `<circle class="ring__track" cx="${size / 2}" cy="${size / 2}" r="${r}" stroke-width="${stroke}" stroke-dasharray="1 6"/>` +
    `<circle class="ring__value" cx="${size / 2}" cy="${size / 2}" r="${r}" stroke-width="${stroke}" ` +
    `stroke-dasharray="${c.toFixed(2)}" stroke-dashoffset="${offset.toFixed(2)}"/></svg>`
  );
}

export function sectionHead({ title, meta = '', action = '' }) {
  return (
    `<div class="section-head"><h2 class="section-head__title">${esc(title)}</h2>` +
    (action || (meta ? `<span class="section-head__meta">${meta}</span>` : '')) +
    `</div>`
  );
}

export function emptyState({ iconName = 'file', title, text = '', action = '' }) {
  return (
    `<div class="empty"><span class="empty__icon">${icon(iconName, 21)}</span>` +
    `<h3>${esc(title)}</h3>` +
    (text ? `<p>${esc(text)}</p>` : '') +
    action +
    `</div>`
  );
}

/* ------------------------------------------------------------- feedback */

export function toast(message, kind = 'ok') {
  const host = document.getElementById('toasts');
  if (!host) return;
  while (host.children.length >= 3) host.firstElementChild?.remove();
  const el = document.createElement('div');
  el.className = `toast toast--${kind}`;
  el.innerHTML = `${statusMark(kind === 'err' ? 'nc' : 'ok', 15)}<span>${esc(message)}</span>`;
  host.append(el);
  setTimeout(() => {
    el.classList.add('toast--out');
    setTimeout(() => el.remove(), 240);
  }, 3400);
}

/* --------------------------------------------------------------- diálogos */

export function openSheet({ title, eyebrow = '', body = '', footer = '', wide = false, onClose = null }) {
  const host = document.getElementById('dialogs');
  const dialog = document.createElement('dialog');
  dialog.className = `sheet${wide ? ' sheet--wide' : ''}`;
  dialog.innerHTML =
    `<div class="sheet__grid">` +
    `<div class="sheet__head"><div class="sheet__head-copy">` +
    (eyebrow ? `<p class="eyebrow eyebrow--bare">${esc(eyebrow)}</p>` : '') +
    `<h2 class="sheet__title">${esc(title)}</h2></div>` +
    `<button type="button" class="iconbtn" data-close aria-label="Fechar">${icon('close', 18)}</button>` +
    `</div>` +
    `<div class="sheet__body">${body}</div>` +
    (footer ? `<div class="sheet__foot">${footer}</div>` : '') +
    `</div>`;
  host.append(dialog);

  let fromBackdrop = false;
  dialog.addEventListener('pointerdown', (event) => {
    fromBackdrop = event.target === dialog;
  });
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog && fromBackdrop) dialog.close();
  });
  dialog.addEventListener('close', () => {
    dialog.remove();
    if (typeof onClose === 'function') onClose();
  });

  const closeButton = dialog.querySelector('[data-close]');
  closeButton?.addEventListener('click', () => dialog.close());

  if (typeof dialog.showModal === 'function') dialog.showModal();
  else dialog.setAttribute('open', '');

  return dialog;
}

export function confirmSheet({ title, message, confirmLabel = 'Confirmar', danger = false, eyebrow = 'Confirmação' }) {
  return new Promise((resolve) => {
    let settled = false;
    const dialog = openSheet({
      title,
      eyebrow,
      body: `<p class="sheet-message">${message}</p>`,
      footer:
        `<button type="button" class="btn btn--ghost" data-cancel>Cancelar</button>` +
        `<button type="button" class="btn ${danger ? 'btn--danger' : 'btn--primary'}" data-confirm>${esc(confirmLabel)}</button>`,
      onClose: () => {
        if (!settled) {
          settled = true;
          resolve(false);
        }
      },
    });

    dialog.querySelector('[data-cancel]')?.addEventListener('click', () => dialog.close());
    dialog.querySelector('[data-confirm]')?.addEventListener('click', () => {
      settled = true;
      resolve(true);
      dialog.close();
    });
  });
}

export async function copyText(value) {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    try {
      const area = document.createElement('textarea');
      area.value = value;
      area.setAttribute('readonly', '');
      area.style.position = 'fixed';
      area.style.top = '-1000px';
      document.body.append(area);
      area.select();
      const ok = document.execCommand('copy');
      area.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

export function debounce(fn, wait) {
  let timer = null;
  const wrapped = (...args) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fn(...args);
    }, wait);
  };
  wrapped.flush = (...args) => {
    if (timer) clearTimeout(timer);
    timer = null;
    fn(...args);
  };
  wrapped.cancel = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };
  return wrapped;
}

export function markSave(root, state, detail = '') {
  const el = root?.querySelector?.('.autosave');
  if (!el) return;
  el.dataset.state = state;
  el.textContent =
    state === 'saving' ? 'salvando…' : state === 'error' ? 'não salvo' : `salvo${detail ? ` · ${detail}` : ''}`;
}
