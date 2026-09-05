import { betterAuth } from "better-auth";
import { mongodbAdapter } from "better-auth/adapters/mongodb";
import { MongoClient } from "mongodb";

function requireEnv(name: keyof ImportMetaEnv): string {
  const value = import.meta.env[name];
  if (!value) {
    throw new Error(
      `missing required env var: ${name}. See apps/voxelmap-admin/README.md for local dev setup.`,
    );
  }
  return value;
}

const mongoClient = new MongoClient(requireEnv("MONGODB_URI"));

export const auth = betterAuth({
  database: mongodbAdapter(mongoClient.db()),
  baseURL: requireEnv("BETTER_AUTH_URL"),
  secret: requireEnv("BETTER_AUTH_SECRET"),
  emailAndPassword: {
    enabled: true,
    // the one admin account is created by scripts/seed-admin.mjs, never through
    // the UI — no public registration for this single-admin tool
    disableSignUp: true,
  },
});
