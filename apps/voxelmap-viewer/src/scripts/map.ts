import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "@south-paw/typeface-minecraft";
import { renderPois, fromLatLng, toLatLng, setupMapImage, mapQuadrants, pois } from "map-render";

// permissive range so getBoundsZoom below isn't clamped to Leaflet's default 0..18
// zoomAnimation off: the quadrant images are huge single <img> elements, and
// animating the zoom means the browser rescales them every frame — jumping
// straight to the new zoom instead is the cheap fix for the resulting lag
const map = L.map("map", { crs: L.CRS.Simple, minZoom: -20, maxZoom: 20, zoomControl: false, zoomAnimation: false });

const bounds = setupMapImage(map, mapQuadrants);

// can't zoom out past seeing the whole map, can zoom in up to 8x beyond that
const fitZoom = map.getBoundsZoom(bounds, true);
map.setMinZoom(fitZoom);
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

const savedCamera = loadSavedCamera();
if (savedCamera) {
  map.setView([savedCamera.lat, savedCamera.lng], savedCamera.zoom);
} else {
  map.setView(toLatLng(0, 0), fitZoom);
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
zoomFitButton.addEventListener("click", () => map.fitBounds(bounds));

function updateZoomButtons() {
  zoomInButton.disabled = map.getZoom() >= map.getMaxZoom();
  zoomOutButton.disabled = map.getZoom() <= map.getMinZoom();
}

map.on("zoomend", updateZoomButtons);
updateZoomButtons();

// --- chunk count ---

const chunkCountValue = document.getElementById("chunk-count-value") as HTMLElement;
chunkCountValue.textContent = String(pois.filter((poi) => poi.type === "chunk").length);

// --- mouse coordinates ---

const mouseCoords = document.getElementById("mouse-coords") as HTMLElement;

map.on("mousemove", (event: L.LeafletMouseEvent) => {
  const { x, y } = fromLatLng(event.latlng.lat, event.latlng.lng);
  mouseCoords.textContent = `X: ${Math.round(x)} Y: ${Math.round(y)}`;
});

const { colorGroups, listEntries } = renderPois(map, pois, {});

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

// --- color filter panel ---

const colorsPanel = document.getElementById("colors-panel") as HTMLElement;
const colorFilterItems = document.getElementById("color-filter-items") as HTMLElement;
const toggleColorsButton = document.getElementById("toggle-colors") as HTMLButtonElement;

for (const [color, group] of colorGroups) {
  const item = document.createElement("li");
  item.className = "color-filter-item";

  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.checked = true;
  checkbox.addEventListener("change", () => {
    if (checkbox.checked) {
      group.addTo(map);
    } else {
      map.removeLayer(group);
    }
  });

  const swatch = document.createElement("span");
  swatch.className = "color-swatch";
  swatch.style.backgroundColor = color;

  const label = document.createElement("span");
  label.textContent = color;

  item.append(checkbox, swatch, label);
  item.addEventListener("click", (event) => {
    if (event.target !== checkbox) checkbox.click();
  });
  colorFilterItems.append(item);
}

toggleColorsButton.addEventListener("click", () => {
  colorsPanel.hidden = !colorsPanel.hidden;
  toggleColorsButton.classList.toggle("active", !colorsPanel.hidden);
});
