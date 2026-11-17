// Builds the public page (public-plan step 3) into dist-public/: no key (VITE_TRV_KEY emptied), the data from the
// fetcher's files (VITE_DATA_URL; taps from them too since plan step 4, 2026-11-17), then searches the build for the key
// (tools/key-search.mjs) and fails if it is there. dist/ (the phone build, with the key) is not touched.
// The background map from our own file (public-plan step 5, tools/map-file.mjs): --map <address of the .pmtiles file>
// (VITE_MAP_URL); without it, OpenFreeMap as on the dev page.
// Run: npm run build:public -- --data <files address> --map <map file address>
//   e.g. --data http://localhost:8090/ (the fetcher's --serve here) or the folder on one.com (step 7).
import { spawnSync } from 'node:child_process';

const arg = name => { const i = process.argv.indexOf(`--${name}`); return i < 0 ? null : process.argv[i + 1]; };
const data = arg('data') ?? process.env.VITE_DATA_URL;
const mapFile = arg('map') ?? process.env.VITE_MAP_URL ?? '';
if (!data) { console.log('build:public needs --data <address of the fetcher\'s files> (and --map <address of the map file>)'); process.exit(2); }

// Values already in the environment win over .env (Vite), so the key is empty in this build.
const env = { ...process.env, VITE_TRV_KEY: '', VITE_DATA_URL: data, VITE_MAP_URL: mapFile };
const build = spawnSync('npx', ['vite', 'build', '--outDir', 'dist-public', '--emptyOutDir'], { stdio: 'inherit', env, shell: true });
if (build.status !== 0) process.exit(build.status ?? 1);
console.log(`built dist-public/: data ${data}, map ${mapFile || 'OpenFreeMap'}`);
// Every secret, and a search that can't run is a failure too (plan to beta phase B, 2026-11-17: exit 2 used to pass).
const search = spawnSync('node', ['tools/key-search.mjs', 'dist-public'], { stdio: 'inherit' });
process.exit(search.status === 0 ? 0 : 1);
