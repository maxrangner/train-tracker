// Builds the public page (public-plan step 3) into dist-public/: no key (VITE_TRV_KEY emptied), the data from the
// fetcher's files (VITE_DATA_URL) and taps through php/ask.php (VITE_TAP_URL), then searches the build for the key
// (tools/key-search.mjs) and fails if it is there. dist/ (the phone build, with the key) is not touched.
// The background map from our own file (public-plan step 5, tools/map-file.mjs): --map <address of the .pmtiles file>
// (VITE_MAP_URL); without it, OpenFreeMap as on the dev page.
// Run: npm run build:public -- --data <files address> --tap <ask.php address> --map <map file address>
//   e.g. --data http://localhost:8090/ (the fetcher's --serve here) or the folder on one.com (step 7).
import { spawnSync } from 'node:child_process';

const arg = name => { const i = process.argv.indexOf(`--${name}`); return i < 0 ? null : process.argv[i + 1]; };
const data = arg('data') ?? process.env.VITE_DATA_URL, tap = arg('tap') ?? process.env.VITE_TAP_URL ?? '';
const mapFile = arg('map') ?? process.env.VITE_MAP_URL ?? '';
if (!data) { console.log('build:public needs --data <address of the fetcher\'s files> (and --tap <address of ask.php>, --map <address of the map file>)'); process.exit(2); }

// Values already in the environment win over .env (Vite), so the key is empty in this build.
const env = { ...process.env, VITE_TRV_KEY: '', VITE_DATA_URL: data, VITE_TAP_URL: tap, VITE_MAP_URL: mapFile };
const build = spawnSync('npx', ['vite', 'build', '--outDir', 'dist-public', '--emptyOutDir'], { stdio: 'inherit', env, shell: true });
if (build.status !== 0) process.exit(build.status ?? 1);
console.log(`built dist-public/: data ${data}, taps ${tap || '(none)'}, map ${mapFile || 'OpenFreeMap'}`);
const search = spawnSync('node', ['tools/key-search.mjs', 'dist-public'], { stdio: 'inherit' });
process.exit(search.status === 2 ? 0 : search.status ?? 1);
