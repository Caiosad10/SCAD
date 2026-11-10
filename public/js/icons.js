/** Ícones de traço — uma única família visual, 24×24, 1.6px. */

const PATHS = {
  panel:
    '<rect x="3.8" y="3.8" width="7" height="7" rx="1.4"/><rect x="13.2" y="3.8" width="7" height="7" rx="1.4"/><rect x="3.8" y="13.2" width="7" height="7" rx="1.4"/><rect x="13.2" y="13.2" width="7" height="7" rx="1.4"/>',
  docs:
    '<path d="M13.6 3.2H8.4A2.2 2.2 0 0 0 6.2 5.4v13.2a2.2 2.2 0 0 0 2.2 2.2h7.2a2.2 2.2 0 0 0 2.2-2.2V7.4Z"/><path d="M13.4 3.4v4h4.2"/><path d="M9.4 12h5.2M9.4 15.6h3.4"/>',
  analyze:
    '<rect x="4.6" y="4.4" width="14.8" height="16.2" rx="2.1"/><path d="M8.6 4.4V3.6a1.3 1.3 0 0 1 1.3-1.3h4.2a1.3 1.3 0 0 1 1.3 1.3v.8"/><path d="m8.6 12.7 2.3 2.3 4.6-5"/>',
  findings:
    '<path d="M6.2 21V3.6"/><path d="M6.2 4.6h11.4l-2.1 3.7 2.1 3.7H6.2"/>',
  settings:
    '<path d="M4 7.2h16M4 12h16M4 16.8h16"/><circle cx="9" cy="7.2" r="2" fill="var(--card, #fbf9f2)"/><circle cx="15.4" cy="12" r="2" fill="var(--card, #fbf9f2)"/><circle cx="8.2" cy="16.8" r="2" fill="var(--card, #fbf9f2)"/>',
  upload:
    '<path d="M12 16V4.2"/><path d="m7.6 8.6 4.4-4.4 4.4 4.4"/><path d="M4.8 15v3.4a2.4 2.4 0 0 0 2.4 2.4h9.6a2.4 2.4 0 0 0 2.4-2.4V15"/>',
  download:
    '<path d="M12 4.5v11.6"/><path d="m7.6 11.8 4.4 4.4 4.4-4.4"/><path d="M4.8 15v3.4a2.4 2.4 0 0 0 2.4 2.4h9.6a2.4 2.4 0 0 0 2.4-2.4V15"/>',
  search: '<circle cx="10.6" cy="10.6" r="6.1"/><path d="m15.2 15.2 4.4 4.4"/>',
  close: '<path d="M6.4 6.4 17.6 17.6M17.6 6.4 6.4 17.6"/>',
  chevronRight: '<path d="m9.4 5.2 6.8 6.8-6.8 6.8"/>',
  chevronDown: '<path d="m5.2 9.4 6.8 6.8 6.8-6.8"/>',
  chevronUp: '<path d="m5.2 14.6 6.8-6.8 6.8 6.8"/>',
  chevronLeft: '<path d="m14.6 5.2-6.8 6.8 6.8 6.8"/>',
  arrowRight: '<path d="M4.4 12h14.4"/><path d="m13.6 6.2 5.8 5.8-5.8 5.8"/>',
  arrowLeft: '<path d="M19.6 12H5.2"/><path d="m10.4 6.2-5.8 5.8 5.8 5.8"/>',
  plus: '<path d="M12 5.2v13.6M5.2 12h13.6"/>',
  trash:
    '<path d="M4.6 7h14.8"/><path d="M9.6 7V5.3A1.3 1.3 0 0 1 10.9 4h2.2a1.3 1.3 0 0 1 1.3 1.3V7"/><path d="M6.5 7l.8 12.1a1.9 1.9 0 0 0 1.9 1.8h5.6a1.9 1.9 0 0 0 1.9-1.8L17.5 7"/><path d="M10.2 11v5.8M13.8 11v5.8"/>',
  pen:
    '<path d="M4.6 19.4h4.1L19.9 8.2a2.2 2.2 0 0 0-3.1-3.1L5.6 16.3Z"/><path d="m14.7 7.1 3.2 3.2"/>',
  file:
    '<path d="M13.6 3.2H8.4A2.2 2.2 0 0 0 6.2 5.4v13.2a2.2 2.2 0 0 0 2.2 2.2h7.2a2.2 2.2 0 0 0 2.2-2.2V7.4Z"/><path d="M13.4 3.4v4h4.2"/>',
  image:
    '<rect x="3.6" y="4.6" width="16.8" height="14.8" rx="2"/><circle cx="8.9" cy="9.9" r="1.5"/><path d="m4.8 17.2 4.4-4.4 3.4 3.4 3-3 3.6 3.6"/>',
  sheet:
    '<rect x="4.2" y="3.6" width="15.6" height="16.8" rx="1.8"/><path d="M4.2 9h15.6M4.2 14.4h15.6M9.6 3.6v16.8"/>',
  external:
    '<path d="M13.4 4.6h6v6"/><path d="M19.4 4.6 10.8 13.2"/><path d="M17.8 14v4.4a1.6 1.6 0 0 1-1.6 1.6H5.8a1.6 1.6 0 0 1-1.6-1.6V8a1.6 1.6 0 0 1 1.6-1.6H10"/>',
  copy:
    '<rect x="9.2" y="9.2" width="11" height="11" rx="2"/><path d="M15 9.2V5.6A1.6 1.6 0 0 0 13.4 4h-8A1.6 1.6 0 0 0 3.8 5.6v8A1.6 1.6 0 0 0 5.4 15.2H9"/>',
  print:
    '<path d="M7.2 8.4V4.6h9.6v3.8"/><rect x="4" y="8.4" width="16" height="7.4" rx="1.8"/><path d="M7.2 15.8v3.6h9.6v-3.6"/><path d="M17 11.2h.01"/>',
  check: '<path d="m5.2 12.6 4.6 4.6L19 6.8"/>',
  flag: '<path d="M6.2 21V3.6"/><path d="M6.2 4.6h11.4l-2.1 3.7 2.1 3.7H6.2"/>',
  list: '<path d="M9 6.2h11M9 12h11M9 17.8h11"/><path d="M4.6 6.2h.01M4.6 12h.01M4.6 17.8h.01"/>',
  filter: '<path d="M4.2 5.2h15.6l-6.1 7.2v6.1l-3.4 1.5v-7.6L4.2 5.2Z"/>',
  clock: '<circle cx="12" cy="12" r="8.4"/><path d="M12 7.4V12l3.2 2"/>',
  scan: '<path d="M4.4 8.6V6.2a1.8 1.8 0 0 1 1.8-1.8h2.4M15.4 4.4h2.4a1.8 1.8 0 0 1 1.8 1.8v2.4M19.6 15.4v2.4a1.8 1.8 0 0 1-1.8 1.8h-2.4M8.6 19.6H6.2a1.8 1.8 0 0 1-1.8-1.8v-2.4"/><path d="M8 12h8"/>',
  bookmark: '<path d="M6.4 4.6h11.2v16.8L12 17.4l-5.6 4V4.6Z"/>',
  info: '<circle cx="12" cy="12" r="8.6"/><path d="M12 11v5.2M12 7.8h.01"/>',
  alert: '<path d="M12 4.2 3.4 19.8h17.2L12 4.2Z"/><path d="M12 10v4.2M12 17.2h.01"/>',
  hash: '<path d="M9.4 4 7.8 20M16.2 4l-1.6 16M4.6 9.2h16M3.8 14.8h16"/>',
};

export function icon(name, size = 18, className = '') {
  const body = PATHS[name] || PATHS.file;
  return (
    `<svg class="ic ${className}" width="${size}" height="${size}" viewBox="0 0 24 24" ` +
    `fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" ` +
    `stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`
  );
}

const GLYPH = 'var(--glyph, #fbf9f2)';

const STATUS_SHAPES = {
  pending:
    '<circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="1.7" stroke-dasharray="2.2 3.6"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/>',
  ok:
    `<circle cx="12" cy="12" r="9" fill="currentColor"/><path d="m7.7 12.3 2.8 2.8 5.8-6" fill="none" stroke="${GLYPH}" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"/>`,
  nc:
    `<rect x="3.4" y="3.4" width="17.2" height="17.2" rx="4.2" fill="currentColor"/><path d="m8.7 8.7 6.6 6.6M15.3 8.7l-6.6 6.6" fill="none" stroke="${GLYPH}" stroke-width="2.1" stroke-linecap="round"/>`,
  obs:
    `<path d="M12 3.1 20.9 12 12 20.9 3.1 12 12 3.1Z" fill="currentColor"/><path d="M12 7.4v5.4" fill="none" stroke="${GLYPH}" stroke-width="2" stroke-linecap="round"/><circle cx="12" cy="16.4" r="1.15" fill="${GLYPH}"/>`,
  na:
    '<circle cx="12" cy="12" r="8.2" fill="none" stroke="currentColor" stroke-width="1.7" opacity=".8"/><path d="M6.4 17.6 17.6 6.4" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>',
};

export function statusMark(status, size = 16, className = '') {
  const shape = STATUS_SHAPES[status] || STATUS_SHAPES.pending;
  return (
    `<span class="mark mark--${status} ${className}" aria-hidden="true">` +
    `<svg width="${size}" height="${size}" viewBox="0 0 24 24" focusable="false">${shape}</svg></span>`
  );
}
