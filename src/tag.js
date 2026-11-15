// Lateness as a small coloured tag ("+12 min" on red, "On time" on green; the Soft look, Max 2026-11-15: one way to show
// lateness everywhere). Colours by lateClass (src/lateness.js) from src/colours.js (CSS .tag.ontime / .some / .late).
import { lateClass } from './lateness.js';
import { t } from './i18n.js';

export const minutesText = m => (m === 0 ? t('onTime') : `${m > 0 ? '+' : '−'}${Math.abs(m)} min`);
// short: just "+12" (boards, tight rows).
export const tagHtml = (m, { short = false } = {}) => (m === null || m === undefined ? ''
  : `<span class="tag ${lateClass(m)}">${short ? `${m > 0 ? '+' : m < 0 ? '−' : '±'}${Math.abs(m)}` : minutesText(m)}</span>`);

// "2311 (+1) »»" -> { number: '2311', minutes: 1, rest: ' »»' }; a label without minutes -> minutes null.
export function splitLabel(label) {
  const m = /^(.*?) \(([-+−]?\d+)\)(.*)$/.exec(String(label));
  return m ? { number: m[1], minutes: Number(m[2].replace('−', '-')), rest: m[3] } : { number: String(label), minutes: null, rest: '' };
}
