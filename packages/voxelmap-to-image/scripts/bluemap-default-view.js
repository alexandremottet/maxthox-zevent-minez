// enables the chunk-border overlay by default — there's no server-side config
// for this (only a client toggle), so we flip it on startup via BlueMap's
// custom-script hook. Uses window.bluemap.setChunkBorders, an internal (not
// officially documented) API found in BlueMap's compiled webapp bundle — if
// a BlueMap version upgrade breaks this, re-check for the method name.
(function poll() {
  if (window.bluemap && typeof window.bluemap.setChunkBorders === "function") {
    window.bluemap.setChunkBorders(true);
  } else {
    setTimeout(poll, 200);
  }
})();

// hides BlueMap's own UI chrome (toolbar/sidebar, mounted at #app — see
// index.html, separate from the #map-container canvas), so the published
// site shows a clean map with no BlueMap controls while local dev keeps them
// for testing/debugging. The outer viewer/admin page appends ?bluemapControls
// to this iframe's src only when built with `astro dev` (import.meta.env.DEV)
// — NOT just "is this localhost", since `astro preview` also serves from
// localhost but is meant to show real production behavior. A <style> rule
// applies as soon as #app appears, no DOM-ready wait needed.
if (!new URLSearchParams(location.search).has("bluemapControls")) {
  const style = document.createElement("style");
  style.textContent = "#app { display: none !important; }";
  document.head.appendChild(style);
}

// Mutual exclusivity between chunk-level colors and the percent overlay, and
// keeping this in sync with the Leaflet Filter panel, is now handled from the
// viewer's outer page (map.ts: toggleCategory/syncFiltersToBlueMap), which
// reaches into this iframe directly since it's same-origin — the Filter panel
// is the one shared control surface for both visualizers. A poll used to live
// here duplicating that logic against the old single "chunkProgress" set (now
// split per level: done/almost/ongoing/started); removed as redundant.
