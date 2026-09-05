import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "@south-paw/typeface-minecraft";
import { renderPois, fromLatLng, isZone, setupMapImage, mapQuadrants, VISUALIZERS, DEFAULT_VISUALIZER_ID } from "map-render";
import { authClient } from "../lib/auth-client.ts";
import type { AdminPoi } from "../lib/poi-db.ts";

declare global {
  interface Window {
    __initialPois: AdminPoi[];
  }
}

// permissive range so getBoundsZoom below isn't clamped to Leaflet's default 0..18
// zoomAnimation off: the quadrant images are huge single <img> elements, and
// animating the zoom means the browser rescales them every frame — jumping
// straight to the new zoom instead is the cheap fix for the resulting lag
const map = L.map("map", { crs: L.CRS.Simple, minZoom: -40, maxZoom: 20, zoomControl: false, zoomAnimation: false });

const bounds = setupMapImage(map, mapQuadrants);

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

// --- logout ---

document.getElementById("logout")?.addEventListener("click", async () => {
  await authClient.signOut();
  window.location.href = "/login";
});

// --- toast (feedback for drag-to-move saves, which don't reload the page) ---

function showToast(message: string, isError = false): void {
  const toast = document.createElement("div");
  toast.className = `toast ${isError ? "toast-error" : "toast-success"}`;
  toast.textContent = message;
  document.body.append(toast);
  setTimeout(() => toast.remove(), 2000);
}

// --- add/edit-POI dialog ---

const dialog = document.getElementById("add-poi-dialog") as HTMLDialogElement;
const form = document.getElementById("add-poi-form") as HTMLFormElement;
const dialogTitle = document.getElementById("dialog-title") as HTMLElement;
const dialogSubmit = document.getElementById("dialog-submit") as HTMLButtonElement;
const dialogDelete = document.getElementById("dialog-delete") as HTMLButtonElement;
const statusEl = document.getElementById("dialog-status") as HTMLElement;
const idInput = document.getElementById("poi-id") as HTMLInputElement;
const titleInput = document.getElementById("poi-title") as HTMLInputElement;
const descriptionInput = document.getElementById("poi-description") as HTMLInputElement;
const colorInput = document.getElementById("poi-color") as HTMLInputElement;
const zoneCheckbox = document.getElementById("poi-zone") as HTMLInputElement;
const pointFields = document.getElementById("point-fields") as HTMLElement;
const zoneFields = document.getElementById("zone-fields") as HTMLElement;

const xInput = document.getElementById("poi-x") as HTMLInputElement;
const yInput = document.getElementById("poi-y") as HTMLInputElement;
const x1Input = document.getElementById("poi-x1") as HTMLInputElement;
const y1Input = document.getElementById("poi-y1") as HTMLInputElement;
const x2Input = document.getElementById("poi-x2") as HTMLInputElement;
const y2Input = document.getElementById("poi-y2") as HTMLInputElement;

function setZoneMode(isZoneMode: boolean): void {
  zoneCheckbox.checked = isZoneMode;
  pointFields.hidden = isZoneMode;
  zoneFields.hidden = !isZoneMode;
}

function resetDeleteButton(): void {
  deleteArmed = false;
  dialogDelete.textContent = "Delete";
  dialogDelete.classList.remove("armed");
}

function openAddDialog(): void {
  form.reset();
  idInput.value = "";
  dialogTitle.textContent = "Add POI";
  dialogSubmit.textContent = "Add";
  dialogDelete.hidden = true;
  resetDeleteButton();
  setZoneMode(false);
  statusEl.textContent = "";
  statusEl.className = "dialog-status";
  dialog.show();
}

function openEditDialog(poi: AdminPoi): void {
  idInput.value = poi._id;
  titleInput.value = poi.title ?? "";
  descriptionInput.value = poi.description ?? "";
  colorInput.value = poi.color ?? "";
  (document.querySelector(`input[name="poiType"][value="${poi.type ?? ""}"]`) as HTMLInputElement | null)?.click();

  if (isZone(poi)) {
    setZoneMode(true);
    x1Input.value = String(poi.x1);
    y1Input.value = String(poi.y1);
    x2Input.value = String(poi.x2);
    y2Input.value = String(poi.y2);
  } else {
    setZoneMode(false);
    xInput.value = String(poi.x);
    yInput.value = String(poi.y);
  }

  dialogTitle.textContent = "Edit POI";
  dialogSubmit.textContent = "Save";
  dialogDelete.hidden = false;
  resetDeleteButton();
  statusEl.textContent = "";
  statusEl.className = "dialog-status";
  dialog.show();
}

document.getElementById("add-poi")?.addEventListener("click", openAddDialog);
document.getElementById("dialog-cancel")?.addEventListener("click", () => dialog.close());

// two-click confirm (no native confirm() dialog, matches the HUD styling):
// first click arms it, second click within a few seconds actually deletes
let deleteArmed = false;
let disarmTimer: ReturnType<typeof setTimeout> | undefined;

dialogDelete.addEventListener("click", async () => {
  if (!deleteArmed) {
    deleteArmed = true;
    dialogDelete.textContent = "Confirm delete?";
    dialogDelete.classList.add("armed");
    clearTimeout(disarmTimer);
    disarmTimer = setTimeout(resetDeleteButton, 4000);
    return;
  }

  clearTimeout(disarmTimer);
  const id = idInput.value;
  dialogDelete.disabled = true;

  try {
    const response = await fetch(`/api/pois/${id}`, { method: "DELETE" });
    const data = (await response.json()) as { error?: string };
    if (!response.ok) {
      statusEl.textContent = data.error ?? "failed to delete";
      statusEl.className = "dialog-status error";
      dialogDelete.disabled = false;
      resetDeleteButton();
      return;
    }
    dialog.close();
    window.location.reload();
  } catch (error) {
    statusEl.textContent = String(error);
    statusEl.className = "dialog-status error";
    dialogDelete.disabled = false;
    resetDeleteButton();
  }
});

zoneCheckbox.addEventListener("change", () => setZoneMode(zoneCheckbox.checked));

// while the dialog is open, clicking the map fills coordinates instead of
// requiring the admin to compute world x/z by hand: point mode fills x/y
// directly, zone mode fills corner 1 then corner 2 on alternating clicks
let nextZoneCorner: 1 | 2 = 1;

map.on("click", (event: L.LeafletMouseEvent) => {
  if (!dialog.open) return;
  const { x, y } = fromLatLng(event.latlng.lat, event.latlng.lng);
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

function readPoiFromForm(): Record<string, unknown> | undefined {
  const formData = new FormData(form);
  const title = String(formData.get("title") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const color = String(formData.get("color") ?? "").trim();
  const poiType = String(formData.get("poiType") ?? "");

  const poi: Record<string, unknown> = { title };
  if (description) poi.description = description;
  if (color) poi.color = color;
  if (poiType === "chunk" || poiType === "startup") poi.type = poiType;

  if (zoneCheckbox.checked) {
    const x1 = Number(formData.get("x1"));
    const y1 = Number(formData.get("y1"));
    const x2 = Number(formData.get("x2"));
    const y2 = Number(formData.get("y2"));
    if ([x1, y1, x2, y2].some(Number.isNaN)) {
      statusEl.textContent = "fill x1/y1/x2/y2 (click the map twice)";
      statusEl.className = "dialog-status error";
      return undefined;
    }
    Object.assign(poi, { x1, y1, x2, y2 });
  } else {
    const x = Number(formData.get("x"));
    const y = Number(formData.get("y"));
    if ([x, y].some(Number.isNaN)) {
      statusEl.textContent = "fill x/y (click the map)";
      statusEl.className = "dialog-status error";
      return undefined;
    }
    Object.assign(poi, { x, y });
  }

  return poi;
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  statusEl.textContent = "";
  statusEl.className = "dialog-status";

  const poi = readPoiFromForm();
  if (!poi) return;

  const id = idInput.value;
  statusEl.textContent = "publishing...";

  try {
    const response = await fetch(id ? `/api/pois/${id}` : "/api/pois", {
      method: id ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(poi),
    });
    const data = (await response.json()) as { error?: string; ok?: boolean };
    if (!response.ok) {
      statusEl.textContent = data.error ?? "failed to publish";
      statusEl.className = "dialog-status error";
      return;
    }
    statusEl.textContent = "saved — click Deploy when you're ready to publish.";
    statusEl.className = "dialog-status success";
    setTimeout(() => window.location.reload(), 1200);
  } catch (error) {
    statusEl.textContent = String(error);
    statusEl.className = "dialog-status error";
  }
});

// --- manual deploy (batches however many edits/moves into one publish) ---

const deployButton = document.getElementById("deploy") as HTMLButtonElement;

deployButton.addEventListener("click", async () => {
  deployButton.disabled = true;
  const originalText = deployButton.textContent;
  deployButton.textContent = "Deploying...";

  try {
    const response = await fetch("/api/deploy", { method: "POST" });
    const data = (await response.json()) as { error?: string };
    if (!response.ok) {
      showToast(data.error ?? "failed to trigger deploy", true);
      return;
    }
    showToast("Deploy triggered — the viewer will update shortly.");
  } catch (error) {
    showToast(String(error), true);
  } finally {
    deployButton.disabled = false;
    deployButton.textContent = originalText;
  }
});

// --- render POIs: everything visible, click to edit, drag to move ---

async function saveMovedPoi(poi: AdminPoi, coords: Record<string, number>): Promise<void> {
  const { _id, ...rest } = poi;
  const updated = { ...rest, ...coords };
  try {
    const response = await fetch(`/api/pois/${_id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updated),
    });
    const data = (await response.json()) as { error?: string };
    if (!response.ok) {
      showToast(data.error ?? "failed to save new position", true);
      return;
    }
    showToast(`"${poi.title ?? "POI"}" moved — click Deploy when you're ready to publish.`);
  } catch (error) {
    showToast(String(error), true);
  }
}

const { listEntries } = renderPois(map, window.__initialPois, {
  onClick: openEditDialog,
  onMove: saveMovedPoi,
});

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
