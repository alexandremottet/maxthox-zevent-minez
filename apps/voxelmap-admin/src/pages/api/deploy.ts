import type { APIRoute } from "astro";
import { triggerDeploy } from "../../lib/github.ts";

export const POST: APIRoute = async ({ locals }) => {
  if (!locals.session) {
    return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 });
  }

  try {
    await triggerDeploy();
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: String(error) }), { status: 500 });
  }
};
