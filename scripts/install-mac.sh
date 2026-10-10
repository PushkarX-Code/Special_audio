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

TMP=$(mktemp -d)
MOUNT="$TMP/mount"
cleanup() { hdiutil detach "$MOUNT" -quiet 2>/dev/null || true; rm -rf "$TMP"; }
trap cleanup EXIT

# Newest release under its fixed name. No GitHub API call, so no rate limit.
URL="https://github.com/$REPO/releases/latest/download/Special-Audio-mac.dmg"
say "Downloading the latest Special Audio..."
if ! curl -fL --progress-bar -o "$TMP/app.dmg" "$URL"; then
  # Older releases only have the versioned file name: read the version from the
  # /releases/latest redirect (…/tag/v1.2.3) and build that name.
  TAG=$(curl -fsSL -o /dev/null -w '%{url_effective}' "https://github.com/$REPO/releases/latest" | sed 's#.*/tag/##')
  [ -n "$TAG" ] && [ "$TAG" != "${TAG#v}" ] || fail "Could not find the Mac download. Check https://github.com/$REPO/releases"
  URL="https://github.com/$REPO/releases/download/$TAG/Special.Audio_${TAG#v}_universal.dmg"
  curl -fL --progress-bar -o "$TMP/app.dmg" "$URL" || fail "Download failed: $URL"
fi

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
