// Loading, empty and error messages in one look (round 4, 2026-11-15): a soft tile with the text centred and an icon
// before it: a turning ring while loading, (i) for nothing found, ⚠ for an error. CSS .state in src/css/page.css.
import { icon } from './icons.js';

import { esc } from './html.js';
const mark = kind => (kind === 'loading' ? '<span class="spin" aria-hidden="true"></span>' : icon(kind === 'error' ? 'warning' : 'about', 18));

// kind: 'loading', 'empty' or 'error'. tag: the element ('p', or 'li' in a list).
export const stateHtml = (kind, text, tag = 'p') => `<${tag} class="state ${kind}" role="status">${mark(kind)}<span>${esc(text)}</span></${tag}>`;

// The same as an element (for code that builds elements).
export function stateEl(kind, text, tag = 'p') {
  const el = document.createElement(tag);
  el.className = `state ${kind}`;
  el.setAttribute('role', 'status');
  el.innerHTML = `${mark(kind)}<span>${esc(text)}</span>`;
  return el;
}
