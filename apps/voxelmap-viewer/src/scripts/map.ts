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

function toggleCategory(category: string, visible: boolean): void {
  const group = categoryGroups.get(category);
  if (!group) return;
  if (visible) group.addTo(map);
  else map.removeLayer(group);
}

// chunk level colors and the percent overlay show the same chunks two
// different ways — never both at once (see hidePercentOverlay/hideChunkLevels below)
const chunkLevelCheckboxes: HTMLInputElement[] = [];

for (const level of CHUNK_LEVELS) {
  const checkbox = addFilterItem(`${level.name} chunk`, level.color, (checked) => {
    if (checked) hidePercentOverlay();
    toggleCategory(level.name, checked);
  });
  chunkLevelCheckboxes.push(checkbox);
}
addFilterItem("chunk label", null, setChunkLabelsVisible);
addFilterItem("startup POI", null, (checked) => toggleCategory("startup", checked));
addFilterItem("other POI", null, (checked) => toggleCategory("other", checked));
addFilterItem("zone POI", null, (checked) => toggleCategory("zone", checked));

toggleFilterButton.addEventListener("click", () => {
  filterPanel.hidden = !filterPanel.hidden;
  toggleFilterButton.classList.toggle("active", !filterPanel.hidden);
});

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
  } else if (iframeSrc) {
    visualizerPlaceholderLabel.hidden = true;
    visualizerIframe.hidden = false;
    if (visualizerIframe.src !== new URL(iframeSrc, location.href).href) visualizerIframe.src = iframeSrc;
    visualizerPlaceholder.hidden = false;
  } else {
    visualizerPlaceholderLabel.hidden = false;
    visualizerPlaceholderLabel.textContent = `${visualizer.label} — coming soon`;
    visualizerIframe.hidden = true;
    visualizerPlaceholder.hidden = false;
  }
}

const savedVisualizerId = loadSavedVisualizerId();
visualizerSelect.value = savedVisualizerId;
applyVisualizer(savedVisualizerId);

visualizerSelect.addEventListener("change", () => {
  saveVisualizerId(visualizerSelect.value);
  applyVisualizer(visualizerSelect.value);
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
});
