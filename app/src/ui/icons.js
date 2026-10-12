// Line icons for buttons and card titles (24 px grid, 1.6 stroke). Any element with data-icon="name"
// gets the icon put in front of its text.
const S = 'fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"';
const svg = (body) => `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true">${body}</svg>`;
const bars = (on) => [6, 12, 18].map((x, i) => `<path d="M${x} 19v-${4 + i * 5}" ${S} opacity="${i < on ? 1 : 0.3}"/>`).join('');

export const ICONS = {
  anc: svg(`<path d="M4 10v4M8 7v10M12 4v16M16 7v10M20 10v4" ${S}/>`),
  transparency: svg(`<circle cx="12" cy="12" r="7.5" ${S} stroke-dasharray="1.2 2.8"/>`),
  off: svg(`<circle cx="12" cy="12" r="7.5" ${S}/><path d="M6.8 17.2 17.2 6.8" ${S}/>`),
  high: svg(bars(3)),
  mid: svg(bars(2)),
  low: svg(bars(1)),
  adaptive: svg(`<path d="M4 9V6a2 2 0 0 1 2-2h3M15 4h3a2 2 0 0 1 2 2v3M20 15v3a2 2 0 0 1-2 2h-3M9 20H6a2 2 0 0 1-2-2v-3" ${S}/><circle cx="12" cy="12" r="1.8" fill="currentColor"/>`),
  dirac: svg(`<path d="m12 4-8.5 4.5L12 13l8.5-4.5L12 4ZM3.5 13 12 17.5l8.5-4.5" ${S}/>`),
  pop: svg(`<path d="M5 19v-6M9.7 19V8M14.3 19v-9M19 19V5" ${S}/>`),
  rock: svg(`<path d="M13.5 3 6 13.2h5.2L10 21l7.8-10.4h-5.4L13.5 3Z" ${S}/>`),
  classical: svg(`<rect x="4" y="5" width="16" height="14" rx="2" ${S}/><path d="M9.3 19v-5M14.7 19v-5" ${S}/><path d="M8.3 5h2v9h-2zM13.7 5h2v9h-2z" fill="currentColor"/>`),
  electronic: svg([6, 12, 18].flatMap((y) => [6, 12, 18].map((x) => `<circle cx="${x}" cy="${y}" r="1.6" fill="currentColor"/>`)).join('')),
  vocals: svg(`<rect x="9" y="3.5" width="6" height="10.5" rx="3" ${S}/><path d="M6 11a6 6 0 0 0 12 0M12 17v3.5" ${S}/>`),
  sliders: svg(`<path d="M6 4v16M12 4v16M18 4v16" ${S}/><g fill="currentColor"><rect x="3.8" y="12.5" width="4.4" height="3" rx="1.5"/><rect x="9.8" y="6.5" width="4.4" height="3" rx="1.5"/><rect x="15.8" y="14.5" width="4.4" height="3" rx="1.5"/></g>`),
  spatial: svg(`<circle cx="12" cy="12" r="2.2" fill="currentColor"/><ellipse cx="12" cy="12" rx="9" ry="4" ${S}/><path d="M7.5 5.5a8 8 0 0 1 9 0M7.5 18.5a8 8 0 0 0 9 0" ${S} opacity=".5"/>`),
  bolt: svg(`<path d="M13 3 6 13h5l-1 8 7-10h-5l1-8Z" ${S}/>`),
  music: svg(`<path d="M9 18V6l10-2v12" ${S}/><circle cx="6.5" cy="18" r="2.5" ${S}/><circle cx="16.5" cy="16" r="2.5" ${S}/>`),
  headphones: svg(`<path d="M4 16v-3a8 8 0 0 1 16 0v3" ${S}/><rect x="3.4" y="13.6" width="4.4" height="6.6" rx="2" ${S}/><rect x="16.2" y="13.6" width="4.4" height="6.6" rx="2" ${S}/>`),
  info: svg(`<circle cx="12" cy="12" r="8.5" ${S}/><path d="M12 11v5" ${S}/><circle cx="12" cy="7.8" r="1.1" fill="currentColor"/>`),
  exit: svg(`<path d="M14 4h6v6M20 4l-8.5 8.5M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4" ${S}/>`),
  concert: svg(`<path d="M5 19 9 9l4 10M6.6 15h4.8" ${S}/><path d="M15 6.5a5 5 0 0 1 0 7M18 4a8.5 8.5 0 0 1 0 12" ${S}/>`),
  cinema: svg(`<rect x="3.5" y="6" width="17" height="12" rx="2" ${S}/><path d="m10.5 9.5 4 2.5-4 2.5v-5Z" fill="currentColor"/>`),
};

export function addIcons(root = document) {
  for (const el of root.querySelectorAll('[data-icon]')) {
    if (el.querySelector(':scope > .ico')) continue;
    const icon = ICONS[el.dataset.icon];
    if (icon) el.insertAdjacentHTML('afterbegin', icon);
  }
}
