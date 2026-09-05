import { betterAuth } from "better-auth";
import { mongodbAdapter } from "better-auth/adapters/mongodb";
import { requireEnv } from "./env.ts";
import { mongoClient } from "./mongo.ts";

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
