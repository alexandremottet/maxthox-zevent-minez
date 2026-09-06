// Interactive checklist for the various map/data generation steps scattered
// across this repo's packages — pick which ones to run (space to toggle,
// enter to confirm, like changesets' CLI), then they run in the correct
// pipeline order regardless of the order you checked them in.
//
//   pnpm run generate
import { execSync } from "node:child_process";
import * as p from "@clack/prompts";

// `order` encodes the pipeline's real dependency chain (voxelmap-to-image's
// raw output -> map-render's embedded data -> BlueMap, which reads that
// embedded data back out) as a flat sequence, since it's linear enough that a
// full dependency graph would be overkill — running selected steps sorted by
// `order` is enough to always get correct results.
const STEPS = [
  {
    id: "voxelmap-map",
    label: "Generate map image (voxelmap-to-image)",
    hint: "reads VoxelMap cache zips -> out/map-*.png + heights-*.bin",
    order: 0,
    cmd: "pnpm --filter voxelmap-to-image run map",
  },
  {
    id: "map-render-embed",
    label: "Embed map image into map-render",
    hint: "out/*.png + heights -> map-render/src/map-data.ts",
    order: 1,
    cmd: "pnpm --filter map-render run generate-map",
  },
  {
    id: "chunk-scanner",
    label: "Scan VoxelMap cache for dug chunks",
    hint: "classifies chunks by % of columns reaching depth-threshold against levels.json, writes to MongoDB (needs MONGODB_URI)",
    order: 2,
    cmd: "pnpm --filter chunk-scanner run scan",
  },
  {
    id: "fetch-pois",
    label: "Fetch POIs from MongoDB",
    hint: "pois collection -> map-render/src/poi-data.ts (needs MONGODB_URI)",
    order: 3,
    cmd: "pnpm --filter map-render run fetch-pois",
  },
  {
    id: "blockdata-scanner",
    label: "Scan real world save for percent-dug data",
    hint: "reads the WDL save's region files -> map-render/src/percent-data.ts",
    order: 4,
    cmd: "pnpm --filter blockdata-scanner run scan",
  },
  {
    id: "bluemap",
    label: "Render + publish BlueMap",
    hint: "renders the WDL save with BlueMap, publishes to both apps' public/bluemap",
    order: 5,
    cmd: "pnpm --filter voxelmap-to-image run bluemap",
  },
  {
    id: "viewer-build",
    label: "Build the viewer app",
    hint: "clears Astro/Vite caches, then astro build (picks up everything above)",
    order: 6,
    cmd:
      "rm -rf apps/voxelmap-viewer/.astro apps/voxelmap-viewer/node_modules/.vite apps/voxelmap-viewer/dist && " +
      "pnpm --filter voxelmap-viewer build",
  },
];

async function main() {
  p.intro("minez — generation pipeline");

  const selected = await p.multiselect({
    message: "Which steps do you want to run? (space to toggle, enter to confirm)",
    options: STEPS.map((step) => ({ value: step.id, label: step.label, hint: step.hint })),
    required: true,
  });

  if (p.isCancel(selected)) {
    p.cancel("Cancelled.");
    process.exit(1);
  }

  const toRun = STEPS.filter((step) => selected.includes(step.id)).sort((a, b) => a.order - b.order);
  const repoRoot = new URL("..", import.meta.url);

  // stdio:"inherit" (not a spinner) deliberately — several of these commands
  // (bluemap especially) take minutes and print their own progress, which a
  // spinner animation would just garble
  for (const step of toRun) {
    p.log.step(step.label);
    try {
      execSync(step.cmd, { stdio: "inherit", cwd: repoRoot });
    } catch (error) {
      p.outro(`Stopped — ${step.label} failed: ${error.message}`);
      process.exit(1);
    }
  }

  p.outro("All selected steps completed.");
}

main();
