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

// keeps the "chunkProgress" (level colors) and "chunkPercent" marker sets
// mutually exclusive, same as the Leaflet viewer's Filter panel — they color
// the same chunks two different ways. BlueMap has no built-in radio-group
// concept for marker sets and exposes no change event for one, so this polls
// the reactive MarkerSet.visible flags (found in the compiled webapp bundle:
// each root marker set is a MarkerSet instance stored in
// mapViewer.markers.markerSets, a Map keyed by id, with a `.visible`
// getter/setter) — fragile to a future BlueMap internals change, but
// defensive: it no-ops entirely if the expected shape isn't found.
(function enforceExclusivity() {
  const lastVisible = { chunkProgress: true, chunkPercent: false };

  function poll() {
    const markerSets = window.bluemap && window.bluemap.mapViewer && window.bluemap.mapViewer.markers && window.bluemap.mapViewer.markers.markerSets;
    if (markerSets && typeof markerSets.get === "function") {
      const chunkProgress = markerSets.get("chunkProgress");
      const chunkPercent = markerSets.get("chunkPercent");
      if (chunkProgress && chunkPercent) {
        if (chunkProgress.visible && chunkPercent.visible) {
          // whichever was already visible before this poll is the one to
          // hide — the other one is what the user just turned on
          if (lastVisible.chunkProgress) chunkProgress.visible = false;
          else chunkPercent.visible = false;
        }
        lastVisible.chunkProgress = chunkProgress.visible;
        lastVisible.chunkPercent = chunkPercent.visible;
      }
    }
    setTimeout(poll, 300);
  }
  poll();
})();
