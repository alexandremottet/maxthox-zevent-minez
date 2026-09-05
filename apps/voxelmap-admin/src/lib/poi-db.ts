import type { PointOfInterest } from "map-render";
import { mongoClient } from "./mongo.ts";

const POI_COLLECTION = "pois";

function collection() {
  return mongoClient.db().collection<PointOfInterest>(POI_COLLECTION);
}

export async function listPois(): Promise<PointOfInterest[]> {
  const docs = await collection().find({}).toArray();
  return docs.map(({ _id, ...poi }) => poi as PointOfInterest);
}

export async function addPoi(poi: PointOfInterest): Promise<void> {
  await collection().insertOne(poi);
}
