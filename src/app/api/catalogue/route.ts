import { repository } from "../../../catalogue/server";
import {
  ColumnMapping,
  ImageRights,
  Verification,
  isCatalogueAdmin,
} from "../../../catalogue/models";
import { providerPolicies, policyFor } from "../../../catalogue/providerPolicy";
import { toyotaEpcProvider } from "../../../integrations/catalogues/toyota-epc";
import { toyotaEpcEnabled } from "../../../integrations/catalogues/toyota-epc/config";
import {
  searchOemPart,
  getDiagramFigure,
} from "../../../integrations/catalogues/intraforge-storage/client";
import {
  catalogueStorageEnabled,
  externalDiagramImagesEnabled,
} from "../../../integrations/catalogues/intraforge-storage/config";
import { resolveToyotaOemPart } from "../../../integrations/catalogues/intraforge-storage/toyotaResolver";
import {
  startImportJob,
  retryFailedItems,
  parseImportLines,
  persistResolvedFigure,
  type ImportLine,
} from "../../../catalogue/importRunner";
import {
  listImportJobs,
  getImportJob,
  requestCancelImportJob,
  recordOfflineIndex,
  offlineReadiness,
} from "../../../catalogue/importStore";
/**
 * Every `toyota-*` action below runs through `toyotaEpcProvider`, which
 * refuses before any network call unless TOYOTA_EPC_ENABLED=true (see
 * providerPolicy.ts and the Toyota provider's own doc comment). A refusal
 * is reported as `{ disabled: true, reason, capabilities, license }` with
 * a normal 200 status rather than an error, so the frontend can render a
 * clean "disabled" panel instead of a generic failure banner — this is
 * the expected production response, not an outage.
 */
async function toyotaAction<T>(run: () => Promise<T>) {
  try {
    return await run();
  } catch (e) {
    const message =
      e instanceof Error ? e.message : "Toyota EPC request failed.";
    if (/disabled/i.test(message)) {
      const policy = policyFor("toyota-epc");
      return {
        disabled: true,
        reason: message,
        capabilities: policy.capabilities,
        license: policy.license,
      };
    }
    throw e;
  }
}
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
      case "providers":
        if (!isCatalogueAdmin(role))
          throw new Error(
            "Permission denied: catalogue provider governance requires Owner or Administrator.",
          );
        data = Object.values(providerPolicies).map((p) => ({
          ...p,
          liveConnectivity: "not checked" as const,
        }));
        break;
      case "toyota-browse":
        data = await toyotaAction(() =>
          toyotaEpcProvider.browse(Object.fromEntries(q)),
        );
        break;
      case "toyota-search-parts":
        data = await toyotaAction(() =>
          toyotaEpcProvider.searchParts(
            q.get("q") ?? "",
            Number(q.get("page") ?? 1),
          ),
        );
        break;
      case "toyota-models":
        data = await toyotaAction(() =>
          toyotaEpcProvider.getModels(q.get("region") || "EU"),
        );
        break;
      case "toyota-model":
        data = await toyotaAction(() =>
          toyotaEpcProvider.getModel(
            q.get("region") || "EU",
            q.get("slug") ?? "",
          ),
        );
        break;
      case "toyota-sections":
        data = await toyotaAction(() =>
          toyotaEpcProvider.getSections(
            q.get("region") || "EU",
            q.get("catalog") ?? "",
          ),
        );
        break;
      case "toyota-diagram":
        data = await toyotaAction(() =>
          toyotaEpcProvider.getDiagram(
            `${q.get("region") || "EU"}/${q.get("catalog") ?? ""}/${q.get("figure") ?? ""}`,
          ),
        );
        break;
      case "toyota-part":
        data = await toyotaAction(() =>
          toyotaEpcProvider.getPart(q.get("number") ?? ""),
        );
        break;
      case "toyota-search":
        data = await toyotaAction(() =>
          toyotaEpcProvider.search(
            q.get("q") ?? "",
            q.get("region") || undefined,
          ),
        );
        break;
      case "toyota-vin":
        data = await toyotaAction(() =>
          toyotaEpcProvider.lookupVin(q.get("vin") ?? ""),
        );
        break;
      case "toyota-history":
        data = await toyotaAction(() =>
          toyotaEpcProvider.getSupersessions(
            q.get("number") ?? "",
            q.get("region") || "EU",
          ),
        );
        break;
      case "toyota-status":
        data = {
          enabled: toyotaEpcEnabled(),
          ...policyFor("toyota-epc"),
        };
        break;
      case "oem-search": {
        // The private, IntraForge-backed OEM catalogue — see
        // docs/CATALOGUE_STORAGE.md. Distinct from the toyota-* actions
        // above (a live, unpersisted pass-through to an unlicensed third
        // party): this searches this app's own permitted, persisted
        // records only.
        if (!catalogueStorageEnabled()) {
          data = {
            disabled: true,
            reason: "Catalogue storage is not configured.",
          };
          break;
        }
        const query = q.get("q") ?? "";
        let part = await searchOemPart(query);
        if (!part) {
          // Cache miss: resolve live from Toyota EPC (if permitted/
          // enabled) and persist exactly this one part — "only the
          // data will be stored in the intraforge storage when user
          // search" — never a bulk fetch. Metadata only; the image stays
          // EXTERNAL_REFERENCE_ONLY unless a separately-licensed import
          // says otherwise (see docs/CATALOGUE_STORAGE.md).
          const resolved = await resolveToyotaOemPart(query).catch(() => null);
          if (resolved)
            part = await persistResolvedFigure(resolved).catch(() => null);
        }
        if (part) recordOfflineIndex(part);
        // The stored snapshot of the whole figure this part is drawn on
        // (every part number on it), read from IntraForge's own database —
        // so the complete list works with the provider off.
        // A part can be drawn on several figures (one per vehicle); return
        // the snapshot of each so the visitor can switch between them.
        const figures: Record<string, unknown> = {};
        for (const dp of (part?.diagram_parts ?? []).slice(0, 6)) {
          const detail = await getDiagramFigure(dp.diagram.id).catch(
            () => null,
          );
          figures[dp.diagram.id] = detail?.figure_data?.groups
            ? detail.figure_data
            : null;
        }
        data = part
          ? {
              found: true,
              part,
              figures,
              showExternalImages: externalDiagramImagesEnabled(),
            }
          : { found: false, providerEnabled: toyotaEpcEnabled() };
        break;
      }
      case "import-jobs":
        if (!isCatalogueAdmin(role))
          throw new Error(
            "Permission denied: catalogue import requires Owner or Administrator.",
          );
        data = listImportJobs(Number(q.get("limit") ?? 50));
        break;
      case "import-job": {
        if (!isCatalogueAdmin(role))
          throw new Error(
            "Permission denied: catalogue import requires Owner or Administrator.",
          );
        const job = getImportJob(q.get("id") ?? "");
        if (!job) throw new Error("Import job not found.");
        data = job;
        break;
      }
      case "import-overview":
        if (!isCatalogueAdmin(role))
          throw new Error(
            "Permission denied: catalogue import requires Owner or Administrator.",
          );
        data = offlineReadiness();
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
      case "import-start": {
        if (!isCatalogueAdmin(role))
          throw new Error(
            "Permission denied: catalogue import requires Owner or Administrator.",
          );
        let lines: ImportLine[];
        if (Array.isArray(body.lines)) {
          lines = (body.lines as unknown[])
            .map((l) =>
              typeof l === "string" ? { part_number: l } : (l as ImportLine),
            )
            .filter(
              (l) => typeof l?.part_number === "string" && l.part_number.trim(),
            );
        } else if (typeof body.text === "string") {
          lines = parseImportLines(body.text);
        } else {
          throw new Error(
            "Provide either lines (array) or text (pasted list).",
          );
        }
        data = await startImportJob({
          lines,
          createdBy: role,
          useProvider: body.useProvider !== false,
          batchSize:
            body.batchSize !== undefined ? Number(body.batchSize) : undefined,
          delayMs:
            body.delayMs !== undefined ? Number(body.delayMs) : undefined,
        });
        break;
      }
      case "import-cancel":
        if (!isCatalogueAdmin(role))
          throw new Error(
            "Permission denied: catalogue import requires Owner or Administrator.",
          );
        data = { ok: requestCancelImportJob(String(body.id)) };
        break;
      case "import-retry":
        if (!isCatalogueAdmin(role))
          throw new Error(
            "Permission denied: catalogue import requires Owner or Administrator.",
          );
        data = await retryFailedItems(String(body.id), role);
        break;
      default:
        throw new Error("Unknown catalogue command.");
    }
    return Response.json(data);
  } catch (e) {
    return failure(e);
  }
}
