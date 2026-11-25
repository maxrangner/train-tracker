// "N trains here": several trains close together on the map, a page to pick one (one #picker for every such page).
//
// createPicker({ holder, stack, openTrain }) -> { show(list), define(key) }; stack is a getter.
import { t } from '../i18n.js';
import { esc } from '../html.js';
import { splitLabel, tagHtml } from '../tag.js';

const HALF_MAX = 0.5, HANDLE_PX = 24, LIST_GAP = 14;   // half: all its rows, up to about half the screen

export function createPicker(ctx) {
  const { holder, openTrain } = ctx;
  const pickerEl = document.getElementById('picker');
  const lists = new Map();
  let n = 0;
  function show(list) {
    const key = `pick:${++n}`;
    lists.set(key, [...list].sort((a, b) => (a.company || '').localeCompare(b.company || '', 'sv') || String(a.label).localeCompare(String(b.label))));
    ctx.stack.open(key);
  }
  function define(key) {
    const rows = lists.get(key);
    if (!rows) return null;
    // (a page lets go of #picker only while it holds it: back from a second picker, the first has it again)
    let mine = null;
    const letGo = () => { if (mine?.contains(pickerEl)) { pickerEl.hidden = true; holder.append(pickerEl); } };
    return {
      name: () => t('trainsHere', rows.length), kind: 'pick',
      show(el) {
        mine = el;
        // (the empty .panel-buttons: a flex item before the sheet's ‹ and buttons, its gap part of the look)
        pickerEl.innerHTML = `<div class="panel-head"><strong>${t('trainsHere', rows.length)}</strong><span class="panel-buttons"></span></div><ul class="pick-list">` +
          rows.map((r, i) => `<li><button type="button" data-i="${i}"><b>${esc(splitLabel(r.label).number)}</b>${tagHtml(splitLabel(r.label).minutes)} <span>${esc(r.company || t('train'))}</span></button></li>`).join('') + '</ul>';
        pickerEl.hidden = false;
        el.append(pickerEl);
        for (const b of pickerEl.querySelectorAll('[data-i]')) b.onclick = () => openTrain(rows[Number(b.dataset.i)].id);
      },
      // (more rows than half the screen: the last one cut, pull up to scroll)
      half() {
        const list = mine?.contains(pickerEl) ? pickerEl.querySelector('.pick-list') : null;
        if (!list) return 0;
        return Math.min(Math.round(list.getBoundingClientRect().bottom - mine.getBoundingClientRect().top + LIST_GAP), Math.round(innerHeight * HALF_MAX) - HANDLE_PX);
      },
      hide: letGo,
      unmount() { letGo(); lists.delete(key); },
    };
  }
  if (import.meta.env.DEV) window.__picker = show;   // (tools/back-check.mjs: one picker over another, then back)
  return { show, define };
}
