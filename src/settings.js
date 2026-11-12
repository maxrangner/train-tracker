// The look settings, in one place. Today they come from these defaults or from the address
// (#train=toy&toysize=80&toyzoom=12); a settings menu can later set the same values (and remember them on the phone).
// Read them where they are used, each time, so a change takes effect without a reload where the code allows it.
const DEFAULTS = {
  trainStyle: 'real',   // 'toy': each company's usual train as a toy, bigger than real; 'real': real size
  toySize: 70,          // a toy is at least this long on the screen, in pixels (Max, 2026-11-12: 70)
  toyZoom: 11,          // toys from this zoom in (further out: dots)
};

const hash = new URLSearchParams(location.hash.slice(1));
const num = (v, d) => (v !== null && Number.isFinite(Number(v)) ? Number(v) : d);

export const settings = {
  trainStyle: ['toy', 'real'].includes(hash.get('train')) ? hash.get('train') : DEFAULTS.trainStyle,
  toySize: num(hash.get('toysize'), DEFAULTS.toySize),
  toyZoom: num(hash.get('toyzoom'), DEFAULTS.toyZoom),
};
