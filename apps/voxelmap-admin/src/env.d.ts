/// <reference types="astro/client" />

import type { Session, User } from "better-auth";

declare global {
  namespace App {
    interface Locals {
      user: User | null;
      session: Session | null;
    }
  }
}

interface ImportMetaEnv {
  readonly MONGODB_URI: string;
  readonly BETTER_AUTH_URL: string;
  readonly BETTER_AUTH_SECRET: string;
  readonly GITHUB_TOKEN: string;
  readonly GITHUB_REPO: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
