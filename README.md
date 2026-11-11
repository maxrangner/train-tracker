# Train map

A live map of Sweden's trains, from Trafikverket's open data. The plan and the decisions behind it: [PLAN.md](PLAN.md).

## Start it
```
npm install                  (once)
node tools/rail-trv.mjs      (once: Trafikverket's rail lines, ~11 MB, into public/)
node tools/rail-net.mjs      (once, after it: the network the page loads, 1.7 MB, into public/)
node tools/rail-osm.mjs      (once: OpenStreetMap's rail lines, ~6 MB, into public/)
npm run dev
```
It prints two addresses:
- **Local** (`http://localhost:5173/`): open on this computer.
- **Network** (`http://192.168.x.x:5173/`): open on a phone on the same wifi. The first time, Windows may ask whether Node.js may use the network: allow it.
  - On Android, Chrome needs the **Nearby devices** permission (Settings → Apps → Chrome → Permissions) to reach anything at home; without it every home address fails with `ERR_TOO_MANY_RETRIES`, the router's too. Type the address in the Chrome app itself, not in a link opened inside another app.
  - Errors show in red in the top box, since a phone has no console. `node tools/hello.mjs` runs a tiny page on port 8099 that logs every visitor, to see whether a phone's request arrives at all.

The map's place is kept in the address (`#view=zoom/lat/lon`), so a link opens the same view.

## The key
The Trafikverket key lives in `.env` (never in git):
```
VITE_TRV_KEY=your-key
```
Get one at data.trafikverket.se: Kom igång → Registrera, then Skapa nyckel.
While the map is private the key is built into the page; the public version will keep it on a small server instead (PLAN.md, decision 3).

## On the map
- **Dots**: the colour shows lateness: green +2 minutes or less, yellow +3 to +5, red +6 or more, grey not known.
- **Movement**: the map runs about 25 s behind real time. Each train is a small simulation that follows the tracks and chases where its reports say it was: it speeds up and slows down gently and never drives backwards; with no new position it coasts on for at most 30 s, then waits. A train that has fallen far behind its data fast-forwards, with `»»` after its label.
- **Labels** (zoom in to see them): board number and minutes off the timetable at the last station passed: `2042 (+2)` late, `2057 (-21)` early.
- **Tap a train**: a ring marks it, a panel lists its stops with planned and actual times, and the camera follows the train (the **Following** button). Zooming, turning and tilting keep following; dragging the map away stops it (the button turns to **Follow**: press it to go back). Tap the map or × to close.
- **3D trains**: from zoom 13 in, each train is a simple 3D model at real size, in its brand's colours (generic grey without a brand). Tilt to see them: the Tilt button, two fingers up/down, or the compass.
- **The brand sheet**: `/demo/brands.html` shows every brand's train with its colours and their sources (run `node tools/brands.mjs` first).
- **Top**: the status line (number of trains, seconds since the last report, `live` / `reconnecting` / `every 10 s`, red text when something is wrong) and the rail line switch (Trafikverket / OpenStreetMap / none).

## What is where
- `src/trafikverket.js`: everything that talks to Trafikverket: one query, following a live stream (falls back to asking every 10 s), passings, a train's route, station names.
- `src/trains-source.js`: train positions, from that file.
- `src/trains.js`: each train's reports, cleaned (repeats, noise against the train's direction, far jumps), and the simulation that is drawn.
- `src/rail-net.js`: the rail network: the track under a place, the way along the tracks between two places (never reversing through a switch), the track ahead of a train.
- `src/lateness.js`: minutes off timetable per train; the label text.
- `src/panel.js`: the panel for a tapped train.
- `src/map.js`: the map (OpenFreeMap, Positron style), rail lines, dots, labels, ring.
- `src/main.js`: ties them together; the status line; the rail switch.
- `tools/`: helpers run with Node.
  - `rail-trv.mjs`, `rail-osm.mjs`: download the rail lines.
  - `rail-net.mjs`: builds the page's rail network from Trafikverket's lines: joined where a line touches another mid-way, simplified to within 0.5 m, saved compactly.
  - `rail-compare.mjs`: how close recorded positions sit to each set of lines (and to the page's network).
  - `collect.mjs [minutes] [--at 07:00]`: records the live positions and timetable to `data/` (and the stations once), for replays; `--at` waits until that time.
  - `measure.mjs`: numbers from the newest recording.
  - `crosscheck.mjs`: a few trains' positions against their last station.
  - `shot.mjs`: a picture of the running page (`--view`, `--rail`, `--tap`, `--size`), into `shots/`.
  - `soak.mjs [minutes]`: keeps the page open and logs the status line.
  - `glide-check.mjs`: drawn speed against reported speed.
  - `motion-check.mjs [--delay 25] [--coast 30] [--plain] [--cut 120] [--trace id] [--why]`: replays a recording through the page's train code and compares with the truth (the cleaned reports, in hindsight): how often moving trains are drawn standing or turning back, how far off they are, how often they fast-forward. `--plain` draws the reports directly (the old way); `--cut` drops the data for a while (a lost connection).
  - `follow-check.mjs [--fastest]`: taps a moving train and measures how well the camera follows it, through drags, a zoom and the Follow button.
  - `ping.mjs`, `peek.mjs`, `late-peek.mjs`, `route-peek.mjs`: small checks of the key, the raw stream, passings and a route.
