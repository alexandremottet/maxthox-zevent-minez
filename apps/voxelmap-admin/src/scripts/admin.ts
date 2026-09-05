import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "@south-paw/typeface-minecraft";
import { renderPois, fromLatLng, mapDataUrl, mapHeight, mapWidth, type PointOfInterest } from "map-render";
import { authClient } from "../lib/auth-client.ts";

declare global {
  interface Window {
    __initialPois: PointOfInterest[];
  }
}

// permissive range so getBoundsZoom below isn't clamped to Leaflet's default 0..18
const map = L.map("map", { crs: L.CRS.Simple, minZoom: -20, maxZoom: 20, zoomControl: false });

const bounds: L.LatLngBoundsExpression = [
  [0, 0],
  [mapHeight, mapWidth],
];

L.imageOverlay(mapDataUrl, bounds).addTo(map);

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

const { listEntries } = renderPois(map, window.__initialPois, { mapHeight });

const poiListItems = document.getElementById("poi-list-items") as HTMLElement;
const FLY_TO_ZOOM = fitZoom + 2;

for (const entry of listEntries) {
  const item = document.createElement("li");
  item.className = "poi-list-item";
  item.textContent = entry.title;
  item.style.color = entry.color;
  item.addEventListener("click", () => map.flyTo(entry.center, FLY_TO_ZOOM));
  poiListItems.append(item);
}

// --- logout ---

document.getElementById("logout")?.addEventListener("click", async () => {
  await authClient.signOut();
  window.location.href = "/login";
});

// --- add-POI dialog ---

const dialog = document.getElementById("add-poi-dialog") as HTMLDialogElement;
const form = document.getElementById("add-poi-form") as HTMLFormElement;
const statusEl = document.getElementById("dialog-status") as HTMLElement;
const zoneCheckbox = document.getElementById("poi-zone") as HTMLInputElement;
const pointFields = document.getElementById("point-fields") as HTMLElement;
const zoneFields = document.getElementById("zone-fields") as HTMLElement;

const xInput = document.getElementById("poi-x") as HTMLInputElement;
const yInput = document.getElementById("poi-y") as HTMLInputElement;
const x1Input = document.getElementById("poi-x1") as HTMLInputElement;
const y1Input = document.getElementById("poi-y1") as HTMLInputElement;
const x2Input = document.getElementById("poi-x2") as HTMLInputElement;
const y2Input = document.getElementById("poi-y2") as HTMLInputElement;

document.getElementById("add-poi")?.addEventListener("click", () => {
  statusEl.textContent = "";
  statusEl.className = "dialog-status";
  // non-modal: showModal()'s backdrop would block clicks on the map behind it,
  // and the whole point is to be able to click the map while this is open
  dialog.show();
});

document.getElementById("dialog-cancel")?.addEventListener("click", () => dialog.close());

zoneCheckbox.addEventListener("change", () => {
  pointFields.hidden = zoneCheckbox.checked;
  zoneFields.hidden = !zoneCheckbox.checked;
});

// while the dialog is open, clicking the map fills coordinates instead of
// requiring the admin to compute world x/z by hand: point mode fills x/y
// directly, zone mode fills corner 1 then corner 2 on alternating clicks
let nextZoneCorner: 1 | 2 = 1;

map.on("click", (event: L.LeafletMouseEvent) => {
  if (!dialog.open) return;
  const { x, y } = fromLatLng(mapHeight, event.latlng.lat, event.latlng.lng);
  const roundedX = Math.round(x);
  const roundedY = Math.round(y);

  if (zoneCheckbox.checked) {
    if (nextZoneCorner === 1) {
      x1Input.value = String(roundedX);
      y1Input.value = String(roundedY);
      nextZoneCorner = 2;
    } else {
      x2Input.value = String(roundedX);
      y2Input.value = String(roundedY);
      nextZoneCorner = 1;
    }
  } else {
    xInput.value = String(roundedX);
    yInput.value = String(roundedY);
  }
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  statusEl.textContent = "";
  statusEl.className = "dialog-status";

  const formData = new FormData(form);
  const title = String(formData.get("title") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const color = String(formData.get("color") ?? "").trim();
  const isChunk = zoneCheckbox && (document.getElementById("poi-chunk") as HTMLInputElement).checked;

  const poi: Record<string, unknown> = { title };
  if (description) poi.description = description;
  if (color) poi.color = color;
  if (isChunk) poi.type = "chunk";

  if (zoneCheckbox.checked) {
    const x1 = Number(formData.get("x1"));
    const y1 = Number(formData.get("y1"));
    const x2 = Number(formData.get("x2"));
    const y2 = Number(formData.get("y2"));
    if ([x1, y1, x2, y2].some(Number.isNaN)) {
      statusEl.textContent = "fill x1/y1/x2/y2 (click the map twice)";
      statusEl.className = "dialog-status error";
      return;
    }
    Object.assign(poi, { x1, y1, x2, y2 });
  } else {
    const x = Number(formData.get("x"));
    const y = Number(formData.get("y"));
    if ([x, y].some(Number.isNaN)) {
      statusEl.textContent = "fill x/y (click the map)";
      statusEl.className = "dialog-status error";
      return;
    }
    Object.assign(poi, { x, y });
  }

  statusEl.textContent = "publishing...";

  try {
    const response = await fetch("/api/pois", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(poi),
    });
    const data = (await response.json()) as { error?: string; commitUrl?: string };
    if (!response.ok) {
      statusEl.textContent = data.error ?? "failed to publish";
      statusEl.className = "dialog-status error";
      return;
    }
    statusEl.textContent = "published — the viewer will rebuild shortly.";
    statusEl.className = "dialog-status success";
    setTimeout(() => window.location.reload(), 1200);
  } catch (error) {
    statusEl.textContent = String(error);
    statusEl.className = "dialog-status error";
  }
});
