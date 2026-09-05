interface PointOfInterestBase {
  /** omit for an unlabeled marker (no popup) */
  title?: string;
  description?: string;
  /** any CSS color, e.g. "red", "blue", "#3498db". Defaults to red. */
  color?: string;
  /**
   * defaults to none.
   * - "chunk" draws a red cross instead of the shine fill. On a point POI,
   *   (x, y) is treated as the chunk's origin corner and expanded to a 16x16
   *   block zone.
   * - "startup" points are shown by default; other points aren't (zones and
   *   chunks are always shown regardless of type).
   */
  type?: "chunk" | "startup";
}

export interface PointPointOfInterest extends PointOfInterestBase {
  x: number;
  y: number;
}

export interface ZonePointOfInterest extends PointOfInterestBase {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export type PointOfInterest = PointPointOfInterest | ZonePointOfInterest;

export function isZone(poi: PointOfInterest): poi is ZonePointOfInterest {
  return "x1" in poi;
}
