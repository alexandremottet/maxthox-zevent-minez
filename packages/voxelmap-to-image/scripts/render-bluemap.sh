#!/usr/bin/env bash
# Renders a captured World Downloader save with BlueMap and publishes the
# result into both apps' public/bluemap folders.
#
# Usage: pnpm --filter voxelmap-to-image run bluemap [path/to/world/save]
# Defaults to save/minez.mathox1subs.fr if no path is given.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PACKAGE_DIR="$(dirname "$SCRIPT_DIR")"
REPO_ROOT="$(cd "$PACKAGE_DIR/../.." && pwd)"
CLI_DIR="$PACKAGE_DIR/bluemap-cli"
WORLD_SAVE="${1:-$PACKAGE_DIR/save/minez.mathox1subs.fr}"

if [ ! -d "$WORLD_SAVE" ]; then
  echo "world save not found: $WORLD_SAVE" >&2
  exit 1
fi
WORLD_SAVE="$(cd "$WORLD_SAVE" && pwd)"

JAR="$(find "$CLI_DIR" -maxdepth 1 -name 'bluemap-*-cli.jar' | sort -V | tail -n1)"
if [ -z "$JAR" ]; then
  echo "no bluemap-*-cli.jar found in $CLI_DIR — download one from https://github.com/BlueMap-Minecraft/BlueMap/releases" >&2
  exit 1
fi

if command -v /opt/homebrew/opt/openjdk@25/bin/java >/dev/null 2>&1; then
  export PATH="/opt/homebrew/opt/openjdk@25/bin:$PATH"
fi
if ! command -v java >/dev/null 2>&1; then
  echo "java not found — install it (e.g. brew install openjdk@25)" >&2
  exit 1
fi

MAP_CONFIG="$CLI_DIR/config/maps/overworld.conf"
# perl -i (not sed -i) since sed's in-place flag syntax differs between BSD
# (macOS, needs `-i ''`) and GNU (Linux/CI, needs `-i` with no argument) —
# perl's is identical on both
perl -i -pe "s|^world: .*|world: \"$WORLD_SAVE\"|" "$MAP_CONFIG"

# rewrites the marker-sets block from the current chunk POIs (map-render's
# checked-in poi-data.ts) so BlueMap shows the same level-colored chunk
# outlines as the Leaflet viewer
node "$SCRIPT_DIR/generate-bluemap-markers.mjs"

echo "rendering $WORLD_SAVE with $(basename "$JAR")..."
# -f (force) matters here: viewer/admin serve these files as plain static
# assets with no Content-Encoding support, so storage compression must stay
# "none" (see config/storages/file.conf) — force-render guarantees a config
# change like that actually rewrites existing tiles instead of being skipped
# as "already up to date". --markers applies the marker-sets config above.
(cd "$CLI_DIR" && java -jar "$(basename "$JAR")" -g -f -r --markers)

# stale .gz files from a render made before compression was set to "none" —
# storage never deletes them on its own when the format changes
find "$CLI_DIR/web/maps" -name '*.gz' -delete

# custom script referenced by webapp.conf's `scripts` list — not managed by
# BlueMap itself, so it has to be placed into the webroot on every publish
mkdir -p "$CLI_DIR/web/js"
cp "$SCRIPT_DIR/bluemap-default-view.js" "$CLI_DIR/web/js/default-view.js"

for app in voxelmap-viewer voxelmap-admin; do
  DEST="$REPO_ROOT/apps/$app/public/bluemap"
  rm -rf "$DEST"
  mkdir -p "$DEST"
  cp -R "$CLI_DIR/web/index.html" "$CLI_DIR/web/settings.json" "$CLI_DIR/web/assets" "$CLI_DIR/web/lang" "$CLI_DIR/web/maps" "$CLI_DIR/web/js" "$DEST/"
  echo "published to apps/$app/public/bluemap ($(du -sh "$DEST" | cut -f1))"
done
