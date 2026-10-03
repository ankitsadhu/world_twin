// One icon set (SF Symbols-like, 24px grid, 1.8px stroke). Text glyphs render differently on every OS.
const svg = (d, extra = "") =>
  `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8"
    stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ${extra}>${d}</svg>`;

export const ICON = {
  search: svg('<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>'),
  close: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
  turnLeft: svg('<path d="M9 7H5V3"/><path d="M5.6 7A8 8 0 1 1 4 12"/>'),
  turnRight: svg('<path d="M15 7h4V3"/><path d="M18.4 7A8 8 0 1 0 20 12"/>'),
  walk: svg('<circle cx="13" cy="4.5" r="1.8"/><path d="M11 21l2-6-2.5-2.5L12 8l3 3 3 1"/><path d="M10 8l-3 3v3"/><path d="M14 15l2 6"/>'),
  map: svg('<path d="M9 4L3 6.5v13.5L9 17.5l6 2.5 6-2.5V4L15 6.5 9 4z"/><path d="M9 4v13.5M15 6.5V20"/>'),
  locate: svg('<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/><circle cx="12" cy="12" r="7"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  minus: svg('<path d="M5 12h14"/>'),
  chevron: svg('<path d="M7 10l5 5 5-5"/>', 'width="16" height="16"'),
  star: svg('<path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9 6.8 19.6l1-5.8L3.5 9.7l5.9-.9L12 3.5z" fill="currentColor"/>', 'width="14" height="14"'),
  street: svg('<path d="M4 20L9 4M20 20L15 4M12 6v2M12 11v2M12 16v2"/>', 'width="16" height="16"'),
  building: svg('<rect x="5" y="3" width="14" height="18" rx="1"/><path d="M9 7h2M13 7h2M9 11h2M13 11h2M9 15h2M13 15h2"/>', 'width="16" height="16"'),
  screen: svg('<rect x="3" y="5" width="18" height="12" rx="1.5"/><path d="M9 21h6M12 17v4"/>', 'width="16" height="16"'),
  help: svg('<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.6"/><circle cx="12" cy="17" r=".6" fill="currentColor"/>'),
  tour: svg('<path d="M8 5v14l11-7L8 5z"/>'),
  settings: svg('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>'),
  explore: svg('<circle cx="12" cy="12" r="9"/><path d="M15.5 8.5l-2 5-5 2 2-5 5-2z"/>'),
  sound: svg('<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/>'),
  muted: svg('<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M16 9.5l5 5M21 9.5l-5 5"/>'),
  soundOff: svg('<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M16 9.5l5 5M21 9.5l-5 5"/>'),
  arrow: svg('<path d="M12 19V5M6 11l6-6 6 6"/>', 'width="16" height="16"'),
};
