import { ObjectId } from "mongodb";
import type { PointOfInterest } from "map-render";
import { mongoClient } from "./mongo.ts";

const POI_COLLECTION = "pois";

export type AdminPoi = PointOfInterest & { _id: string };

function collection() {
  return mongoClient.db().collection<PointOfInterest>(POI_COLLECTION);
}

export async function listPois(): Promise<AdminPoi[]> {
  const docs = await collection().find({}).toArray();
  return docs.map(({ _id, ...poi }) => ({ ...(poi as PointOfInterest), _id: _id.toString() }));
}

export async function addPoi(poi: PointOfInterest): Promise<void> {
  await collection().insertOne(poi);
}

export async function updatePoi(id: string, poi: PointOfInterest): Promise<void> {
  // full replace (not $set) so switching point <-> zone shape doesn't leave
  // stale fields (e.g. old x/y lingering after converting to a zone)
  await collection().replaceOne({ _id: new ObjectId(id) }, poi);
}

export async function deletePoi(id: string): Promise<void> {
  await collection().deleteOne({ _id: new ObjectId(id) });
}
