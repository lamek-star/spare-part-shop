import { repository } from "../../../catalogue/server";
import {
  ColumnMapping,
  ImageRights,
  Verification,
} from "../../../catalogue/models";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
function failure(e: unknown) {
  const message = e instanceof Error ? e.message : "Unexpected catalogue error";
  return Response.json(
    { error: message },
    {
      status: message.startsWith("Permission denied")
        ? 403
        : message.includes("not found")
          ? 404
          : 400,
    },
  );
}
export async function GET(request: Request) {
  try {
    const q = new URL(request.url).searchParams;
    const role = request.headers.get("x-demo-role") ?? "Sales";
    const r = repository();
    const action = q.get("action") ?? "search";
    let data: unknown;
    switch (action) {
      case "search":
        data = r.search(
          q.get("q") ?? "",
          Number(q.get("page") ?? 1),
          20,
          q.get("variant") ?? "",
          q.get("category") ?? "",
          q.get("year") ?? "",
          q.get("engine") ?? "",
          q.get("model") ?? "",
          q.get("make") ?? "",
        );
        break;
      case "browse":
        data = r.browse(Object.fromEntries(q));
        break;
      case "part":
        data = r.detail(q.get("id") ?? "");
        break;
      case "diagram":
        data = r.diagram(q.get("id") ?? "");
        break;
      case "admin":
        data = r.overview(role);
        break;
      case "batch":
        data = r.batch(q.get("id") ?? "", role, Number(q.get("page") ?? 1));
        break;
      default:
        throw new Error("Unknown catalogue query.");
    }
    return Response.json(data, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return failure(e);
  }
}
export async function POST(request: Request) {
  try {
    const origin = request.headers.get("origin");
    if (origin && new URL(origin).host !== request.headers.get("host"))
      throw new Error(
        "Permission denied: cross-origin commands are not permitted.",
      );
    const reader = request.body?.getReader();
    if (!reader) throw new Error("Request body required.");
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      size += result.value.byteLength;
      if (size > 2_100_000) {
        await reader.cancel();
        throw new Error("Upload exceeds request limit.");
      }
      chunks.push(result.value);
    }
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<
      string,
      unknown
    >;
    const role = request.headers.get("x-demo-role") ?? "Sales";
    const r = repository();
    let data: unknown = { ok: true };
    switch (body.action) {
      case "stage":
        if (
          typeof body.csv !== "string" ||
          !body.mapping ||
          typeof body.mapping !== "object" ||
          Array.isArray(body.mapping)
        )
          throw new Error("CSV and column mapping required.");
        data = r.stage(
          body.csv,
          body.mapping as ColumnMapping,
          role,
          body.attested === true,
        );
        break;
      case "publish":
        data = r.publish(String(body.id), role);
        break;
      case "retry":
        data = r.retry(String(body.id), role);
        break;
      case "exclude":
        data = r.exclude(String(body.id), String(body.rowId), role);
        break;
      case "cancel":
        r.cancel(String(body.id), role);
        break;
      case "verify":
        r.verify(String(body.id), body.status as Verification, role);
        break;
      case "rights":
        r.imageRights(
          String(body.id),
          body.rights as ImageRights,
          String(body.evidence ?? ""),
          role,
        );
        break;
      case "relationship":
        r.addCrossReference(
          String(body.sourceId),
          String(body.targetId),
          body.type as import("../../../catalogue/models").CrossReference["type"],
          String(body.notes ?? ""),
          role,
        );
        break;
      default:
        throw new Error("Unknown catalogue command.");
    }
    return Response.json(data);
  } catch (e) {
    return failure(e);
  }
}
