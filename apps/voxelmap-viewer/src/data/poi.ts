import poiData from "./poi.json";

interface PointOfInterestBase {
  title: string;
  description?: string;
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

export const pois: PointOfInterest[] = poiData;
