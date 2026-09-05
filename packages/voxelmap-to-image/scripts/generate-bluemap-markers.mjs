// Translates every overlay already shown in the Leaflet viewer — level-colored
// chunk POIs (chunk-scanner), the percent-dug overlay (blockdata-scanner),
// and the remaining POI categories from the Filter panel (zone/startup/other)
// — into BlueMap marker-set config. Marker-set ids are named to match
// render.ts's categoryGroups keys EXACTLY (level names, "zone", "startup",
// "other") so the viewer's Filter panel can drive both the Leaflet layer and
// the matching BlueMap marker set from one shared checkbox (see map.ts's
// toggleCategory, which reaches into the iframe by this same id).
//
// Reads already-generated files (no MongoDB call, no new dependency):
// map-render's checked-in poi-data.ts, percent-data.ts, and levels.json.
// Writes the `marker-sets` block into bluemap-cli/config/maps/overworld.conf,
// replacing whatever was there — that block is always the last setting in
// the file (BlueMap's own default template ends with it), so this simply
// truncates from that line onward.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const packageDir = join(__dirname, "..");
const mapRenderSrc = join(packageDir, "..", "map-render", "src");
const overworldConfPath = join(packageDir, "bluemap-cli", "config", "maps", "overworld.conf");

const CHUNK_SIZE = 16;

function readGeneratedArray(path) {
  const content = readFileSync(path, "utf8");
  const start = content.indexOf("= [") + 2;
  const end = content.lastIndexOf("]") + 1;
  return JSON.parse(content.slice(start, end));
}

// covers the basic CSS keyword colors the admin dialog's free-text color
// field realistically gets used with (its placeholder is literally "red");
// anything else is expected to be entered as hex
const NAMED_COLORS = {
  red: "#ff0000",
  green: "#008000",
  blue: "#0000ff",
  yellow: "#ffff00",
  orange: "#ffa500",
  purple: "#800080",
  pink: "#ffc0cb",
  black: "#000000",
  white: "#ffffff",
  gray: "#808080",
  grey: "#808080",
  cyan: "#00ffff",
  magenta: "#ff00ff",
  lime: "#00ff00",
  brown: "#a52a2a",
};

function hexToRgb(color) {
  const hex = NAMED_COLORS[color.toLowerCase()] ?? color;
  const match = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!match) {
    console.warn(`unrecognized color "${color}", falling back to red`);
    return { r: 255, g: 0, b: 0 };
  }
  const [, r, g, b] = match;
  return { r: parseInt(r, 16), g: parseInt(g, 16), b: parseInt(b, 16) };
}

// mirrors map-render/src/percent.ts's percentColor (same hue/sat/light), so
// the BlueMap markers match the Leaflet overlay's colors exactly
function percentToRgb(percent) {
  const hue = (Math.max(0, Math.min(100, percent)) / 100) * 120;
  return hslToRgb(hue, 0.8, 0.45);
}

function hslToRgb(h, s, l) {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r1, g1, b1] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : [0, c, x];
  return { r: Math.round((r1 + m) * 255), g: Math.round((g1 + m) * 255), b: Math.round((b1 + m) * 255) };
}

function shapeMarker(x, z, label, { r, g, b }) {
  return rectMarker(x, z, x + CHUNK_SIZE, z + CHUNK_SIZE, label, { r, g, b });
}

// half-size (in blocks) of the small square drawn for a point POI — there's
// no BlueMap icon asset pipeline here, so point POIs get a small colored
// square instead of a pin icon, same "shape" marker as everything else
const POINT_MARKER_HALF_SIZE = 3;

function rectMarker(x1, z1, x2, z2, label, { r, g, b }) {
  const minX = Math.min(x1, x2);
  const maxX = Math.max(x1, x2);
  const minZ = Math.min(z1, z2);
  const maxZ = Math.max(z1, z2);
  return {
    type: "shape",
    label,
    position: { x: (minX + maxX) / 2, y: 64, z: (minZ + maxZ) / 2 },
    shape: [
      { x: minX, z: minZ },
      { x: maxX, z: minZ },
      { x: maxX, z: maxZ },
      { x: minX, z: maxZ },
    ],
    "shape-y": 64,
    "line-width": 2,
    "line-color": { r, g, b, a: 1.0 },
    "fill-color": { r, g, b, a: 0.5 },
    // most POIs sit on normal surface terrain well above y=64 (only dug-out
    // chunks are actually near sea level) — without this, BlueMap depth-tests
    // the marker against real terrain and it renders invisible, occluded
    // underground
    "depth-test": false,
  };
}

function pointMarker(x, z, label, color) {
  return rectMarker(x - POINT_MARKER_HALF_SIZE, z - POINT_MARKER_HALF_SIZE, x + POINT_MARKER_HALF_SIZE, z + POINT_MARKER_HALF_SIZE, label, color);
}

const levels = JSON.parse(readFileSync(join(mapRenderSrc, "levels.json"), "utf8"));
const levelColor = new Map(levels.map((level) => [level.name, level.color]));

const DEFAULT_POI_COLOR = "red";

const pois = readGeneratedArray(join(mapRenderSrc, "poi-data.ts"));
const chunkPois = pois.filter((poi) => poi.type === "chunk" && levelColor.has(poi.level));

const chunkMarkersByLevel = new Map(levels.map((level) => [level.name, {}]));
for (const { x, y: z, level } of chunkPois) {
  chunkMarkersByLevel.get(level)[`chunk_${x}_${z}`] = shapeMarker(x, z, level, hexToRgb(levelColor.get(level)));
}

const chunkPercents = readGeneratedArray(join(mapRenderSrc, "percent-data.ts"));
const percentMarkers = {};
for (const { x, z, percent } of chunkPercents) {
  percentMarkers[`percent_${x}_${z}`] = shapeMarker(x, z, `${percent.toFixed(0)}%`, percentToRgb(percent));
}

// mirrors render.ts's category split for everything that isn't a chunk POI:
// zones, "startup" points, and plain ("other") points
const zoneMarkers = {};
const startupMarkers = {};
const otherMarkers = {};
let index = 0;
for (const poi of pois) {
  if (poi.type === "chunk") continue;
  index++;
  const color = hexToRgb(poi.color ?? DEFAULT_POI_COLOR);

  if ("x1" in poi) {
    zoneMarkers[`zone_${index}`] = rectMarker(poi.x1, poi.y1, poi.x2, poi.y2, poi.title ?? "zone", color);
  } else if (poi.type === "startup") {
    startupMarkers[`startup_${index}`] = pointMarker(poi.x, poi.y, poi.title ?? "startup", color);
  } else {
    otherMarkers[`other_${index}`] = pointMarker(poi.x, poi.y, poi.title ?? "POI", color);
  }
}

const markerSets = {};
for (const level of levels) {
  markerSets[level.name] = {
    label: `${level.name} chunk`,
    toggleable: true,
    "default-hidden": false,
    markers: chunkMarkersByLevel.get(level.name),
  };
}
markerSets.chunkPercent = {
  label: "Percent (beta)",
  toggleable: true,
  "default-hidden": true,
  markers: percentMarkers,
};
markerSets.zone = {
  label: "Zone POI",
  toggleable: true,
  "default-hidden": false,
  markers: zoneMarkers,
};
markerSets.startup = {
  label: "Startup POI",
  toggleable: true,
  "default-hidden": false,
  markers: startupMarkers,
};
markerSets.other = {
  label: "Other POI",
  toggleable: true,
  "default-hidden": false,
  markers: otherMarkers,
};

const conf = readFileSync(overworldConfPath, "utf8");
const markerSetsLine = conf.indexOf("marker-sets:");
if (markerSetsLine === -1) throw new Error(`could not find "marker-sets:" in ${overworldConfPath}`);

const truncated = conf.slice(0, markerSetsLine);
writeFileSync(overworldConfPath, `${truncated}marker-sets: ${JSON.stringify(markerSets, null, 2)}\n`);

console.log(
  `wrote ${chunkPois.length} chunk, ${chunkPercents.length} percent, ${Object.keys(zoneMarkers).length} zone, ` +
    `${Object.keys(startupMarkers).length} startup, ${Object.keys(otherMarkers).length} other marker(s) to ${overworldConfPath}`,
);
