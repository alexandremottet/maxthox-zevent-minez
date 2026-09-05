import L from "leaflet";
import { toLatLng, CHUNK_SIZE } from "./render.ts";

// a chunk's percentage of air blocks within blockdata-scanner's Y range —
// a more precise alternative to the level-based (surface-height) classification.
// Kept fully separate: does not touch CHUNK_LEVELS, categoryGroups, or renderPois.
export interface ChunkPercent {
  x: number;
  z: number;
  percent: number;
}

// red (0% dug) -> green (100% dug), via HSL hue
export function percentColor(percent: number): string {
  const hue = (Math.max(0, Math.min(100, percent)) / 100) * 120;
  return `hsl(${hue}, 80%, 45%)`;
}

// draws one flat rectangle per chunk, colored by percentColor, with a
// permanent tooltip showing the percentage. Returns the group without adding
// it to the map — the caller controls visibility (e.g. a HUD toggle).
export function renderChunkPercents(map: L.Map, data: ChunkPercent[]): L.LayerGroup {
  const group = L.layerGroup();

  for (const { x, z, percent } of data) {
    const corner1 = toLatLng(x, z);
    const corner2 = toLatLng(x + CHUNK_SIZE, z + CHUNK_SIZE);
    const color = percentColor(percent);
    const rectangle = L.rectangle([corner1, corner2], { color, weight: 1, fillColor: color, fillOpacity: 0.5 }).addTo(group);
    rectangle.bindTooltip(`${percent.toFixed(0)}%`, { permanent: true, direction: "center", className: "poi-chunk-level" });
  }

  return group;
}
