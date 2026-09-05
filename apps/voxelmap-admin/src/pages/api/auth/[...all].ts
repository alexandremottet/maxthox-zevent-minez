import type { APIRoute } from "astro";
import { auth } from "../../../lib/auth.ts";

export const ALL: APIRoute = async (ctx) => {
  return auth.handler(ctx.request);
};
