import type { APIRoute } from "astro";
import type { PointOfInterest } from "map-render";
import { addPoi } from "../../lib/poi-db.ts";
import { triggerDeploy } from "../../lib/github.ts";

function isValidPoi(body: unknown): body is PointOfInterest {
  if (typeof body !== "object" || body === null) return false;
  const poi = body as Record<string, unknown>;
  if (poi.title !== undefined && typeof poi.title !== "string") return false;
  if (poi.description !== undefined && typeof poi.description !== "string") return false;
  if (poi.color !== undefined && typeof poi.color !== "string") return false;
  if (poi.type !== undefined && poi.type !== "chunk") return false;

  const hasPoint = typeof poi.x === "number" && typeof poi.y === "number";
  const hasZone =
    typeof poi.x1 === "number" &&
    typeof poi.y1 === "number" &&
    typeof poi.x2 === "number" &&
    typeof poi.y2 === "number";

  return hasPoint || hasZone;
}

export const POST: APIRoute = async ({ request, locals }) => {
  if (!locals.session) {
    return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: "invalid JSON body" }), { status: 400 });
  }

  if (!isValidPoi(body)) {
    return new Response(JSON.stringify({ error: "invalid POI: needs x/y or x1/y1/x2/y2" }), { status: 400 });
  }

  try {
    await addPoi(body);
    await triggerDeploy();
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: String(error) }), { status: 500 });
  }
};
