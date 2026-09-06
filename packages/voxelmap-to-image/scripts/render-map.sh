#!/usr/bin/env bash
# Renders the flat surface PNG + heightmap from the VoxelMap region cache.
# Opt-in crop: set VOXELMAP_PRUNE_RADIUS to drop cache regions with nothing
# within that many chunks of a mine-level chunk POI, same idea as
# render-bluemap.sh's BLUEMAP_PRUNE_RADIUS.
#
# Usage: pnpm --filter voxelmap-to-image run map
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PACKAGE_DIR="$(dirname "$SCRIPT_DIR")"
INPUT="$PACKAGE_DIR/data/overworld"

if [ -n "${VOXELMAP_PRUNE_RADIUS:-}" ]; then
  PRUNED_CACHE="$PACKAGE_DIR/.voxelmap-pruned-cache"
  node "$SCRIPT_DIR/prune-voxelmap-cache.mjs" --input "$INPUT" --output "$PRUNED_CACHE" --radius "$VOXELMAP_PRUNE_RADIUS"
  INPUT="$PRUNED_CACHE"
fi

(cd "$PACKAGE_DIR" && tsx src/index.ts --input "$INPUT" --output out --scale 16)
