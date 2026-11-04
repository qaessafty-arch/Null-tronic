/** Stroke icon set (24-unit grid, 1.6 stroke) drawn for NULL-TECH; no external icon font. */
const P: Record<string, string> = {
  select: 'M5 3l12 8-5 1.5L9.5 18z',
  wire: 'M3 17h5V7h8v10h5M8 17a1 1 0 1 0 0 .01M16 7a1 1 0 1 0 0 .01',
  room: 'M4 4h16v16H4zM4 12h7v8',
  circuit: 'M4 6h4v12H4zM8 9h5l3-3h4M8 15h5l3 3h4M20 6v0M20 18v0',
  dimension: 'M4 8v8M20 8v8M4 12h16M7 10l-3 2 3 2M17 10l3 2-3 2',
  text: 'M5 6V4h14v2M12 4v16M9 20h6',
  measure: 'M3 17L17 3l4 4L7 21zM7 13l2 2M10 10l2 2M13 7l2 2',
  undo: 'M9 14L4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3',
  redo: 'M15 14l5-5-5-5M20 9H10a6 6 0 0 0 0 12h3',
  save: 'M5 3h11l3 3v15H5zM8 3v6h8V3M8 21v-7h8v7',
  open: 'M3 7h6l2 2h10v10H3zM3 7V5h6',
  new: 'M6 3h9l4 4v14H6zM14 3v5h5M12 11v6M9 14h6',
  print: 'M7 8V3h10v5M5 17H3v-8h18v8h-2M7 14h10v7H7z',
  play: 'M7 4l13 8-13 8z',
  hand: 'M8 13V5a1.5 1.5 0 0 1 3 0v6M11 11V3.5a1.5 1.5 0 0 1 3 0V11M14 11V5a1.5 1.5 0 0 1 3 0v7M17 9a1.5 1.5 0 0 1 3 0v5a7 7 0 0 1-7 7h-1a7 7 0 0 1-5.6-2.8L4 15.5a1.6 1.6 0 0 1 2.4-2L8 15',
  fit: 'M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5',
  target: 'M12 3v4M12 17v4M3 12h4M17 12h4M12 8a4 4 0 1 0 0 8 4 4 0 1 0 0-8',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  rotate: 'M20 12a8 8 0 1 1-2.3-5.7M20 4v5h-5',
  mirror: 'M12 3v18M8 7l-5 5 5 5zM16 7l5 5-5 5z',
  copy: 'M8 8h12v12H8zM4 16V4h12',
  grid: 'M4 4h16v16H4zM4 9.3h16M4 14.6h16M9.3 4v16M14.6 4v16',
  settings: 'M12 9a3 3 0 1 0 0 6 3 3 0 1 0 0-6M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z',
  warning: 'M12 3l10 18H2zM12 10v5M12 18v.01',
  error: 'M12 3a9 9 0 1 0 0 18 9 9 0 1 0 0-18M9 9l6 6M15 9l-6 6',
  check: 'M4 12l5 5L20 6',
  info: 'M12 3a9 9 0 1 0 0 18 9 9 0 1 0 0-18M12 11v6M12 7.5v.01',
  review: 'M4 4h12l4 4v12H4zM8 12h8M8 16h5M8 8h4',
  na: 'M12 3a9 9 0 1 0 0 18 9 9 0 1 0 0-18M8 12h8',
  search: 'M10.5 4a6.5 6.5 0 1 0 0 13 6.5 6.5 0 1 0 0-13M15.5 15.5L21 21',
  star: 'M12 3l2.8 5.8 6.2.9-4.5 4.4 1 6.2L12 17.4 6.5 20.3l1-6.2L3 9.7l6.2-.9z',
  chevron: 'M9 6l6 6-6 6',
  close: 'M6 6l12 12M18 6L6 18',
  plus: 'M12 5v14M5 12h14',
  'panel-left': 'M4 4h16v16H4zM9 4v16',
  'panel-right': 'M4 4h16v16H4zM15 4v16',
  'panel-bottom': 'M4 4h16v16H4zM4 15h16',
  sun: 'M12 8a4 4 0 1 0 0 8 4 4 0 1 0 0-8M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
  moon: 'M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z',
  download: 'M12 4v11M7 10l5 5 5-5M5 20h14',
  upload: 'M12 20V9M7 14l5-5 5 5M5 4h14',
  bolt: 'M13 2L4 14h7l-1 8 9-12h-7z',
  book: 'M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2zM4 21V5M8 7h7',
  assistant: 'M12 3l1.8 4.6L18 9.5l-4.2 1.8L12 16l-1.8-4.7L6 9.5l4.2-1.9zM18 15l.9 2.1L21 18l-2.1.9L18 21l-.9-2.1L15 18l2.1-.9z',
  layers: 'M12 3l9 5-9 5-9-5zM3 13l9 5 9-5M3 17l9 5 9-5',
  cube: 'M12 2l9 5v10l-9 5-9-5V7zM12 12l9-5M12 12v10M12 12L3 7',
  square: 'M4 4h16v16H4z',
  split: 'M4 4h16v16H4zM12 4v16',
  pause: 'M8 5v14M16 5v14',
  maximize: 'M8 3H3v5M16 3h5v5M21 16v5h-5M3 16v5h5',
};

export function Icon({ name, size = 16, className }: { name: string; size?: number; className?: string }) {
  const d = P[name] ?? P.square;
  return (
    <svg className={`icon ${className ?? ''}`} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

export function StatusIcon({ status, size = 14 }: { status: string; size?: number }) {
  const map: Record<string, string> = { error: 'error', warning: 'warning', valid: 'check', review: 'review', 'not-evaluated': 'na' };
  return (
    <span className={`status-icon st-${status}`}>
      <Icon name={map[status] ?? 'info'} size={size} />
    </span>
  );
}
