import { MongoClient } from "mongodb";
import { requireEnv } from "./env.ts";

// shared connection: used by both better-auth (auth.ts) and the POI store
// (poi-db.ts) so we don't open two separate clients
export const mongoClient = new MongoClient(requireEnv("MONGODB_URI"));
