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

# most of a WDL capture is surface terrain the player just walked through,
# unrelated to the mining challenge — dropping whole region files (32x32
# chunks each) with nothing near a mine-level chunk POI shrinks both the
# render time and the resulting tile output. On by default; override with
# BLUEMAP_PRUNE_RADIUS.
PRUNED_SAVE="$PACKAGE_DIR/.bluemap-pruned-save"
node "$SCRIPT_DIR/prune-world-save.mjs" --input "$WORLD_SAVE" --output "$PRUNED_SAVE" --radius "${BLUEMAP_PRUNE_RADIUS:-5}"
WORLD_SAVE="$PRUNED_SAVE"

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
WEBAPP_CONFIG="$CLI_DIR/config/webapp.conf"
# perl -i (not sed -i) since sed's in-place flag syntax differs between BSD
# (macOS, needs `-i ''`) and GNU (Linux/CI, needs `-i` with no argument) —
# perl's is identical on both
perl -i -pe "s|^world: .*|world: \"$WORLD_SAVE\"|" "$MAP_CONFIG"

# tile data (web/maps) is huge — point the webapp at an R2 bucket instead of
# serving it same-origin, when R2 creds are provided. index.html/js/css stay
# same-origin either way, which is what apps/voxelmap-viewer's iframe
# reach-in for live coords/markers actually depends on.
if [ -n "${R2_PUBLIC_URL:-}" ]; then
  perl -i -pe "s|^#?\s*map-data-root:.*|map-data-root: \"$R2_PUBLIC_URL/mapdata\"|; \
               s|^#?\s*live-data-root:.*|live-data-root: \"$R2_PUBLIC_URL/mapdata\"|" \
    "$WEBAPP_CONFIG"
fi

# rewrites the marker-sets block from the current chunk POIs (map-render's
# checked-in poi-data.ts) so BlueMap shows the same level-colored chunk
# outlines as the Leaflet viewer
node "$SCRIPT_DIR/generate-bluemap-markers.mjs"

# BlueMap's `-r` (without `-f`) only re-renders regions whose chunks changed
# since the last render — it detects this from render-state it keeps inside
# web/maps itself. CI checks out a fresh runner every time though, so without
# seeding web/maps from what's already on R2 first, there's nothing to diff
# against and every region "changes" (a ~20min full render every run).
if [ -n "${R2_PUBLIC_URL:-}" ] && [ -n "${R2_BUCKET:-}" ] && [ -n "${R2_ENDPOINT:-}" ]; then
  echo "seeding web/maps from R2 for incremental render..."
  mkdir -p "$CLI_DIR/web/maps"
  aws s3 sync "s3://$R2_BUCKET/mapdata" "$CLI_DIR/web/maps" --endpoint-url "$R2_ENDPOINT"
else
  # storage compression must stay "none" (config/storages/file.conf) — this
  # stack's static servers (Vite dev/preview, and likely Vercel/GH Pages too)
  # auto-add Content-Encoding: gzip for .gz-suffixed files and decompress
  # transparently, which breaks webapp.conf's client-decompression (it then
  # tries to gzip-decompress the already-decompressed body a second time).
  # Wiping web/maps first (rather than relying on -f alone) avoids stale
  # cross-format leftovers if this ever ran with a different compression setting.
  rm -rf "$CLI_DIR/web/maps"
fi
echo "rendering $WORLD_SAVE with $(basename "$JAR")..."
(cd "$CLI_DIR" && java -jar "$(basename "$JAR")" -g -r --markers)

# custom script/style referenced by webapp.conf's `scripts`/`styles` lists —
# not managed by BlueMap itself, so they have to be placed into the webroot
# on every publish
mkdir -p "$CLI_DIR/web/js" "$CLI_DIR/web/css"
cp "$SCRIPT_DIR/bluemap-default-view.js" "$CLI_DIR/web/js/default-view.js"
cp "$SCRIPT_DIR/bluemap-percent-label.css" "$CLI_DIR/web/css/percent-label.css"

# when R2 is configured, webapp.conf's map-data-root already points there —
# skipping the "maps" copy is what actually shrinks the GitHub Pages
# artifact. Without R2 creds (plain local dev), map-data-root stays the
# default relative "maps", so it still needs to be copied locally.
for app in voxelmap-viewer voxelmap-admin; do
  DEST="$REPO_ROOT/apps/$app/public/bluemap"
  rm -rf "$DEST"
  mkdir -p "$DEST"
  cp -R "$CLI_DIR/web/index.html" "$CLI_DIR/web/settings.json" "$CLI_DIR/web/assets" "$CLI_DIR/web/lang" "$CLI_DIR/web/js" "$CLI_DIR/web/css" "$DEST/"
  if [ -z "${R2_PUBLIC_URL:-}" ]; then
    cp -R "$CLI_DIR/web/maps" "$DEST/"
  fi
  echo "published to apps/$app/public/bluemap ($(du -sh "$DEST" | cut -f1))"
done

if [ -n "${R2_PUBLIC_URL:-}" ] && [ -n "${R2_BUCKET:-}" ] && [ -n "${R2_ENDPOINT:-}" ]; then
  echo "syncing tiles to R2 ($R2_BUCKET)..."
  aws s3 sync "$CLI_DIR/web/maps" "s3://$R2_BUCKET/mapdata" \
    --endpoint-url "$R2_ENDPOINT" --delete
  echo "synced to $R2_PUBLIC_URL/mapdata"
fi
