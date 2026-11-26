// Settings, About and Connection: their parts are in index.html, moved into the page while it is shown and back to the
// holder (#page-holder) when not.
//
// createHeldPages({ holder, pages: { name: { el, name(), kind, onShow, onHide, startLevel } } }) -> define(name)
export function createHeldPages({ holder, pages }) {
  return function define(v) {
    const p = pages[v];
    if (!p) return null;
    const { el, name, kind, onShow, onHide, startLevel } = p;
    return {
      name, kind, startLevel,
      show(page) { page.append(el); el.hidden = false; onShow?.(); },
      hide() { el.hidden = true; holder.append(el); onHide?.(); },
      unmount() { el.hidden = true; holder.append(el); },
    };
  };
}
