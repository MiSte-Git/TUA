#!/usr/bin/env bash
# Installiert das mit build_linux.sh gebaute Binary lokal (ohne root-Rechte,
# unter ~/.local/share/tua/) und richtet einen Desktop-Eintrag ein, der auf
# dieses installierte Binary zeigt - statt es jedesmal per
# `npm run tauri dev` aus dem Checkout heraus zu starten. Analog zu
# install_linux.sh im TME-Projekt (dort PyInstaller-Binary statt Cargo-Binary,
# sonst gleiches Vorgehen: kein root, Versionsstempel-Check gegen einen
# veralteten Stand, eigener Desktop-Eintrag).
#
# Nutzung:
#   ./install_linux.sh          # baut bei Bedarf neu (Binary fehlt oder ist
#                                 # nicht auf dem aktuellen Codestand, siehe
#                                 # src-tauri/target/release/BUILD_VERSION.txt)
#                                 # und installiert
#   ./install_linux.sh --clean  # erzwingt vorher einen --clean-Build
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$REPO_ROOT"

BUILD_ARGS=()
for arg in "$@"; do
  case "$arg" in
    --clean) BUILD_ARGS+=(--clean) ;;
    *) echo "Unbekannte Option: $arg (bekannt: --clean)" >&2; exit 1 ;;
  esac
done

INSTALL_DIR="$HOME/.local/share/tua"
BIN_PATH="$REPO_ROOT/src-tauri/target/release/telegram-user-activities"
VERSION_FILE="$REPO_ROOT/src-tauri/target/release/BUILD_VERSION.txt"

current_version() {
  local hash dirty
  hash="$(git -C "$REPO_ROOT" rev-parse --short HEAD 2>/dev/null || echo unknown)"
  dirty=""
  if [ -n "$(git -C "$REPO_ROOT" status --porcelain 2>/dev/null)" ]; then
    dirty="-dirty"
  fi
  echo "${hash}${dirty}"
}

dist_version() {
  if [ -f "$VERSION_FILE" ]; then
    grep -m1 '^commit=' "$VERSION_FILE" | cut -d= -f2-
  fi
}

CUR_VERSION="$(current_version)"
DIST_VERSION="$(dist_version)"

if [ ! -f "$BIN_PATH" ] || [ -z "$DIST_VERSION" ] || [ "$DIST_VERSION" != "$CUR_VERSION" ]; then
  echo "Kein aktuelles Build gefunden (installierte Build-Version: ${DIST_VERSION:-keine}, aktueller Codestand: ${CUR_VERSION}) - baue neu..."
  "$REPO_ROOT/build_linux.sh" "${BUILD_ARGS[@]}"
  DIST_VERSION="$(dist_version)"
fi

mkdir -p "$INSTALL_DIR"

echo "Kopiere Binary nach $INSTALL_DIR ..."
cp "$BIN_PATH" "$INSTALL_DIR/telegram-user-activities"
chmod +x "$INSTALL_DIR/telegram-user-activities"
[ -f "$VERSION_FILE" ] && cp "$VERSION_FILE" "$INSTALL_DIR/BUILD_VERSION.txt"

# Icon mit an den Zielort kopieren, damit der Desktop-Eintrag auch funktioniert,
# wenn das Repo-Checkout spaeter geloescht/verschoben wird.
ICON_SRC="$REPO_ROOT/src-tauri/icons/128x128@2x.png"
if [ -f "$ICON_SRC" ]; then
  cp "$ICON_SRC" "$INSTALL_DIR/icon.png"
fi

echo "Installiert nach: $INSTALL_DIR/telegram-user-activities (Version: ${DIST_VERSION:-unbekannt})"

APPLICATIONS_DIR="$HOME/.local/share/applications"
mkdir -p "$APPLICATIONS_DIR"
DESKTOP_FILE="$APPLICATIONS_DIR/tua.desktop"

ICON_LINE="Icon=$INSTALL_DIR/icon.png"
if [ ! -f "$INSTALL_DIR/icon.png" ]; then
  ICON_LINE="Icon=telegram-user-activities"
fi

cat > "$DESKTOP_FILE" <<EOF
[Desktop Entry]
Type=Application
Name=Telegram User Activities
Comment=Telegram-Chat-Aktivitaeten analysieren und exportieren
Exec="$INSTALL_DIR/telegram-user-activities"
Path=$INSTALL_DIR
$ICON_LINE
StartupWMClass=telegram-user-activities
Categories=Network;Utility;
Terminal=false
EOF
chmod +x "$DESKTOP_FILE"

echo "Desktop-Eintrag angelegt/aktualisiert: $DESKTOP_FILE"
echo "Anwendungsmenü öffnen, 'Telegram User Activities' suchen und von dort an Taskleiste/Dock anheften."
echo
echo "Deinstallieren: rm -f '$DESKTOP_FILE' && rm -rf '$INSTALL_DIR'"
