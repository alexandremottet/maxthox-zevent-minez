import L from "leaflet";
import { isZone, type PointOfInterest } from "./poi.ts";
import rawLevels from "./levels.json";
import { mapQuadrants } from "./map-data.ts";

// must match the --scale used to generate out/map.png (voxelmap-to-image):
// 1 world block covers MAP_SCALE x MAP_SCALE pixels in the embedded image
export const MAP_SCALE = 16;

// one Minecraft chunk = 16x16 blocks
export const CHUNK_SIZE = 16;

// VoxelMap's sentinel for "no cached data" (Short.MIN_VALUE) — duplicated from
// voxelmap-to-image/src/regions.ts rather than imported: that package pulls in
// adm-zip/pngjs, Node-only, which would break this browser bundle
const NO_DATA_HEIGHT = -32768;

const DEFAULT_POI_COLOR = "red";

export interface ChunkLevel {
  name: string;
  // chunk-scanner assigns a chunk to whichever level's [heightMin, heightMax]
  // range contains that chunk's average surveyed-column height
  heightMin: number;
  heightMax: number;
  color: string;
}

export const CHUNK_LEVELS: ChunkLevel[] = rawLevels as ChunkLevel[];

// a chunk POI only renders when its level matches one of these — anything
// else (missing, or a name that no longer exists in levels.json) is hidden
export function isKnownChunkLevel(levelName: string | undefined): boolean {
  return CHUNK_LEVELS.some((l) => l.name === levelName);
}

function levelColor(levelName: string | undefined): string {
  return CHUNK_LEVELS.find((l) => l.name === levelName)?.color ?? DEFAULT_POI_COLOR;
}

const SHINE_GRADIENT_ID = "poi-shine-gradient";
// below this many pixels of total mouse movement, a rectangle press+release
// counts as a click rather than a drag (mirrors Leaflet's own marker behavior)
const DRAG_CLICK_THRESHOLD_PX = 3;

// world (0, 0) is a fixed point, not a computed offset: the 4 quadrant images
// (see setupMapImage) are each pinned to it by construction. Minecraft's +Z
// (this codebase's "y") is south, which is downward on screen, i.e. negative
// lat — a plain negation, no per-map bounds needed for the flip.
export function toLatLng(worldX: number, worldZ: number): L.LatLngTuple {
  return [-worldZ * MAP_SCALE, worldX * MAP_SCALE];
}

// inverse of toLatLng — used by the admin to turn a map click back into world x/z
export function fromLatLng(lat: number, lng: number): { x: number; y: number } {
  return { x: lng / MAP_SCALE, y: -lat / MAP_SCALE };
}


// picks which of the 4 forced-origin quadrants a world block belongs to —
// mirrors voxelmap-to-image's own quadrantOf()
function quadrantKeyFor(worldX: number, worldZ: number): "pxpy" | "nxpy" | "pxny" | "nxny" {
  if (worldX >= 0 && worldZ >= 0) return "pxpy";
  if (worldX < 0 && worldZ >= 0) return "nxpy";
  if (worldX >= 0 && worldZ < 0) return "pxny";
  return "nxny";
}

const heightArrayCache = new Map<string, Int16Array>();

// base64 -> Int16Array, decoded once per quadrant and cached
function decodeHeights(base64: string): Int16Array {
  let heights = heightArrayCache.get(base64);
  if (!heights) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    heights = new Int16Array(bytes.buffer);
    heightArrayCache.set(base64, heights);
  }
  return heights;
}

// real Minecraft terrain height (Y level) at a world (x, z), or undefined if
// out of the embedded data's range or VoxelMap never recorded that column
export function heightAt(worldX: number, worldZ: number): number | undefined {
  const key = quadrantKeyFor(worldX, worldZ);
  const quadrant = mapQuadrants[key];
  if (!quadrant?.heightsBase64) return undefined;

  const blockX = Math.floor(worldX);
  const blockZ = Math.floor(worldZ);
  // each quadrant's near edge (touching world 0) is forced at index 0 or at
  // the far index — same rule toLatLng/quadrantBounds already rely on
  const column = key === "pxpy" || key === "pxny" ? blockX : blockX + quadrant.heightsWidth;
  const row = key === "pxpy" || key === "nxpy" ? blockZ : blockZ + quadrant.heightsHeight;
  if (column < 0 || column >= quadrant.heightsWidth || row < 0 || row >= quadrant.heightsHeight) return undefined;

  const value = decodeHeights(quadrant.heightsBase64)[row * quadrant.heightsWidth + column];
  return value === NO_DATA_HEIGHT ? undefined : value;
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

// chunks are drawn as a flat, semi-transparent color fill (no border shadow,
// no cross) so the underlying map stays visible through them; other zones
// keep the animated shine fill + pixelated shadow
function drawZone(map: L.Map, target: L.LayerGroup, corner1: L.LatLngTuple, corner2: L.LatLngTuple, color: string, isChunk: boolean): L.Rectangle {
  const rectangle = L.rectangle([corner1, corner2], {
    color,
    weight: 2,
    fillColor: isChunk ? color : `url(#${SHINE_GRADIENT_ID})`,
    fillOpacity: isChunk ? 0.5 : 1,
    className: isChunk ? undefined : "poi-zone-shape",
  }).addTo(target);

  if (!isChunk) {
    ensureShineGradient(map);
  }

  return rectangle;
}

// Leaflet has no built-in draggable rectangle; translate both corners
// together by the mouse delta, live, then report the final corners on release.
// A press+release under DRAG_CLICK_THRESHOLD_PX counts as a click instead.
function makeRectangleDraggable(
  map: L.Map,
  rectangle: L.Rectangle,
  corner1: L.LatLngTuple,
  corner2: L.LatLngTuple,
  onDrop: (corner1: L.LatLngTuple, corner2: L.LatLngTuple) => void,
  onClick: () => void,
): void {
  let dragging = false;
  let start: L.LatLng | null = null;
  let startPoint: L.Point | null = null;
  let moved = 0;

  rectangle.on("mousedown", (event: L.LeafletMouseEvent) => {
    dragging = true;
    start = event.latlng;
    startPoint = event.containerPoint;
    moved = 0;
    map.dragging.disable();
    L.DomEvent.stop(event);
  });

  map.on("mousemove", (event: L.LeafletMouseEvent) => {
    if (!dragging || !start || !startPoint) return;
    moved = Math.max(moved, event.containerPoint.distanceTo(startPoint));
    const dLat = event.latlng.lat - start.lat;
    const dLng = event.latlng.lng - start.lng;
    rectangle.setBounds([
      [corner1[0] + dLat, corner1[1] + dLng],
      [corner2[0] + dLat, corner2[1] + dLng],
    ]);
  });

  map.on("mouseup", (event: L.LeafletMouseEvent) => {
    if (!dragging || !start) return;
    dragging = false;
    map.dragging.enable();

    if (moved < DRAG_CLICK_THRESHOLD_PX) {
      onClick();
      return;
    }

    const dLat = event.latlng.lat - start.lat;
    const dLng = event.latlng.lng - start.lng;
    const newCorner1: L.LatLngTuple = [corner1[0] + dLat, corner1[1] + dLng];
    const newCorner2: L.LatLngTuple = [corner2[0] + dLat, corner2[1] + dLng];
    corner1 = newCorner1;
    corner2 = newCorner2;
    onDrop(newCorner1, newCorner2);
  });
}

// font-size drives the marker's em-based drop-shadow (see .poi-marker-icon
// CSS) so the pixelated shadow scales together with the icon, not just a
// fixed px offset that looks wrong once the icon itself resizes with zoom
function applyMarkerElementStyle(el: HTMLElement | null, color: string, size: L.PointTuple): void {
  if (!el) return;
  el.style.setProperty("border-color", color);
  el.style.setProperty("--poi-color", color);
  el.style.fontSize = `${size[0]}px`;
}

// subtle full-map wash that sits above the base image but below every POI:
// zones/markers live in a layer stacked above this one, so they stay unaffected
export function addMapWash(map: L.Map, bounds: L.LatLngBoundsExpression): void {
  L.rectangle(bounds, { stroke: false, fillColor: "#fff", fillOpacity: 0.12, interactive: false }).addTo(map);
}

export interface MapQuadrant {
  width: number;
  height: number;
  dataUrl: string;
}

export interface MapQuadrants {
  pxpy: MapQuadrant | null;
  nxpy: MapQuadrant | null;
  pxny: MapQuadrant | null;
  nxny: MapQuadrant | null;
}

// each quadrant is pinned to world (0, 0) by construction (see voxelmap-to-image's
// stitchQuadrant), so its Leaflet bounds follow directly from its own pixel size
function quadrantBounds(key: keyof MapQuadrants, { width, height }: MapQuadrant): L.LatLngBoundsExpression {
  switch (key) {
    case "pxpy":
      return [
        [-height, 0],
        [0, width],
      ];
    case "nxpy":
      return [
        [-height, -width],
        [0, 0],
      ];
    case "pxny":
      return [
        [0, 0],
        [height, width],
      ];
    case "nxny":
      return [
        [0, -width],
        [height, 0],
      ];
  }
}

// places whichever of the 4 quadrant images exist, adds the light wash over
// their combined area, and returns that combined area for fitBounds/getBoundsZoom
export function setupMapImage(map: L.Map, quadrants: MapQuadrants): L.LatLngBounds {
  const combined = L.latLngBounds([]);
  for (const key of ["pxpy", "nxpy", "pxny", "nxny"] as const) {
    const quadrant = quadrants[key];
    if (!quadrant) continue;
    const bounds = quadrantBounds(key, quadrant);
    L.imageOverlay(quadrant.dataUrl, bounds).addTo(map);
    combined.extend(bounds);
  }
  addMapWash(map, combined);
  return combined;
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

export interface RenderOptions<T extends PointOfInterest> {
  defaultColor?: string;
  iconSize?: L.PointTuple;
  /** defaults to 1.5x iconSize — how "startup" points stand out from the rest */
  startupIconSize?: L.PointTuple;
  /** if provided, clicking a POI calls this instead of showing the read-only popup */
  onClick?: (poi: T) => void;
  /** if provided, POIs become draggable; dropping one calls this with its new coordinates */
  onMove?: (poi: T, coords: Partial<Record<"x" | "y" | "x1" | "y1" | "x2" | "y2", number>>) => void;
}

export function renderPois<T extends PointOfInterest>(
  map: L.Map,
  pois: T[],
  options: RenderOptions<T>,
): RenderResult {
  const {
    defaultColor = DEFAULT_POI_COLOR,
    iconSize = [15, 15],
    startupIconSize = [20,20],
    onClick,
    onMove,
  } = options;
  // clip-path lives on an inner .poi-marker-shape span, not this outer element:
  // a filter's drop-shadow gets clipped away by its own element's clip-path in
  // browsers, so the shadow has to live on an ancestor that has no clip-path
  const markerHtml = '<span class="poi-marker-shape"></span>';
  const poiIcon = L.divIcon({ className: "poi-marker-icon", iconSize, html: markerHtml });
  const startupIcon = L.divIcon({ className: "poi-marker-icon", iconSize: startupIconSize, html: markerHtml });

  // iconSize/startupIconSize are CSS pixels at the current zoom; markers should
  // scale with the map like the chunk/zone rectangles do, so track each marker's
  // base size and rescale on zoom (CRS.Simple: 1 world unit = 2^zoom screen px)
  const referenceZoom = map.getZoom();
  const scaledMarkers: { marker: L.Marker; baseSize: L.PointTuple; color: string }[] = [];

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
    const isChunk = poi.type === "chunk";
    // only display chunks whose level is one of the tiers defined in levels.json
    if (isChunk && !isKnownChunkLevel(poi.level)) continue;
    // chunk border matches its level's color unless an admin explicitly set one
    const color = poi.color ?? (isChunk ? levelColor(poi.level) : defaultColor);
    const group = getColorGroup(color);
    let center: L.LatLngTuple;

    const bindInteraction = (layer: L.Layer) => {
      if (onClick) {
        // rectangles bubble click to the map by default (unlike markers), which would
        // also fire the admin's "click empty map to set coordinates" handler and
        // overwrite the fields this onClick just filled in with the click's own position
        layer.on("click", (event: L.LeafletMouseEvent) => {
          L.DomEvent.stopPropagation(event);
          onClick(poi);
        });
      } else if (poi.title) {
        layer.bindPopup(createPopupContent(poi.title, poi.description));
      }
    };

    if (isZone(poi)) {
      const corner1 = toLatLng(poi.x1, poi.y1);
      const corner2 = toLatLng(poi.x2, poi.y2);
      const rectangle = drawZone(map, group, corner1, corner2, color, isChunk);
      bindInteraction(rectangle);
      if (onMove) {
        makeRectangleDraggable(
          map,
          rectangle,
          corner1,
          corner2,
          (c1, c2) => {
            const w1 = fromLatLng(c1[0], c1[1]);
            const w2 = fromLatLng(c2[0], c2[1]);
            onMove(poi, {
              x1: Math.round(w1.x),
              y1: Math.round(w1.y),
              x2: Math.round(w2.x),
              y2: Math.round(w2.y),
            });
          },
          () => onClick?.(poi),
        );
      }
      center = [(corner1[0] + corner2[0]) / 2, (corner1[1] + corner2[1]) / 2];
    } else if (isChunk) {
      // (x, y) is the chunk's origin corner; expand to the full 16x16 block zone
      const corner1 = toLatLng(poi.x, poi.y);
      const corner2 = toLatLng(poi.x + CHUNK_SIZE, poi.y + CHUNK_SIZE);
      const rectangle = drawZone(map, group, corner1, corner2, color, true);
      rectangle.bindTooltip(poi.level ?? "", { permanent: true, direction: "center", className: "poi-chunk-level" });
      bindInteraction(rectangle);
      if (onMove) {
        makeRectangleDraggable(
          map,
          rectangle,
          corner1,
          corner2,
          (c1) => {
            const w1 = fromLatLng(c1[0], c1[1]);
            onMove(poi, { x: Math.round(w1.x), y: Math.round(w1.y) });
          },
          () => onClick?.(poi),
        );
      }
      center = [(corner1[0] + corner2[0]) / 2, (corner1[1] + corner2[1]) / 2];
    } else {
      center = toLatLng(poi.x, poi.y);
      const icon = poi.type === "startup" ? startupIcon : poiIcon;
      const marker = L.marker(center, { icon, draggable: !!onMove }).addTo(group);
      bindInteraction(marker);
      if (onMove) {
        marker.on("dragend", () => {
          const latlng = marker.getLatLng();
          const world = fromLatLng(latlng.lat, latlng.lng);
          onMove(poi, { x: Math.round(world.x), y: Math.round(world.y) });
        });
      }
      applyMarkerElementStyle(marker.getElement(), color, poi.type === "startup" ? startupIconSize : iconSize);
      scaledMarkers.push({ marker, baseSize: poi.type === "startup" ? startupIconSize : iconSize, color });
    }

    if (poi.title && !isChunk) {
      listEntries.push({ title: poi.title, color, center });
    }
  }

  if (scaledMarkers.length > 0) {
    map.on("zoomend", () => {
      const factor = 2 ** (map.getZoom() - referenceZoom);
      for (const { marker, baseSize, color } of scaledMarkers) {
        const scaledSize: L.PointTuple = [baseSize[0] * factor, baseSize[1] * factor];
        marker.setIcon(L.divIcon({ className: "poi-marker-icon", iconSize: scaledSize, html: markerHtml }));
        applyMarkerElementStyle(marker.getElement(), color, scaledSize);
      }
    });
  }

  return { colorGroups, listEntries };
}
