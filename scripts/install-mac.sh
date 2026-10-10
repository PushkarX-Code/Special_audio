#!/bin/bash
# Installs (or updates) Special Audio on macOS from the latest GitHub release.
#
#   curl -fsSL https://raw.githubusercontent.com/PushkarX-Code/Special_audio/main/scripts/install-mac.sh | bash
#
# Files downloaded with curl are not marked "downloaded from the internet", so macOS
# opens the app without the unsigned-developer block. Nothing else on the system changes.
set -euo pipefail

REPO="PushkarX-Code/Special_audio"
APP="Special Audio.app"
DEST="/Applications"

say() { printf '\033[1m%s\033[0m\n' "$*"; }
fail() { printf '\033[31m%s\033[0m\n' "$*" >&2; exit 1; }

[ "$(uname -s)" = "Darwin" ] || fail "This installer is for macOS."

say "Finding the latest Special Audio release..."
URL=$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" \
  | grep -o '"browser_download_url": *"[^"]*universal\.dmg"' \
  | head -1 | sed 's/.*"\(https[^"]*\)"/\1/')
[ -n "$URL" ] || fail "Could not find the Mac download. Check https://github.com/$REPO/releases"

TMP=$(mktemp -d)
MOUNT="$TMP/mount"
cleanup() { hdiutil detach "$MOUNT" -quiet 2>/dev/null || true; rm -rf "$TMP"; }
trap cleanup EXIT

say "Downloading $(basename "$URL")..."
curl -fL --progress-bar -o "$TMP/app.dmg" "$URL"

say "Installing to $DEST..."
mkdir -p "$MOUNT"
hdiutil attach "$TMP/app.dmg" -nobrowse -quiet -mountpoint "$MOUNT"
[ -d "$MOUNT/$APP" ] || fail "The download did not contain $APP."

osascript -e 'quit app "Special Audio"' >/dev/null 2>&1 || true
SUDO=""
[ -w "$DEST" ] || SUDO="sudo"
$SUDO rm -rf "$DEST/$APP"
$SUDO cp -R "$MOUNT/$APP" "$DEST/"
# Clear the quarantine flag in case an older copy was downloaded through a browser.
$SUDO xattr -cr "$DEST/$APP" 2>/dev/null || true

say "Done. Opening Special Audio..."
open "$DEST/$APP"
