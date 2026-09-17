#!/usr/bin/env bash
# Produktiv-Build unter Linux: baut das eigenstaendige Tauri-Binary (Rust,
# mit eingebettetem Frontend) via `npm run tauri build`. Analog zu
# build_linux.sh im "Telegram Nachrichten kopieren"-Projekt (TME), aber ohne
# PyInstaller/separate Build-venv - Cargo erzeugt hier bereits ein einzelnes
# natives Binary mit eingebettetem Frontend, kein zusaetzlicher Bundling-
# Schritt noetig.
#
# Aendert NICHTS an der bestehenden GitHub-Actions-Release-Pipeline/dem
# Auto-Updater (siehe .github/) - das hier ist nur ein lokales
# Build+Install-Paar fuer den eigenen Rechner, analog zu TME.
#
# Nutzung:
#   ./build_linux.sh          # baut (npm ci falls node_modules fehlt) + Versionsstempel
#   ./build_linux.sh --clean  # cargo clean vorher (voller Neubau)
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$REPO_ROOT"

FORCE_CLEAN=0
for arg in "$@"; do
  case "$arg" in
    --clean) FORCE_CLEAN=1 ;;
    *) echo "Unbekannte Option: $arg (bekannt: --clean)" >&2; exit 1 ;;
  esac
done

if [ ! -d node_modules ]; then
  echo "Installiere npm-Abhaengigkeiten..."
  npm ci
fi

if [ "$FORCE_CLEAN" -eq 1 ]; then
  echo "cargo clean (--clean gesetzt)..."
  (cd src-tauri && cargo clean)
fi

echo "Baue Release-Binary via 'npm run tauri build' (Frontend + Rust)..."
npm run tauri build

BIN="$REPO_ROOT/src-tauri/target/release/telegram-user-activities"
if [ ! -f "$BIN" ]; then
  echo "FEHLER: Erwartetes Binary nicht gefunden: $BIN" >&2
  exit 1
fi

# Versionsstempel (Commit-Hash + dirty-Flag), analog TMEs dist/BUILD_VERSION.txt -
# install_linux.sh nutzt das, um ein veraltetes Binary nicht stillschweigend
# zu installieren.
hash="$(git -C "$REPO_ROOT" rev-parse --short HEAD 2>/dev/null || echo unknown)"
dirty=""
if [ -n "$(git -C "$REPO_ROOT" status --porcelain 2>/dev/null)" ]; then
  dirty="-dirty"
fi
echo "commit=${hash}${dirty}" > "$REPO_ROOT/src-tauri/target/release/BUILD_VERSION.txt"

echo "Fertig: $BIN (Version: ${hash}${dirty})"
