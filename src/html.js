// Text from outside (station names, train numbers, Trafikverket's messages, file contents) made safe to put into the
// page's HTML, inside an element or a quoted attribute: & < > " ' become entities, so it is always shown as typed and
// never read as page code (Codex's beta review, 2026-11-18, point 1; until then seven copies, only one handled quotes).
const ENTITY = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ENTITY[c]);
