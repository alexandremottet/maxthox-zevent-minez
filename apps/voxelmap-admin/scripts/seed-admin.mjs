// One-off script: creates the single admin account. Run locally with the real
// env vars set (never through the deployed app — public sign-up is disabled).
//
//   MONGODB_URI=... BETTER_AUTH_SECRET=... ADMIN_EMAIL=... ADMIN_PASSWORD=... \
//     pnpm --filter voxelmap-admin run seed-admin

import { betterAuth } from "better-auth";
import { mongodbAdapter } from "better-auth/adapters/mongodb";
import { MongoClient } from "mongodb";

const { MONGODB_URI, BETTER_AUTH_SECRET, ADMIN_EMAIL, ADMIN_PASSWORD } = process.env;

for (const [name, value] of Object.entries({ MONGODB_URI, BETTER_AUTH_SECRET, ADMIN_EMAIL, ADMIN_PASSWORD })) {
  if (!value) {
    console.error(`missing required env var: ${name}`);
    process.exit(1);
  }
}

const mongoClient = new MongoClient(MONGODB_URI);

const auth = betterAuth({
  database: mongodbAdapter(mongoClient.db()),
  secret: BETTER_AUTH_SECRET,
  emailAndPassword: { enabled: true },
});

// bypasses the HTTP-level disableSignUp restriction — this is a direct server call
await auth.api.signUpEmail({
  body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD, name: "Admin" },
});

console.log(`admin account created: ${ADMIN_EMAIL}`);
await mongoClient.close();
