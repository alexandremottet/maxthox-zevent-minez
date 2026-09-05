import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "@south-paw/typeface-minecraft";
import {
  renderPois,
  fromLatLng,
  heightAt,
  toLatLng,
  setupMapImage,
  mapQuadrants,
  pois,
  CHUNK_LEVELS,
  VISUALIZERS,
  DEFAULT_VISUALIZER_ID,
  renderChunkPercents,
  chunkPercents,
} from "map-render";


// permissive range so getBoundsZoom below isn't clamped to Leaflet's default 0..18
// zoomAnimation off: the quadrant images are huge single <img> elements, and
// animating the zoom means the browser rescales them every frame — jumping
// straight to the new zoom instead is the cheap fix for the resulting lag
const map = L.map("map", { crs: L.CRS.Simple, minZoom: -80, maxZoom: 20, zoomControl: false, zoomAnimation: false });

const bounds = setupMapImage(map, mapQuadrants);

// can't zoom out past seeing the whole map, can zoom in up to 8x beyond that
const fitZoom = map.getBoundsZoom(bounds, true);
map.setMinZoom(fitZoom - 2);
map.setMaxZoom(fitZoom + 2);

// default camera is world (0, 0); once the visitor pans/zooms, remember that instead
const CAMERA_STORAGE_KEY = "voxelmap-camera";

function loadSavedCamera(): { lat: number; lng: number; zoom: number } | null {
  try {
    const raw = localStorage.getItem(CAMERA_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (typeof parsed.lat === "number" && typeof parsed.lng === "number" && typeof parsed.zoom === "number") {
      return parsed;
    }
  } catch {
    // localStorage unavailable (private mode, disabled) — fall back to the default view
  }
  return null;
}

function pointAtOrigin(): void {
  map.setView(toLatLng(0, 0), fitZoom);
}

const savedCamera = loadSavedCamera();
if (savedCamera) {
  map.setView([savedCamera.lat, savedCamera.lng], savedCamera.zoom);
} else {
  pointAtOrigin();
}

map.on("moveend zoomend", () => {
  const center = map.getCenter();
  try {
    localStorage.setItem(CAMERA_STORAGE_KEY, JSON.stringify({ lat: center.lat, lng: center.lng, zoom: map.getZoom() }));
  } catch {
    // ignore — nothing to persist to if storage is unavailable
  }
});

const zoomInButton = document.getElementById("zoom-in") as HTMLButtonElement;
const zoomOutButton = document.getElementById("zoom-out") as HTMLButtonElement;
const zoomFitButton = document.getElementById("zoom-fit") as HTMLButtonElement;

zoomInButton.addEventListener("click", () => map.zoomIn());
zoomOutButton.addEventListener("click", () => map.zoomOut());
zoomFitButton.addEventListener("click", pointAtOrigin);

function updateZoomButtons() {
  zoomInButton.disabled = map.getZoom() >= map.getMaxZoom();
  zoomOutButton.disabled = map.getZoom() <= map.getMinZoom();
}

map.on("zoomend", updateZoomButtons);
updateZoomButtons();

// --- chunk count ---

const chunkCountValue = document.getElementById("chunk-count-value") as HTMLElement;
chunkCountValue.textContent = String(pois.filter((poi) => poi.type === "chunk" && poi.level === "done").length);

// --- mouse coordinates ---

const mouseCoords = document.getElementById("mouse-coords") as HTMLElement;

map.on("mousemove", (event: L.LeafletMouseEvent) => {
  const { x, y } = fromLatLng(event.latlng.lat, event.latlng.lng);
  const height = heightAt(x, y);
  mouseCoords.textContent = `X: ${Math.round(x)} Z: ${Math.round(y)} Y: ${height ?? "?"}`;
});

// while BlueMap is the active visualizer, it covers #map, so the Leaflet
// mousemove above never fires and this HUD would otherwise be stuck showing
// its last Leaflet value (or the initial placeholder). Poll BlueMap's own
// camera/controls position instead (same-origin iframe access, defensive —
// mapViewer.controlsManager.data.position is undocumented internal state).
// Unlike the Leaflet path, this Y is BlueMap's real recorded altitude, not an
// estimate from heightAt().
let blueMapCoordsTimer: ReturnType<typeof setInterval> | undefined;

function updateCoordsFromBlueMap(): void {
  try {
    // biome-ignore lint: BlueMap's internal API is untyped
    const bluemap = (visualizerIframe.contentWindow as any)?.bluemap;
    const position = bluemap?.mapViewer?.controlsManager?.data?.position;
    if (position) {
      mouseCoords.textContent = `X: ${Math.round(position.x)} Z: ${Math.round(position.z)} Y: ${Math.round(position.y)}`;
    }
  } catch {
    // iframe not ready yet — leave the HUD as-is until the next tick
  }
}

function startBlueMapCoords(): void {
  stopBlueMapCoords();
  blueMapCoordsTimer = setInterval(updateCoordsFromBlueMap, 200);
}

function stopBlueMapCoords(): void {
  clearInterval(blueMapCoordsTimer);
  blueMapCoordsTimer = undefined;
}

// --- credits dialog ---

const creditsDialog = document.getElementById("credits-dialog") as HTMLDialogElement;
const toggleCreditsButton = document.getElementById("toggle-credits") as HTMLButtonElement;
const creditsCloseButton = document.getElementById("credits-close") as HTMLButtonElement;

toggleCreditsButton.addEventListener("click", () => creditsDialog.showModal());
creditsCloseButton.addEventListener("click", () => creditsDialog.close());

const { categoryGroups, listEntries, setChunkLabelsVisible } = renderPois(map, pois, {});

// --- POI list panel ---

const poiListPanel = document.getElementById("poi-list") as HTMLElement;
const poiListItems = document.getElementById("poi-list-items") as HTMLElement;
const toggleListButton = document.getElementById("toggle-list") as HTMLButtonElement;
const FLY_TO_ZOOM = fitZoom + 2;

for (const entry of listEntries) {
  const item = document.createElement("li");
  item.className = "poi-list-item";
  item.textContent = entry.title;
  item.style.color = entry.color;
  item.addEventListener("click", () => map.flyTo(entry.center, FLY_TO_ZOOM));
  poiListItems.append(item);
}

toggleListButton.addEventListener("click", () => {
  poiListPanel.hidden = !poiListPanel.hidden;
  toggleListButton.classList.toggle("active", !poiListPanel.hidden);
});

// --- filter panel ---

const filterPanel = document.getElementById("filter-panel") as HTMLElement;
const filterItems = document.getElementById("filter-items") as HTMLElement;
const toggleFilterButton = document.getElementById("toggle-filter") as HTMLButtonElement;

function addFilterItem(label: string, color: string | null, onChange: (checked: boolean) => void): HTMLInputElement {
  const item = document.createElement("li");
  item.className = "color-filter-item";

  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.checked = true;
  checkbox.addEventListener("change", () => onChange(checkbox.checked));

  if (color) {
    const swatch = document.createElement("span");
    swatch.className = "color-swatch";
    swatch.style.backgroundColor = color;
    item.append(checkbox, swatch);
  } else {
    item.append(checkbox);
  }

  const labelEl = document.createElement("span");
  labelEl.textContent = label;
  item.append(labelEl);

  item.addEventListener("click", (event) => {
    if (event.target !== checkbox) checkbox.click();
  });
  filterItems.append(item);
  return checkbox;
}

// reaches into the BlueMap iframe (same-origin: /bluemap/index.html) to find
// one of its marker sets by id — ids are generated to match categoryGroups
// keys exactly (see generate-bluemap-markers.mjs), so the Filter panel is one
// shared control surface for both visualizers. Defensive: returns undefined
// (never throws) if the iframe isn't loaded yet or BlueMap's internal shape
// (mapViewer.markers.markerSets, undocumented) doesn't match.
function getBlueMapMarkerSet(id: string): { visible: boolean } | undefined {
  try {
    // biome-ignore lint: BlueMap's internal API is untyped
    const bluemap = (visualizerIframe.contentWindow as any)?.bluemap;
    return bluemap?.mapViewer?.markers?.markerSets?.get(id);
  } catch {
    return undefined;
  }
}

function toggleCategory(category: string, visible: boolean): void {
  const group = categoryGroups.get(category);
  if (group) {
    if (visible) group.addTo(map);
    else map.removeLayer(group);
  }
  const markerSet = getBlueMapMarkerSet(category);
  if (markerSet) markerSet.visible = visible;
}

// chunk level colors and the percent overlay show the same chunks two
// different ways — never both at once (see hidePercentOverlay/hideChunkLevels below)
const chunkLevelCheckboxes: HTMLInputElement[] = [];
// every category checkbox, keyed the same as categoryGroups/BlueMap marker-set
// ids — lets a freshly (re)loaded BlueMap iframe be brought in sync with
// whatever the Filter panel currently shows (see syncFiltersToBlueMap below)
const categoryCheckboxes = new Map<string, HTMLInputElement>();

for (const level of CHUNK_LEVELS) {
  const checkbox = addFilterItem(`${level.name} chunk`, level.color, (checked) => {
    if (checked) hidePercentOverlay();
    toggleCategory(level.name, checked);
  });
  chunkLevelCheckboxes.push(checkbox);
  categoryCheckboxes.set(level.name, checkbox);
}
addFilterItem("chunk label", null, setChunkLabelsVisible);
categoryCheckboxes.set("startup", addFilterItem("startup POI", null, (checked) => toggleCategory("startup", checked)));
categoryCheckboxes.set("other", addFilterItem("other POI", null, (checked) => toggleCategory("other", checked)));
categoryCheckboxes.set("zone", addFilterItem("zone POI", null, (checked) => toggleCategory("zone", checked)));

toggleFilterButton.addEventListener("click", () => {
  filterPanel.hidden = !filterPanel.hidden;
  toggleFilterButton.classList.toggle("active", !filterPanel.hidden);
});

// --- percent-dug overlay (beta) ---
// a fully separate rendering path from renderPois/categoryGroups above, kept
// mutually exclusive with the chunk-level colors (see chunkLevelCheckboxes
// above) — the two color the same chunks two different ways, so showing both
// at once just overlaps them

const percentGroup = renderChunkPercents(map, chunkPercents);
const togglePercentButton = document.getElementById("toggle-percent") as HTMLButtonElement;

function hidePercentOverlay(): void {
  if (map.hasLayer(percentGroup)) {
    map.removeLayer(percentGroup);
    togglePercentButton.classList.remove("active");
  }
  const markerSet = getBlueMapMarkerSet("chunkPercent");
  if (markerSet) markerSet.visible = false;
}

function hideChunkLevels(): void {
  for (const checkbox of chunkLevelCheckboxes) {
    if (checkbox.checked) {
      checkbox.checked = false;
      checkbox.dispatchEvent(new Event("change"));
    }
  }
}

togglePercentButton.addEventListener("click", () => {
  const visible = !map.hasLayer(percentGroup);
  if (visible) {
    hideChunkLevels();
    percentGroup.addTo(map);
  } else {
    map.removeLayer(percentGroup);
  }
  togglePercentButton.classList.toggle("active", visible);
  const markerSet = getBlueMapMarkerSet("chunkPercent");
  if (markerSet) markerSet.visible = visible;
});

// pushes the Filter panel's current state (source of truth) into a freshly
// (re)loaded BlueMap iframe, so switching visualizers doesn't reset back to
// BlueMap's own defaultHidden config — polls briefly since BlueMap's app JS
// finishes initializing asynchronously after the iframe's document loads
function syncFiltersToBlueMap(): void {
  let attemptsLeft = 25; // ~5s at 200ms
  function attempt(): void {
    const anyMarkerSet = getBlueMapMarkerSet(CHUNK_LEVELS[0]?.name ?? "zone");
    if (!anyMarkerSet && attemptsLeft-- > 0) {
      setTimeout(attempt, 200);
      return;
    }
    for (const [category, checkbox] of categoryCheckboxes) {
      const markerSet = getBlueMapMarkerSet(category);
      if (markerSet) markerSet.visible = checkbox.checked;
    }
    const percentMarkerSet = getBlueMapMarkerSet("chunkPercent");
    if (percentMarkerSet) percentMarkerSet.visible = map.hasLayer(percentGroup);
  }
  attempt();
}

// --- visualizer picker ---

const VISUALIZER_STORAGE_KEY = "voxelmap-visualizer";

function loadSavedVisualizerId(): string {
  try {
    return localStorage.getItem(VISUALIZER_STORAGE_KEY) ?? DEFAULT_VISUALIZER_ID;
  } catch {
    return DEFAULT_VISUALIZER_ID;
  }
}

function saveVisualizerId(id: string): void {
  try {
    localStorage.setItem(VISUALIZER_STORAGE_KEY, id);
  } catch {
    // ignore — nothing to persist to if storage is unavailable
  }
}

const visualizerSelect = document.getElementById("visualizer-select") as HTMLSelectElement;
const visualizerPlaceholder = document.getElementById("visualizer-placeholder") as HTMLElement;
const visualizerPlaceholderLabel = document.getElementById("visualizer-placeholder-label") as HTMLElement;
const visualizerIframe = document.getElementById("visualizer-iframe") as HTMLIFrameElement;

for (const visualizer of VISUALIZERS) {
  const option = document.createElement("option");
  option.value = visualizer.id;
  option.textContent = visualizer.label;
  visualizerSelect.append(option);
}

// registered visualizers with a real implementation here; anything else in
// VISUALIZERS falls back to a "coming soon" placeholder below
const VISUALIZER_IFRAME_SRC: Record<string, string> = {
  bluemap: "/bluemap/index.html",
};

function applyVisualizer(id: string): void {
  const visualizer = VISUALIZERS.find((entry) => entry.id === id) ?? VISUALIZERS[0];
  const iframeSrc = VISUALIZER_IFRAME_SRC[visualizer.id];

  if (visualizer.id === "leaflet") {
    visualizerPlaceholder.hidden = true;
    visualizerIframe.hidden = true;
    visualizerIframe.src = "";
    stopBlueMapCoords();
  } else if (iframeSrc) {
    // "localhost" isn't a reliable signal — `astro preview` also serves from
    // there, and preview is meant to show real production behavior. Astro's
    // own DEV flag (baked in at build time; false for both preview and the
    // real deployed site) is what BlueMap's injected script actually checks.
    const src = import.meta.env.DEV ? `${iframeSrc}?bluemapControls=1` : iframeSrc;
    visualizerPlaceholderLabel.hidden = true;
    visualizerIframe.hidden = false;
    if (visualizerIframe.src !== new URL(src, location.href).href) {
      visualizerIframe.src = src;
      syncFiltersToBlueMap();
    }
    visualizerPlaceholder.hidden = false;
    if (visualizer.id === "bluemap") startBlueMapCoords();
  } else {
    visualizerPlaceholderLabel.hidden = false;
    visualizerPlaceholderLabel.textContent = `${visualizer.label} — coming soon`;
    visualizerIframe.hidden = true;
    visualizerPlaceholder.hidden = false;
    stopBlueMapCoords();
  }
}

const savedVisualizerId = loadSavedVisualizerId();
visualizerSelect.value = savedVisualizerId;
applyVisualizer(savedVisualizerId);

visualizerSelect.addEventListener("change", () => {
  saveVisualizerId(visualizerSelect.value);
  applyVisualizer(visualizerSelect.value);
});
