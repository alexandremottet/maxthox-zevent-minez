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
// below this many pixels of total mouse movement, a rectangle press+release
// counts as a click rather than a drag (mirrors Leaflet's own marker behavior)
const DRAG_CLICK_THRESHOLD_PX = 3;

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
): L.Rectangle {
  // fill:false would leave only the 2px border clickable (SVG doesn't
  // hit-test a fill:none shape's interior), so keep an invisible fill instead
  const rectangle = L.rectangle([corner1, corner2], {
    color,
    weight: 2,
    fillColor: isChunk ? "#000" : `url(#${SHINE_GRADIENT_ID})`,
    fillOpacity: isChunk ? 0 : 1,
  }).addTo(target);

  if (isChunk) {
    drawChunkCross(target, corner1, corner2);
  } else {
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
  mapHeight: number;
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
    mapHeight,
    defaultColor = DEFAULT_POI_COLOR,
    iconSize = [15, 15],
    startupIconSize = [20,20],
    onClick,
    onMove,
  } = options;
  const poiIcon = L.divIcon({ className: "poi-marker-icon", iconSize });
  const startupIcon = L.divIcon({ className: "poi-marker-icon", iconSize: startupIconSize });

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
    const color = poi.color ?? defaultColor;
    const group = getColorGroup(color);
    let center: L.LatLngTuple;

    const bindInteraction = (layer: L.Layer) => {
      if (onClick) {
        layer.on("click", () => onClick(poi));
      } else if (poi.title) {
        layer.bindPopup(createPopupContent(poi.title, poi.description));
      }
    };

    if (isZone(poi)) {
      const corner1 = toLatLng(mapHeight, poi.x1, poi.y1);
      const corner2 = toLatLng(mapHeight, poi.x2, poi.y2);
      const rectangle = drawZone(map, group, corner1, corner2, color, isChunk);
      bindInteraction(rectangle);
      if (onMove) {
        makeRectangleDraggable(
          map,
          rectangle,
          corner1,
          corner2,
          (c1, c2) => {
            const w1 = fromLatLng(mapHeight, c1[0], c1[1]);
            const w2 = fromLatLng(mapHeight, c2[0], c2[1]);
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
      const corner1 = toLatLng(mapHeight, poi.x, poi.y);
      const corner2 = toLatLng(mapHeight, poi.x + CHUNK_SIZE, poi.y + CHUNK_SIZE);
      const rectangle = drawZone(map, group, corner1, corner2, color, true);
      bindInteraction(rectangle);
      if (onMove) {
        makeRectangleDraggable(
          map,
          rectangle,
          corner1,
          corner2,
          (c1) => {
            const w1 = fromLatLng(mapHeight, c1[0], c1[1]);
            onMove(poi, { x: Math.round(w1.x), y: Math.round(w1.y) });
          },
          () => onClick?.(poi),
        );
      }
      center = [(corner1[0] + corner2[0]) / 2, (corner1[1] + corner2[1]) / 2];
    } else {
      center = toLatLng(mapHeight, poi.x, poi.y);
      const icon = poi.type === "startup" ? startupIcon : poiIcon;
      const marker = L.marker(center, { icon, draggable: !!onMove }).addTo(group);
      bindInteraction(marker);
      if (onMove) {
        marker.on("dragend", () => {
          const latlng = marker.getLatLng();
          const world = fromLatLng(mapHeight, latlng.lat, latlng.lng);
          onMove(poi, { x: Math.round(world.x), y: Math.round(world.y) });
        });
      }
      const el = marker.getElement();
      el?.style.setProperty("border-color", color);
      el?.style.setProperty("--poi-color", color);
      scaledMarkers.push({ marker, baseSize: poi.type === "startup" ? startupIconSize : iconSize, color });
    }

    if (poi.title) {
      listEntries.push({ title: poi.title, color, center });
    }
  }

  if (scaledMarkers.length > 0) {
    map.on("zoomend", () => {
      const factor = 2 ** (map.getZoom() - referenceZoom);
      for (const { marker, baseSize, color } of scaledMarkers) {
        const scaledSize: L.PointTuple = [baseSize[0] * factor, baseSize[1] * factor];
        marker.setIcon(L.divIcon({ className: "poi-marker-icon", iconSize: scaledSize }));
        const el = marker.getElement();
        el?.style.setProperty("border-color", color);
        el?.style.setProperty("--poi-color", color);
      }
    });
  }

  return { colorGroups, listEntries };
}
