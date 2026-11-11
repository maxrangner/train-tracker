# Train map

A live map of Sweden's trains, from Trafikverket's open data. The plan and the decisions behind it: [PLAN.md](PLAN.md).

## Start it
```
npm install                  (once)
node tools/rail-trv.mjs      (once: Trafikverket's rail lines, ~11 MB, into public/)
node tools/rail-osm.mjs      (once: OpenStreetMap's rail lines, ~6 MB, into public/)
npm run dev
```
It prints two addresses:
- **Local** (`http://localhost:5173/`): open on this computer.
- **Network** (`http://192.168.x.x:5173/`): open on a phone on the same wifi. The first time, Windows may ask whether Node.js may use the network: allow it for private networks.

The map's place is kept in the address (`#view=zoom/lat/lon`), so a link opens the same view.

## The key
The Trafikverket key lives in `.env` (never in git):
```
VITE_TRV_KEY=your-key
```
Get one at data.trafikverket.se: Kom igång → Registrera, then Skapa nyckel.
While the map is private the key is built into the page; the public version will keep it on a small server instead (PLAN.md, decision 3).

## On the map
- **Dots**: blue moving, red standing, grey not known yet (the train sends no speed and has only one report so far).
- **Labels** (zoom in to see them): board number and minutes off the timetable at the last station passed: `2042 (+2)` late, `2057 (-21)` early.
- **Tap a train**: a ring marks it, and a panel lists its stops with planned and actual times. Tap the map or × to close.
- **Top**: the status line (number of trains, seconds since the last report, `live` / `reconnecting` / `every 10 s`, red text when something is wrong) and the rail line switch (Trafikverket / OpenStreetMap / none).

## What is where
- `src/trafikverket.js`: everything that talks to Trafikverket: one query, following a live stream (falls back to asking every 10 s), passings, a train's route, station names.
- `src/trains-source.js`: train positions, from that file.
- `src/trains.js`: the newest report per train; drops reports over 10 minutes old; works out movement when no speed is sent.
- `src/lateness.js`: minutes off timetable per train; the label text.
- `src/panel.js`: the panel for a tapped train.
- `src/map.js`: the map (OpenFreeMap, Positron style), rail lines, dots, labels, ring.
- `src/main.js`: ties them together; the status line; the rail switch.
- `tools/`: helpers run with Node.
  - `rail-trv.mjs`, `rail-osm.mjs`: download the rail lines.
  - `rail-compare.mjs`: how close recorded positions sit to each set of lines.
  - `collect.mjs [minutes]`: records the live stream to `data/`.
  - `measure.mjs`: numbers from the newest recording.
  - `crosscheck.mjs`: a few trains' positions against their last station.
  - `shot.mjs`: a picture of the running page (`--view`, `--rail`, `--tap`, `--size`), into `shots/`.
  - `soak.mjs [minutes]`: keeps the page open and logs the status line.
  - `ping.mjs`, `peek.mjs`, `late-peek.mjs`, `route-peek.mjs`: small checks of the key, the raw stream, passings and a route.
