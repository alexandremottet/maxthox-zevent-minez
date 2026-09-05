import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "@south-paw/typeface-minecraft";
import { renderPois, mapDataUrl, mapHeight, mapWidth } from "map-render";
import { pois } from "../data/poi.ts";

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

const { colorGroups, listEntries } = renderPois(map, pois, { mapHeight });

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
