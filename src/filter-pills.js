// The pills above the search bar while the map shows only some trains (src/filter.js; the line, src/line.js): one
// for the companies and kinds ("Showing only SJ Snabbtåg, Commuter"), one for the lateness ("Showing only late 6+
// min"); both hold together, each × lets go of its own, a tap opens that group's page.
//
// createFilterPills({ filter, line, home, frame, stack }) -> { show() }; stack is a getter.
import { t } from './i18n.js';
import { esc } from './html.js';

export function createFilterPills(ctx) {
  const { filter, line, home, frame } = ctx;
  function show() {
    frame.invalidate();   // (the dots at once, not at the next refresh: up to a second far out)
    const list = filter.list(), co = list.filter(x => x.type !== 'late'), late = filter.late;
    const redraw = () => { const stack = ctx.stack; stack.pageDef(stack.top())?.redraw?.(); home.redraw(); };
    if (!co.length) line.clear('filter');
    else {
      const first = co[0], word = ({ type, v }) => (type === 'kind' ? t(`kind_${v}`) : v || t('stNoCompany'));
      line.set('filter', { priority: 10, always: true, html: `<span>${esc(t('filterShowing', co.map(word).join(', ')))}</span>`,
        onTap: () => ctx.stack.open(first.type === 'kind' ? `kind:${first.v}` : `co:${first.v}`),   // (the first one's page)
        onClose: () => { filter.clearCo(); redraw(); }, closeLabel: t('filterClear') });
    }
    if (!late) line.clear('filter-late');
    else {
      line.set('filter-late', { priority: 9, always: true, html: `<span>${esc(t('filterShowing', t('filtLate')[late]))}</span>`,
        onTap: () => ctx.stack.home(1),   // (Home with its lateness bar)
        onClose: () => { filter.setLate(null); redraw(); }, closeLabel: t('filterClear') });
    }
  }
  filter.onChange(show);
  return { show };
}
