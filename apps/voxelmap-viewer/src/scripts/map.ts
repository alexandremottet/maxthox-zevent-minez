import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "@south-paw/typeface-minecraft";
import { mapDataUrl, mapHeight, mapWidth } from "../map-data.ts";
import { isZone, pois } from "../data/poi.ts";

// permissive range so getBoundsZoom below isn't clamped to Leaflet's default 0..18
const map = L.map("map", { crs: L.CRS.Simple, minZoom: -20, maxZoom: 20, zoomControl: false });

const bounds: L.LatLngBoundsExpression = [
  [0, 0],
  [mapHeight, mapWidth],
];

L.imageOverlay(mapDataUrl, bounds).addTo(map);

// can't zoom out past seeing the whole map, can zoom in up to 8x beyond that
const fitZoom = map.getBoundsZoom(bounds, true);
map.setMinZoom(fitZoom);
map.setMaxZoom(fitZoom + 2);
map.fitBounds(bounds);

const zoomInButton = document.getElementById("zoom-in") as HTMLButtonElement;
const zoomOutButton = document.getElementById("zoom-out") as HTMLButtonElement;
const zoomFitButton = document.getElementById("zoom-fit") as HTMLButtonElement;

zoomInButton.addEventListener("click", () => map.zoomIn());
zoomOutButton.addEventListener("click", () => map.zoomOut());
zoomFitButton.addEventListener("click", () => map.fitBounds(bounds));

function updateZoomButtons() {
  zoomInButton.disabled = map.getZoom() >= map.getMaxZoom();
  zoomOutButton.disabled = map.getZoom() <= map.getMinZoom();
}

map.on("zoomend", updateZoomButtons);
updateZoomButtons();

(window as unknown as { __map: L.Map }).__map = map;

function createPopupContent(title: string, description?: string): HTMLElement {
  const container = document.createElement("div");
  container.className = "poi-popup";

  const titleEl = document.createElement("div");
  titleEl.className = "minecraft-green poi-popup-title";
  titleEl.textContent = title;
  container.append(titleEl);

  if (description) {
    const descEl = document.createElement("div");
    descEl.className = "minecraft-white poi-popup-desc";
    descEl.textContent = description;
    container.append(descEl);
  }

  return container;
}

const DEFAULT_POI_COLOR = "red";
const poiIcon = L.divIcon({ className: "poi-marker-icon", iconSize: [12, 12] });

// poi.json coordinates are Minecraft world x/z; world (0, 0) sits at this
// pixel in the generated map image (measured at MAP_SCALE)
const WORLD_ORIGIN_PIXEL_X = 4100;
const WORLD_ORIGIN_PIXEL_Y = 4100;

// must match the --scale used to generate out/map.png (voxelmap-to-image):
// 1 world block covers MAP_SCALE x MAP_SCALE pixels in the embedded image
const MAP_SCALE = 16;

// lat=0 is the screen's bottom edge (north-up convention), but image pixel y=0
// means "top row of the image", so the y axis has to be flipped
function toLatLng(worldX: number, worldZ: number): L.LatLngTuple {
  const pixelX = worldX * MAP_SCALE + WORLD_ORIGIN_PIXEL_X;
  const pixelY = worldZ * MAP_SCALE + WORLD_ORIGIN_PIXEL_Y;
  return [mapHeight - pixelY, pixelX];
}

const SHINE_GRADIENT_ID = "poi-shine-gradient";

// zones render as SVG <path>, so the div-based ::after shine used for point
// markers doesn't apply; build an equivalent animated SVG gradient and use it
// as the rectangle's fill instead
function ensureShineGradient(): void {
  const svg = map.getPane("overlayPane")?.querySelector("svg");
  if (!svg || svg.querySelector(`#${SHINE_GRADIENT_ID}`)) return;

  const ns = "http://www.w3.org/2000/svg";
  const gradient = document.createElementNS(ns, "linearGradient");
  gradient.setAttribute("id", SHINE_GRADIENT_ID);
  gradient.setAttribute("gradientUnits", "objectBoundingBox");
  gradient.setAttribute("x1", "-0.5");
  gradient.setAttribute("y1", "-0.5");
  gradient.setAttribute("x2", "0.5");
  gradient.setAttribute("y2", "0.5");

  for (const [offset, color, opacity] of [
    ["0%", "#fff", 0.5],
    ["40%", "#fff", 0.5],
    ["50%", "#55ff55", 0.9],
    ["60%", "#fff", 0.5],
    ["100%", "#fff", 0.5],
  ] as const) {
    const stop = document.createElementNS(ns, "stop");
    stop.setAttribute("offset", offset);
    stop.setAttribute("stop-color", color);
    stop.setAttribute("stop-opacity", String(opacity));
    gradient.appendChild(stop);
  }

  const animate = document.createElementNS(ns, "animateTransform");
  animate.setAttribute("attributeName", "gradientTransform");
  animate.setAttribute("type", "translate");
  animate.setAttribute("values", "-1 -1; 1 1");
  animate.setAttribute("dur", "2s");
  animate.setAttribute("repeatCount", "indefinite");
  gradient.appendChild(animate);

  const defs = document.createElementNS(ns, "defs");
  defs.appendChild(gradient);
  svg.prepend(defs);
}

// draws a diagonal as a staircase of small blocky squares instead of a
// smooth anti-aliased line, matching the flat-pixel look of the rest of the map
const CROSS_STEPS = 16;

function drawPixelDiagonal(latA: number, lngA: number, latB: number, lngB: number, color: string): void {
  const dLat = (latB - latA) / CROSS_STEPS;
  const dLng = (lngB - lngA) / CROSS_STEPS;
  for (let i = 0; i < CROSS_STEPS; i++) {
    L.rectangle(
      [
        [latA + dLat * i, lngA + dLng * i],
        [latA + dLat * (i + 1), lngA + dLng * (i + 1)],
      ],
      { stroke: false, fillColor: color, fillOpacity: 1, interactive: false },
    ).addTo(map);
  }
}

// two beams crossing corner-to-corner, one bright and one darker, for a
// pseudo-3D "woven" look
function drawChunkCross(corner1: L.LatLngTuple, corner2: L.LatLngTuple): void {
  const [lat1, lng1] = corner1;
  const [lat2, lng2] = corner2;

  // darker beam drawn first (underneath), brighter beam second (on top)
  drawPixelDiagonal(lat1, lng2, lat2, lng1, "#800000");
  drawPixelDiagonal(lat1, lng1, lat2, lng2, "#ff0000");
}

// one Minecraft chunk = 16x16 blocks
const CHUNK_SIZE = 16;

function drawZone(
  corner1: L.LatLngTuple,
  corner2: L.LatLngTuple,
  color: string,
  isChunk: boolean,
  popupContent: HTMLElement | undefined,
): void {
  // fill:false would leave only the 2px border clickable (SVG doesn't
  // hit-test a fill:none shape's interior), so keep an invisible fill instead
  const rectangle = L.rectangle([corner1, corner2], {
    color,
    weight: 2,
    fillColor: isChunk ? "#000" : `url(#${SHINE_GRADIENT_ID})`,
    fillOpacity: isChunk ? 0 : 1,
  }).addTo(map);
  if (popupContent) rectangle.bindPopup(popupContent);

  if (isChunk) {
    drawChunkCross(corner1, corner2);
  } else {
    ensureShineGradient();
  }
}

for (const poi of pois) {
  const popupContent = poi.title ? createPopupContent(poi.title, poi.description) : undefined;
  const color = poi.color ?? DEFAULT_POI_COLOR;
  const isChunk = poi.type === "chunk";

  if (isZone(poi)) {
    drawZone(toLatLng(poi.x1, poi.y1), toLatLng(poi.x2, poi.y2), color, isChunk, popupContent);
  } else if (isChunk) {
    // (x, y) is the chunk's origin corner; expand to the full 16x16 block zone
    drawZone(
      toLatLng(poi.x, poi.y),
      toLatLng(poi.x + CHUNK_SIZE, poi.y + CHUNK_SIZE),
      color,
      true,
      popupContent,
    );
  } else {
    const marker = L.marker(toLatLng(poi.x, poi.y), { icon: poiIcon }).addTo(map);
    if (popupContent) marker.bindPopup(popupContent);
    marker.getElement()?.style.setProperty("border-color", color);
  }
}
