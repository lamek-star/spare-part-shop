import { fetchDiagramImage } from "../../../../integrations/catalogues/intraforge-storage/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Serves a locally stored catalogue drawing to the browser, streamed
 * from IntraForge with this server's own credential (which never reaches
 * the browser). Only diagrams IntraForge itself marks LOCALLY_STORED
 * ever return bytes — anything else is a 404 — and the id is validated
 * as a UUID before it is put in a URL.
 */
export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get("id") ?? "";
  const upstream = await fetchDiagramImage(id).catch(() => null);
  if (!upstream || !upstream.body)
    return new Response("Not found", { status: 404 });
  const type = upstream.headers.get("content-type") ?? "";
  return new Response(upstream.body, {
    headers: {
      "Content-Type": /^image\/(png|jpeg)$/.test(type) ? type : "image/png",
      "Cache-Control": "private, max-age=86400",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
