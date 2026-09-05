import poiData from "./poi.json";
import type { PointOfInterest } from "map-render";

export type { PointOfInterest, PointPointOfInterest, ZonePointOfInterest } from "map-render";
export { isZone } from "map-render";

// JSON imports widen string literal fields (e.g. "type") to plain `string`,
// so TS can't structurally verify the union here — trusted cast instead.
export const pois: PointOfInterest[] = poiData as PointOfInterest[];
