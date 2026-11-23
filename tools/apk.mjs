// The Android app (2026-11-16): npm run apk. Builds the page (vite build → dist/), copies it into the Android project
// (npx cap sync), builds a debug APK with Gradle, and puts it in dist/ (so the phone server, port 4173, offers it:
// http://<PC>:4173/<name>.apk). The app is the same page inside Android's built-in browser.
//   npm run apk               the dev app, dist/sparat-dev.apk: it reads Trafikverket itself with the key from .env,
//                             which is inside it, as in dist/: never share it.
//   npm run apk -- --public   the app without a key (2026-11-17, Max: "a first real APK without key"), dist/sparat-<version>.apk:
//                             as the public page, it reads the Linux PC's files and the map from the site (SITE below);
//                             the key search runs over what goes into it and stops the build on a find.
// Both are signed with Android's debug signature (fine on Max's own phone; sharing it needs a release signature).
// Needs: Java 17 (JAVA_HOME, or the Temurin 17 in %LOCALAPPDATA%\Programs\Java), the Android SDK
// (ANDROID_HOME, or %LOCALAPPDATA%\Android\Sdk). The first build downloads Gradle and Android's build parts.
import { execSync, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const SITE = 'https://sparat.rangner.com';
const PUBLIC = process.argv.includes('--public');
const local = process.env.LOCALAPPDATA ?? '';
const javaDir = join(local, 'Programs', 'Java');
const JAVA_HOME = process.env.JAVA_HOME
  ?? (existsSync(javaDir) ? readdirSync(javaDir).filter(d => d.startsWith('jdk-17')).map(d => join(javaDir, d))[0] : undefined);
const SDK = process.env.ANDROID_HOME ?? join(local, 'Android', 'Sdk');
if (!JAVA_HOME || !existsSync(JAVA_HOME)) throw new Error('No Java 17 found: set JAVA_HOME');
if (!existsSync(SDK)) throw new Error('No Android SDK found: set ANDROID_HOME');
writeFileSync('android/local.properties', `sdk.dir=${SDK.replaceAll('\\', '/')}\n`);   // git ignores it

// The public app: values in the environment win over .env (Vite), so the key is empty; the map file is the newest cut
// (as tools/deploy.mjs puts on the site).
const mapName = readdirSync('data/map').filter(n => /^sweden-.*\.pmtiles$/.test(n)).sort().at(-1);
if (PUBLIC && !mapName) throw new Error('no data/map/sweden-<date>.pmtiles (the map file on the site)');
const env = { ...process.env, JAVA_HOME, ANDROID_HOME: SDK,
  // The public app counts its viewers (2026-11-23, src/count.js); a dev APK doesn't.
  ...(PUBLIC ? { VITE_TRV_KEY: '', VITE_DATA_URL: `${SITE}/data/`, VITE_MAP_URL: `${SITE}/tiles/${mapName}`, VITE_COUNT_URL: `${SITE}/count/i.php` } : { VITE_COUNT_URL: '' }) };
const run = (cmd, cwd = '.') => execSync(cmd, { cwd, env, stdio: 'inherit' });
run('npx vite build');
if (PUBLIC) {
  const search = spawnSync(process.execPath, ['tools/key-search.mjs', 'dist'], { stdio: 'inherit' });
  if (search.status !== 0) { console.log('apk: stopped, the key search did not pass'); process.exit(1); }
}
run('npx cap sync android');
run(process.platform === 'win32' ? '.\\gradlew.bat assembleDebug' : './gradlew assembleDebug', 'android');
const apk = 'android/app/build/outputs/apk/debug/app-debug.apk';
const name = PUBLIC ? `sparat-${JSON.parse(readFileSync('package.json', 'utf8')).version}.apk` : 'sparat-dev.apk';
copyFileSync(apk, `dist/${name}`);
console.log(`\ndist/${name}: ${(statSync(apk).size / 1e6).toFixed(1)} MB${PUBLIC ? ` (no key; data and map from ${SITE})` : ''}`);
