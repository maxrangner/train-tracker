// Each brand's look: paint colours and number of cars. Brands are as named in Trafikverket's timetable
// (ProductInformation). Trains with no brand (freight, service) or a brand not listed get the generic look.
//
// Colours: read off 2025–26 photos (mostly Wikimedia Commons) by the brand research of 2026-11-11; no brand
// publishes official colour codes, so each is an estimate (±10 % with the light). `source` names the photo or page.
// Cars: the usual unit length of the brand's main vehicle, approximate; trains often run as two units coupled.
//
// Colour parts (see train-model.js): body, skirt (lower body), band (windows), roof, nose (cab front), stripe.

const GENERIC = { colours: { body: '#c9d1d9', skirt: '#57606a', nose: '#c9d1d9' }, cars: 3 };

const SJ_SILVER = {
  colours: { body: '#a9acaf', skirt: '#8e9194', band: '#3a3d42', roof: '#c4c7ca', nose: '#a9acaf' },
  cars: 6,
};

export const BRANDS = {
  'Västtågen': {
    colours: { body: '#b4b8bc', skirt: '#3c4045', roof: '#2a9ad9', nose: '#2a9ad9' },
    cars: 4,
    source: 'Silver with blue (repainting from yellow 2025–26; most current photos blue). Commons: Västtågen, Stenungsund 2025-08-16; X80 2026-05-15.',
  },
  'Pågatågen': {
    colours: { body: '#6a66d2', skirt: '#3f3d96', roof: '#9b92e2', nose: '#3f3d96' },
    cars: 4,
    source: 'Purple X61. Commons: Pågatåg X61 084, Helsingborg C, 2025-07-29.',
  },
  'SL Pendeltåg': {
    colours: { body: '#e4e3de', skirt: '#3d7fc5', nose: '#4a4d52' },
    cars: 6,
    source: 'Off-white X60 with a blue sweep. Commons: SL X60, Stockholms Central, 2026-04-04.',
  },
  'Mälartåg': {
    colours: { body: '#e8e8e8', skirt: '#2f5fc8', roof: '#2f5fc8', nose: '#2f5fc8', stripe: '#d93a3e' },
    cars: 4,
    source: 'White with strong blue, red details. Commons: Mälartåg ER1 111, Gävle.',
  },
  'Öresundståg': {
    colours: { body: '#c8cccf', skirt: '#8f9498', nose: '#1e1e1e', stripe: '#f0a030' },
    cars: 3,
    source: 'Silver X31K, black front, thin orange line. oresundstag.se; Commons: Göteborgs C 2026-04-06.',
  },
  'Krösatågen': {
    colours: { body: '#9da2a6', skirt: '#6e7378', roof: '#d9343f', nose: '#d9343f' },
    cars: 2,
    source: 'Grey with red front and roof band. Commons: Krösatågen, Västervik 2026-05-25.',
  },
  'Östgötapendel': {
    colours: { body: '#ece6da', skirt: '#e2475a', nose: '#1f1f22', stripe: '#f09a2e' },
    cars: 4,
    source: 'Cream X61 with orange and red-pink panels, black front. Commons: Östgötapendeln, Tranås 2026-03-28.',
  },
  'TiB': {
    colours: { body: '#a9a59e', skirt: '#7d7a74', roof: '#d8372f', nose: '#ededed' },
    cars: 2,
    source: 'Silver-beige with a red roof sweep, white nose. Commons: Tåg i Bergslagen, Örebro C 2026-04-11.',
  },
  'SJ Snabbtåg': { ...SJ_SILVER, colours: { ...SJ_SILVER.colours, nose: '#232426' },
    source: 'Silver-grey X2000/X55, refurbished X2 with black front. Commons: SJ X2000, Linköping 2026-05-25.' },
  'SJ Regional': { ...SJ_SILVER, colours: { ...SJ_SILVER.colours, body: '#b6b9bc' }, cars: 4,
    source: 'Silver-grey X40. Commons: SJ X40, Köping 2026-05-14.' },
  'SJ InterCity': {
    colours: { body: '#2f3440', skirt: '#232426', band: '#151a22', roof: '#4a505c', nose: '#232426' },
    cars: 6,
    source: 'Near-black coaches behind a black Rc6 (drawn with the same shape for now). Commons: Gävle C 2025-07-19.',
  },
  'SJ Nattåg': {
    colours: { body: '#2e3138', skirt: '#232426', band: '#151a22', roof: '#4a505c', nose: '#232426' },
    cars: 8,
    source: 'Dark charcoal coaches, black Rc6. Commons: SJ nattåg, Göteborg 2024-07-28.',
  },
  'SJ': { ...SJ_SILVER, source: 'Not confirmed which trains: SJ silver-grey.' },
  'Norrtåg': {
    colours: { body: '#2448a0', skirt: '#1c3a82', roof: '#c9ccd0', nose: '#2448a0', stripe: '#f2a81d' },
    cars: 4,
    source: 'Dark blue with a yellow-orange band. Commons: Åre station, Norrtåg 2026-01-17.',
  },
  'VTAB': {
    colours: { body: '#e6e7e8', skirt: '#6e7175', roof: '#f2c230', nose: '#f2c230', stripe: '#2e9e4a' },
    cars: 2,
    source: 'White with yellow front and roof edge, green stripe (newest photo 2022). Commons: Kil X53 9049.',
  },
  'X-Tåget': {
    colours: { body: '#c9cbce', skirt: '#8d9094', roof: '#d9262e', nose: '#d9262e' },
    cars: 2,
    source: 'Silver with red front and roof. Commons: X-Tåget, Gävle 2026-03-27.',
  },
  'VR Snabbtåg': {
    colours: { body: '#4cc04a', skirt: '#2e9a3a', nose: '#4cc04a', stripe: '#d8343a' },
    cars: 5,
    source: 'Bright green X74. VR press release ("gröna snabbtåg"); Commons: VR X74.',
  },
  'Vy Snabbtåg': {
    colours: { body: '#1f8a93', skirt: '#2e3a3f', roof: '#c9ccd0', nose: '#2e3a3f' },
    cars: 5,
    source: 'Teal Flirt (the only Vy train photographed in Sweden 2025–26; product not confirmed). Commons: Vy, Lödöse södra 2026-06-01.',
  },
  'Snälltåget': {
    colours: { body: '#e6e6e6', skirt: '#e0322e', roof: '#b9bcbf', nose: '#d42a2a' },
    cars: 7,
    source: 'White coaches with red ends behind a red Vectron (same shape for now). Commons: Snälltåg, Malmö 2025-07-24.',
  },
  'Tågab': {
    colours: { body: '#bdbdbd', skirt: '#8a8a8a', nose: '#3b6fc0', stripe: '#c8343c' },
    cars: 5,
    source: 'Silver coaches with a red side stripe, blue Rc loco (fleet list 2023). sv.wikipedia: Tågåkeriet i Bergslagen.',
  },
};
BRANDS['Pågatågen Exp'] = { ...BRANDS['Pågatågen'], source: 'As Pågatågen (inferred: same X61 trains).' };

export function styleFor(brand) {
  return BRANDS[brand] ?? GENERIC;
}
