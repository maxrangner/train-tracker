#!/bin/sh
# A trial of Spårat's fetcher on a Linux computer (public-plan step 2): checks Node (fetches Node 26.13.0 into this
# folder if the computer has none or an old one; nothing is installed system-wide), installs the fetcher's parts,
# runs the replay check on the recording in data/, then 10 live minutes (no uploads). Prints what it finds.
# Run from the unpacked folder:  sh fetcher/trial.sh
set -e
cd "$(dirname "$0")/.."
echo "== this computer"
uname -srm
grep -E '^(PRETTY_NAME)=' /etc/os-release 2>/dev/null || true

NODE=node; NPM=npm
major=$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)
if [ "$major" -lt 22 ]; then
  case "$(uname -m)" in x86_64) A=x64 ;; aarch64|arm64) A=arm64 ;; *) echo "unknown processor $(uname -m)"; exit 1 ;; esac
  V=v26.13.0
  echo "== Node: none or older than 22 here; getting Node $V ($A) into this folder only"
  curl -fsSL "https://nodejs.org/dist/$V/node-$V-linux-$A.tar.xz" | tar -xJ
  PATH="$PWD/node-$V-linux-$A/bin:$PATH"; export PATH
fi
echo "== Node $(node -v), npm $(npm -v)"

echo "== installing the fetcher's parts"
npm ci --omit=dev --no-audit --no-fund --loglevel=error

echo "== replay check (no key, no internet)"
node tools/fetcher-check.mjs 2026-11-11T21-45-41-004Z

echo "== 10 live minutes (no uploads)"
if [ -z "$TRV_KEY" ]; then
  printf 'Paste the Trafikverket key (D:\\dev\\train-map\\.env on the Windows PC, after VITE_TRV_KEY=), then Enter: '
  stty -echo 2>/dev/null || true; read -r TRV_KEY; stty echo 2>/dev/null || true; echo
fi
export TRV_KEY
node fetcher/main.mjs --env /nonexistent --serve 8090 --minutes 10
echo "== done: paste everything above back to Claude"
