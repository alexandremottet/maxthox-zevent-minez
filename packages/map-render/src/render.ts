import L from "leaflet";
import { isZone, type PointOfInterest } from "./poi.ts";

// must match the --scale used to generate out/map.png (voxelmap-to-image):
// 1 world block covers MAP_SCALE x MAP_SCALE pixels in the embedded image
export const MAP_SCALE = 16;

// poi.json coordinates are Minecraft world x/z; world (0, 0) sits at this
// pixel in the generated map image (measured at MAP_SCALE)
export const WORLD_ORIGIN_PIXEL_X = 4100;
export const WORLD_ORIGIN_PIXEL_Y = 4100;

// one Minecraft chunk = 16x16 blocks
export const CHUNK_SIZE = 16;

const DEFAULT_POI_COLOR = "red";
const SHINE_GRADIENT_ID = "poi-shine-gradient";
const CROSS_STEPS = 16;

// lat=0 is the screen's bottom edge (north-up convention), but image pixel y=0
// means "top row of the image", so the y axis has to be flipped
export function toLatLng(mapHeight: number, worldX: number, worldZ: number): L.LatLngTuple {
  const pixelX = worldX * MAP_SCALE + WORLD_ORIGIN_PIXEL_X;
  const pixelY = worldZ * MAP_SCALE + WORLD_ORIGIN_PIXEL_Y;
  return [mapHeight - pixelY, pixelX];
}

// inverse of toLatLng — used by the admin to turn a map click back into world x/z
export function fromLatLng(mapHeight: number, lat: number, lng: number): { x: number; y: number } {
  const pixelX = lng;
  const pixelY = mapHeight - lat;
  return {
    x: (pixelX - WORLD_ORIGIN_PIXEL_X) / MAP_SCALE,
    y: (pixelY - WORLD_ORIGIN_PIXEL_Y) / MAP_SCALE,
  };
}

export function createPopupContent(title: string, description?: string): HTMLElement {
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

// zones render as SVG <path>, so a div-based ::after shine can't apply to them;
// build an equivalent animated SVG gradient and use it as the rectangle's fill
function ensureShineGradient(map: L.Map): void {
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

// draws a diagonal as a staircase of small blocky squares instead of a smooth
// anti-aliased line, matching the flat-pixel look of the rest of the map
function drawPixelDiagonal(
  target: L.LayerGroup,
  latA: number,
  lngA: number,
  latB: number,
  lngB: number,
  color: string,
): void {
  const dLat = (latB - latA) / CROSS_STEPS;
  const dLng = (lngB - lngA) / CROSS_STEPS;
  for (let i = 0; i < CROSS_STEPS; i++) {
    L.rectangle(
      [
        [latA + dLat * i, lngA + dLng * i],
        [latA + dLat * (i + 1), lngA + dLng * (i + 1)],
      ],
      { stroke: false, fillColor: color, fillOpacity: 1, interactive: false },
    ).addTo(target);
  }
}

// two beams crossing corner-to-corner, one bright and one darker, for a
// pseudo-3D "woven" look
function drawChunkCross(target: L.LayerGroup, corner1: L.LatLngTuple, corner2: L.LatLngTuple): void {
  const [lat1, lng1] = corner1;
  const [lat2, lng2] = corner2;

  // darker beam drawn first (underneath), brighter beam second (on top)
  drawPixelDiagonal(target, lat1, lng2, lat2, lng1, "#800000");
  drawPixelDiagonal(target, lat1, lng1, lat2, lng2, "#ff0000");
}

function drawZone(
  map: L.Map,
  target: L.LayerGroup,
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
  }).addTo(target);
  if (popupContent) rectangle.bindPopup(popupContent);

  if (isChunk) {
    drawChunkCross(target, corner1, corner2);
  } else {
    ensureShineGradient(map);
  }
}

export interface ListEntry {
  title: string;
  color: string;
  center: L.LatLngTuple;
}

export interface RenderResult {
  colorGroups: Map<string, L.LayerGroup>;
  listEntries: ListEntry[];
}

export interface RenderOptions {
  mapHeight: number;
  defaultColor?: string;
}

export function renderPois(map: L.Map, pois: PointOfInterest[], options: RenderOptions): RenderResult {
  const { mapHeight, defaultColor = DEFAULT_POI_COLOR } = options;
  const poiIcon = L.divIcon({ className: "poi-marker-icon", iconSize: [12, 12] });

  // one LayerGroup per POI color, so a color filter panel can show/hide a
  // whole color's worth of markers/zones at once
  const colorGroups = new Map<string, L.LayerGroup>();
  function getColorGroup(color: string): L.LayerGroup {
    let group = colorGroups.get(color);
    if (!group) {
      group = L.layerGroup().addTo(map);
      colorGroups.set(color, group);
    }
    return group;
  }

  const listEntries: ListEntry[] = [];

  for (const poi of pois) {
    const popupContent = poi.title ? createPopupContent(poi.title, poi.description) : undefined;
    const color = poi.color ?? defaultColor;
    const group = getColorGroup(color);
    const isChunk = poi.type === "chunk";
    let center: L.LatLngTuple;

    if (isZone(poi)) {
      const corner1 = toLatLng(mapHeight, poi.x1, poi.y1);
      const corner2 = toLatLng(mapHeight, poi.x2, poi.y2);
      drawZone(map, group, corner1, corner2, color, isChunk, popupContent);
      center = [(corner1[0] + corner2[0]) / 2, (corner1[1] + corner2[1]) / 2];
    } else if (isChunk) {
      // (x, y) is the chunk's origin corner; expand to the full 16x16 block zone
      const corner1 = toLatLng(mapHeight, poi.x, poi.y);
      const corner2 = toLatLng(mapHeight, poi.x + CHUNK_SIZE, poi.y + CHUNK_SIZE);
      drawZone(map, group, corner1, corner2, color, true, popupContent);
      center = [(corner1[0] + corner2[0]) / 2, (corner1[1] + corner2[1]) / 2];
    } else {
      center = toLatLng(mapHeight, poi.x, poi.y);
      const marker = L.marker(center, { icon: poiIcon }).addTo(group);
      if (popupContent) marker.bindPopup(popupContent);
      marker.getElement()?.style.setProperty("border-color", color);
    }

    if (poi.title) {
      listEntries.push({ title: poi.title, color, center });
    }
  }

  return { colorGroups, listEntries };
}
