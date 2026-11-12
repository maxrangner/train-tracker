// Each company's toy train: which train model it usually runs (the shape, toy-trains.js) and its paint.
// Read off 2024–26 photos (Wikimedia Commons) and fleet lists in the research of 2026-11-12; `photo` is the page the
// paint was read from (or the best source found). Ordered by trains a day (timetable of 2026-11-11).
// Trains with no company (freight, service) get the generic toy.

const GENERIC = { model: 'regina', colours: { body: '#c9d1d9', skirt: '#57606a' } };
const C = 'https://commons.wikimedia.org/wiki/File:';

export const TOYS = {
  'Västtågen': {
    model: 'coradia',   // X61 Alstom Coradia Nordic, the most common; Regina, X11/X12/X14, Itino and the new X80 too
    colours: { body: '#b9bdc1', roof: '#2aa8e0', nose: '#b9bdc1', frame: '#2aa8e0', skirt: '#9da1a5' },
    photo: C + '20260529_X61_410_G%C3%B6teborg_C.jpg',
    note: 'X61 in the new blue livery (repainted 2025–26), Göteborg C, 2026-05-29.',
  },
  'Pågatågen': {
    model: 'coradia',   // X61, the whole fleet (99 sets)
    colours: { body: '#6a66d2', roof: '#7d79dc', nose: '#6a66d2', frame: '#3f3d96', skirt: '#5753bd' },
    photo: C + '2025-07-29,_P%C3%A5gat%C3%A5g_X61_084_at_Helsingborg_C.jpg',
    note: 'X61, purple all over, darker purple round the windscreen. Helsingborg C, 2025-07-29.',
  },
  'SL Pendeltåg': {
    model: 'coradia',   // X60 Alstom Coradia Nordic, the whole fleet (~129 units)
    colours: { body: '#e6e5e0', roof: '#d9d8d3', nose: '#e6e5e0', stripe: '#3d7fc5', frame: '#2b2e33' },
    photo: C + 'SL_X60,_Stockholms_Central_-_20260404_-_01.jpg',
    note: 'X60: off-white with a blue sweep along the lower side, a black mask round the windscreen. Stockholm C, 2026-04-04.',
  },
  'Mälartåg': {
    model: 'dosto',     // ER1 Stadler Dosto, 53 units; also 9 Regina
    colours: { body: '#ededed', roof: '#dcdcdc', nose: '#2f5fc8', stripe: '#2f5fc8' },
    photo: C + '2025-07-16_3168_M%C3%A4lart%C3%A5g_ER1_051_i_Uppsala.jpg',
    note: 'ER1 double-decker: white, the cab end blue, red doors. Uppsala, 2025-07-16.',
  },
  'Öresundståg': {
    model: 'x31',       // X31K Contessa, about all of it
    colours: { body: '#c8cccf', skirt: '#9a9ea2', roof: '#d4d7da', nose: '#1e1e1e', stripe: '#f0a030' },
    photo: C + '2024-07-29_3701_%C3%96resundst%C3%A5g_i_Varberg.jpg',
    note: 'X31K: light grey, a blunt black front, a thin orange line. Varberg, 2024-07-29.',
  },
  'Krösatågen': {
    model: 'itino',     // Itino and X11/X14; which is most common is not confirmed; new all-red CAF trains coming
    colours: { body: '#9da2a6', skirt: '#6e7378', roof: '#d9343f', nose: '#d9343f' },
    photo: 'https://commons.wikimedia.org/w/index.php?search=Kr%C3%B6sat%C3%A5gen&title=Special:MediaSearch&type=image&sort=recency',
    note: 'Grey with a red front and roof (repainted; older trains still yellow). New all-red trains are being delivered in 2026.',
  },
  'Östgötapendel': {
    model: 'coradia',   // X61, 18 sets
    colours: { body: '#ece6da', roof: '#e2ddd2', nose: '#ece6da', frame: '#1f1f22', skirt: '#e2475a', stripe: '#f09a2e' },
    photo: C + '%C3%96stg%C3%B6tapendeln,_Tran%C3%A5s_station_-_20260328_-_01.jpg',
    note: 'X61: cream, black round the windscreen, orange, red and pink panels along the side. Tranås, 2026-03-28.',
  },
  'TiB': {
    model: 'regina',    // Regina about 3 in 4; also 7 ER1
    colours: { body: '#d9d7d2', skirt: '#a9a59e', roof: '#d8372f', nose: '#ededed', frame: '#d8372f' },
    photo: C + 'T%C3%A5g_i_Bergslagen,_%C3%96rebro_Central_-_20260411_-_08.jpg',
    note: 'Regina: white-grey with a red roof band sweeping down over the cab. Örebro C, 2026-04-11.',
  },
  'SJ Regional': {
    model: 'x40',       // X40 Coradia Duplex, 43 units; refurbished ones are dark charcoal (14 of 27 three-car by Sept 2026)
    colours: { body: '#b6b9bc', skirt: '#8e9194', band: '#33363b', roof: '#c4c7ca', nose: '#b6b9bc' },
    photo: C + 'SJ_X40,_%C3%96rebro_Central_-_20260411_-_25.jpg',
    note: 'X40 double-decker, silver-grey (not refurbished yet; refurbished ones are dark grey with green). Örebro C, 2026-04-11.',
  },
  'SJ Snabbtåg': {
    model: 'x2000',     // X2 (X2000), about 36 sets; also 20 X55 (Regina)
    colours: { body: '#a9acaf', skirt: '#8e9194', band: '#33363b', roof: '#c4c7ca', nose: '#c9ccce' },
    photo: C + 'SJ_X55,_SJ_X2,_Alvesta_-_20250709_-_04.jpg',
    note: 'X2000: silver-grey with ribbed coach sides, a light front. Alvesta, 2025-07-09.',
  },
  'Norrtåg': {
    model: 'coradia',   // X62 Coradia Nordic, the most common; also Regina X52, 3 X11
    colours: { body: '#2448a0', skirt: '#1c3a82', roof: '#2448a0', nose: '#2448a0', frame: '#f2a81d', stripe: '#f2a81d' },
    photo: C + 'Norrt%C3%A5g,_X62,_Kramfors_-_20250503_-_13.jpg',
    note: 'X62: dark blue, a yellow band round the windscreen and along the side. Kramfors, 2025-05-03.',
  },
  'VTAB': {
    model: 'regina',    // Regina X53; also Itino
    colours: { body: '#e6e7e8', skirt: '#2e7d4a', roof: '#e6e7e8', nose: '#f2c230', stripe: '#2e9e4a' },
    photo: C + '13.05.22_Kil_X53_9049_(52093981186).jpg',
    note: 'X53: white, a yellow front, green along the lower side. Kil, 2022-05-13 (the newest photo found; today\'s paint not confirmed).',
  },
  'SJ InterCity': {
    model: 'rc',        // Rc6 locomotive + coaches; some X40 too
    colours: { body: '#3a4150', skirt: '#2b303a', band: '#151a22', roof: '#4d5361',
      loco: { body: '#25282d', nose: '#25282d', stripe: '#e0b030' } },
    photo: C + 'G%C3%A4lve_centralstation_-_20250719_-_02.jpg',
    note: 'Black Rc6 with yellow trim, dark coaches. Gävle C, 2025-07-19.',
  },
  'X-Tåget': {
    model: 'regina',    // Regina only (X50, X51, X52)
    colours: { body: '#c9cbce', skirt: '#8d9094', roof: '#d9262e', nose: '#d9262e' },
    photo: 'https://sv.wikipedia.org/wiki/X-t%C3%A5get',
    note: 'Regina: silver with a red front and roof (Gävle, 2026-03-27, from the first brand research; not re-checked).',
  },
  'VR Snabbtåg': {
    model: 'flirt',     // X74 Stadler FLIRT, 6 units, the only type
    colours: { body: '#4cc04a', skirt: '#8a8f94', roof: '#4cc04a', nose: '#4cc04a', frame: '#173d1c', stripe: '#d8343a' },
    photo: C + 'VR_-_Herrljunga_-_20250819_-_05.jpg',
    note: 'X74 FLIRT: bright green, a dark mask round the windscreen. Herrljunga, 2025-08-19.',
  },
  'Pågatågen Exp': {
    model: 'coradia',   // as Pågatågen
    colours: { body: '#6a66d2', roof: '#7d79dc', nose: '#6a66d2', frame: '#3f3d96', skirt: '#5753bd' },
    photo: C + '2025-07-29,_P%C3%A5gat%C3%A5g_X61_084_at_Helsingborg_C.jpg',
    note: 'As Pågatågen (the same X61 trains).',
  },
  'Vy Snabbtåg': {
    model: 'flirt',     // Norwegian type 74 FLIRT; which route the brand covers is not confirmed
    colours: { body: '#1f6f78', skirt: '#2e3a3f', roof: '#1f6f78', nose: '#1f6f78', frame: '#141819' },
    photo: C + 'Vy,_L%C3%B6dose_s%C3%B6dra_-_20260601_-_03.jpg',
    note: 'Type 74 FLIRT: dark teal, a black mask. Lödöse södra, 2026-06-01.',
  },
  'SJ Nattåg': {
    model: 'rc',        // Rc6 + sleeper and couchette coaches
    colours: { body: '#9a9ea3', skirt: '#24427e', band: '#1b2230', roof: '#b4b7bb',
      loco: { body: '#25282d', nose: '#25282d', skirt: '#c0282d', stripe: '#e0b030' } },
    photo: C + '2025-03-02_6388_Natt%C3%A5g_68_fr%C3%A5n_Malm%C3%B6_och_70_fr%C3%A5n_Stockholm_i_Duved.jpg',
    note: 'Black Rc6 with a red lower front; sleeper coaches grey above, blue below. Duved, 2025-03-02.',
  },
  'Snälltåget': {
    model: 'vectron',   // Vectron locomotive + coaches
    colours: { body: '#e9e9e9', skirt: '#d0202a', roof: '#c4c6c8', stripe: '#d0202a',
      loco: { body: '#d0202a', nose: '#d0202a', roof: '#1b1b1b', skirt: '#1b1b1b' } },
    photo: C + '2025-11-15_8338_Sn%C3%A4llt%C3%A5get_193_254_i_Malm%C3%B6.jpg',
    note: 'Red Vectron with a black roof and lower band; light coaches with red. Malmö, 2025-11-15.',
  },
  'SJ': {
    model: 'c73',       // probably SJ Norge's Trondheim–Storlien with Norwegian class 73 (not confirmed from our data)
    colours: { body: '#1d2a4d', skirt: '#162039', roof: '#1d2a4d', nose: '#1d2a4d', stripe: '#e8c22c' },
    photo: C + 'SJ_Norge_Class_73_Storlien_2026-06-25.jpg',
    note: 'Probably SJ Norge\'s class 73 (Trondheim–Storlien): navy blue, a yellow line. Storlien, 2026-06-25. Not confirmed.',
  },
  'Tågab': {
    model: 'rc',        // Rc2/Rc3 locomotive + old ex-SJ coaches
    colours: { body: '#d9dadb', skirt: '#9a9c9e', roof: '#b9bbbd', stripe: '#c0282d',
      loco: { body: '#2a4f9e', nose: '#2a4f9e', skirt: '#c0282d', stripe: '#f2f2f2' } },
    photo: C + 'T%C3%A5g_AB,_Stockholm,_20250208_-_25.jpg',
    note: 'Blue Rc with a red lower front and white stripes; light grey coaches with a red band. Stockholm, 2025-02-08.',
  },
};

export const toyFor = (brand) => TOYS[brand] ?? GENERIC;
