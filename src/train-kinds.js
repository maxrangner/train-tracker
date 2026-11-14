// What kind of train a company's trains are, for the stats page's "Kinds of train" list and the map's filter (Max,
// 2026-11-14: "including regional, commuter, etc is a good idea"). By the company name Trafikverket gives a train
// (ProductInformation, as in src/brands.js); a company running several kinds is put under its usual one. A name not
// in the table is "other"; no name yet is "unknown" (freight and service trains are among these).
const TABLE = {
  'SL Pendeltåg': 'commuter',
  'Östgötapendel': 'commuter',
  'Västtågen': 'regional',
  'Pågatågen': 'regional',
  'Pågatågen Exp': 'regional',
  'Mälartåg': 'regional',
  'Öresundståg': 'regional',
  'Krösatågen': 'regional',
  'TiB': 'regional',
  'SJ Regional': 'regional',
  'Norrtåg': 'regional',
  'VTAB': 'regional',
  'X-Tåget': 'regional',
  'Tågab': 'regional',
  'SJ Snabbtåg': 'long',
  'SJ InterCity': 'long',
  'SJ': 'long',
  'VR Snabbtåg': 'long',
  'Vy Snabbtåg': 'long',
  'Snälltåget': 'long',
  'SJ Nattåg': 'night',
};
// In the order they are listed.
export const KINDS = ['commuter', 'regional', 'long', 'night', 'other', 'unknown'];
export const kindOf = brand => (!brand ? 'unknown' : TABLE[brand] ?? 'other');
