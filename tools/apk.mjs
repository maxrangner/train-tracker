// The Android dev app (2026-11-16): npm run apk. Builds the page (vite build → dist/), copies it into the Android project
// (npx cap sync), builds a debug APK with Gradle, and puts it at dist/sparat-dev.apk (so the phone server, port 4173,
// offers it: http://<PC>:4173/sparat-dev.apk). The app is the same page inside Android's built-in browser; it reads
// Trafikverket and the map tiles itself, so it works on mobile data. The key is inside it, as in dist/: never share it.
// Needs: Java 17 (JAVA_HOME, or the Temurin 17 in %LOCALAPPDATA%\Programs\Java), the Android SDK
// (ANDROID_HOME, or %LOCALAPPDATA%\Android\Sdk). The first build downloads Gradle and Android's build parts.
import { execSync } from 'node:child_process';
import { copyFileSync, existsSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const local = process.env.LOCALAPPDATA ?? '';
const javaDir = join(local, 'Programs', 'Java');
const JAVA_HOME = process.env.JAVA_HOME
  ?? (existsSync(javaDir) ? readdirSync(javaDir).filter(d => d.startsWith('jdk-17')).map(d => join(javaDir, d))[0] : undefined);
const SDK = process.env.ANDROID_HOME ?? join(local, 'Android', 'Sdk');
if (!JAVA_HOME || !existsSync(JAVA_HOME)) throw new Error('No Java 17 found: set JAVA_HOME');
if (!existsSync(SDK)) throw new Error('No Android SDK found: set ANDROID_HOME');
writeFileSync('android/local.properties', `sdk.dir=${SDK.replaceAll('\\', '/')}\n`);   // git ignores it

const env = { ...process.env, JAVA_HOME, ANDROID_HOME: SDK };
const run = (cmd, cwd = '.') => execSync(cmd, { cwd, env, stdio: 'inherit' });
run('npx vite build');
run('npx cap sync android');
run(process.platform === 'win32' ? '.\\gradlew.bat assembleDebug' : './gradlew assembleDebug', 'android');
const apk = 'android/app/build/outputs/apk/debug/app-debug.apk';
copyFileSync(apk, 'dist/sparat-dev.apk');
console.log(`\ndist/sparat-dev.apk: ${(statSync(apk).size / 1e6).toFixed(1)} MB`);
