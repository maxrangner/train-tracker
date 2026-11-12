// Each company's toy train: which train model it usually runs (the shape, toy-trains.js) and its paint.
// Read off 2025–26 photos (Wikimedia Commons) and fleet lists in the research of 2026-11-12; `photo` is the one the
// paint was read from. Companies not listed yet get the generic toy (to be filled in after the first test).

const GENERIC = { model: 'regina', colours: { body: '#c9d1d9', skirt: '#57606a' } };

export const TOYS = {
  'Västtågen': {
    model: 'coradia',   // X61 Alstom Coradia Nordic, the most common; Regina, X11/X12/X14, Itino and the new X80 too
    colours: { body: '#b9bdc1', roof: '#2aa8e0', nose: '#b9bdc1', frame: '#2aa8e0', skirt: '#9da1a5' },
    photo: 'https://commons.wikimedia.org/wiki/File:20260529_X61_410_G%C3%B6teborg_C.jpg',
    note: 'X61 in the new blue livery (repainted 2025–26), Göteborg C, 2026-05-29.',
  },
  'SL Pendeltåg': {
    model: 'coradia',   // X60 Alstom Coradia Nordic, the whole fleet (~129 units)
    colours: { body: '#e6e5e0', roof: '#d9d8d3', nose: '#e6e5e0', stripe: '#3d7fc5', frame: '#2b2e33' },
    photo: 'https://commons.wikimedia.org/wiki/File:SL_X60,_Stockholms_Central_-_20260404_-_01.jpg',
    note: 'X60: off-white with a blue sweep along the lower side, a black mask round the windscreen. Stockholm C, 2026-04-04.',
  },
  'Mälartåg': {
    model: 'dosto',     // ER1 Stadler Dosto, 53 units; also 9 Regina
    colours: { body: '#ededed', roof: '#dcdcdc', nose: '#2f5fc8', stripe: '#2f5fc8' },
    photo: 'https://commons.wikimedia.org/wiki/File:2025-07-16_3168_M%C3%A4lart%C3%A5g_ER1_051_i_Uppsala.jpg',
    note: 'ER1 double-decker: white, the cab end blue, red doors. Uppsala, 2025-07-16.',
  },
  'SJ Snabbtåg': {
    model: 'x2000',     // X2 (X2000), about 36 sets; also 20 X55 (Regina)
    colours: { body: '#a9acaf', skirt: '#8e9194', band: '#33363b', roof: '#c4c7ca', nose: '#c9ccce' },
    photo: 'https://commons.wikimedia.org/wiki/File:SJ_X55,_SJ_X2,_Alvesta_-_20250709_-_04.jpg',
    note: 'X2000: silver-grey with ribbed coach sides, a light front. Alvesta, 2025-07-09.',
  },
  'SJ InterCity': {
    model: 'rc',        // Rc6 locomotive + coaches; some X40 too
    colours: { body: '#3a4150', skirt: '#2b303a', band: '#151a22', roof: '#4d5361',
      loco: { body: '#25282d', nose: '#25282d', stripe: '#e0b030' } },
    photo: 'https://commons.wikimedia.org/wiki/File:G%C3%A4lve_centralstation_-_20250719_-_02.jpg',
    note: 'Black Rc6 with yellow trim, dark coaches. Gävle C, 2025-07-19.',
  },
};

export const toyFor = (brand) => TOYS[brand] ?? GENERIC;
