# Train map

A live map of Sweden's trains, from Trafikverket's open data. Step 1 of the plan: every train with GPS is a dot with its board number, moving as reports arrive. The plan and the decisions behind it: [PLAN.md](PLAN.md).

## Start it
```
npm install      (once)
npm run dev
```
It prints two addresses:
- **Local** (`http://localhost:5173/`): open on this computer.
- **Network** (`http://192.168.x.x:5173/`): open on a phone on the same wifi. The first time, Windows may ask whether Node.js may use the network: allow it for private networks.

## The key
The Trafikverket key lives in `.env` (never in git):
```
VITE_TRV_KEY=your-key
```
Get one at data.trafikverket.se: Kom igång → Registrera, then Skapa nyckel.
While the map is private the key is built into the page; the public version will keep it on a small server instead (PLAN.md, decision 3).

## What is where
- `src/trains-source.js`: the only code that talks to Trafikverket (one query, then the live stream; falls back to asking every 10 s).
- `src/trains.js`: the newest report per train; drops reports over 10 minutes old.
- `src/map.js`: the map (OpenFreeMap, Positron style) and the dots and numbers.
- `src/main.js`: ties them together; the status line.
- `tools/`: helpers run with Node.
  - `collect.mjs [minutes]`: records the live stream to `data/`.
  - `measure.mjs`: numbers from the newest recording.
  - `shot.mjs`: a picture of the running page (`shots/`).
  - `ping.mjs`: one small call, to check the key.
  - `peek.mjs`: the raw stream as sent.

## The status line
`366 trains · last report 0 s ago · live`
- **live**: the stream is open.
- **reconnecting**: the stream broke and is being reopened.
- **every 10 s**: the stream kept breaking, so the page asks every 10 seconds instead.
- Red text: what went wrong.

Dot colour: blue is moving, red is standing (speed 0).
