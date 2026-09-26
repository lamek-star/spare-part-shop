import {
  catalogueStorageBearerToken,
  catalogueStorageEnabled,
  catalogueStorageIssuer,
} from "./config";
/**
 * Client for this app's own private OEM part/diagram catalogue, stored
 * in IntraForge. Same SSRF-safe URL-building discipline as
 * src/integrations/catalogues/toyota-epc/transport.ts and src/auth/oidc.ts
 * — `new URL(path, issuer)`, origin re-checked before every request.
 */
export interface IntraForgeDiagram {
  id: string;
  provider: string;
  provider_diagram_id: string;
  diagram_code: string;
  license_status: "EXTERNAL_REFERENCE_ONLY" | "LOCALLY_STORED";
  source_image_url: string;
  image_url: string | null;
  has_figure: boolean;
}
/** One production/fitment line of a part on a figure, as the provider
 * states it — a number can appear on several lines (variants). */
export interface FigureRow {
  part_number: string;
  description: string;
  valid_from: string | null;
  valid_to: string | null;
  is_current: boolean;
  fitment: { code: string; meaning: string | null }[];
  has_remarks: boolean;
}
export interface FigureGroup {
  callout: string;
  pnc: string;
  name: string;
  rect: { x: number; y: number; width: number; height: number } | null;
  rows: FigureRow[];
}
export interface FigureHotspot {
  label: string;
  pnc: string;
  resolved: boolean;
  rect: { x: number; y: number; width: number; height: number };
}
/** Display snapshot of a whole figure, stored on the IntraForge Diagram
 * (metadata only — never image bytes). */
export interface FigureData {
  figure_key: string;
  catalog: { region: string; catalog_code: string };
  hotspots: FigureHotspot[];
  groups: FigureGroup[];
}
export interface FigureImport {
  provider: string;
  provider_diagram_id: string;
  diagram_code: string;
  source_image_url: string;
  manufacturer: string;
  figure_data: FigureData;
}
export interface IntraForgeDiagramDetail extends IntraForgeDiagram {
  figure_data: Partial<FigureData>;
}
export interface IntraForgeDiagramPart {
  callout: string;
  x: number | null;
  y: number | null;
  width: number | null;
  height: number | null;
  diagram: IntraForgeDiagram;
}
export interface IntraForgeOEMPart {
  id: string;
  manufacturer: string;
  part_number: string;
  normalized_part_number: string;
  description: string;
  applicability: string;
  fitment_notes: string;
  diagram_parts: IntraForgeDiagramPart[];
}
/** One part+diagram+link to persist via POST .../oem-parts/import/ —
 * mirrors catalogue_storage/services.py's ImportRow (IntraForge side)
 * field-for-field. */
export interface ImportRow {
  part_number: string;
  description: string;
  manufacturer: string;
  diagram_code: string;
  provider: string;
  provider_diagram_id: string;
  callout?: string;
  source_image_url?: string;
  applicability?: string;
  fitment_notes?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
}
function issuerUrl(path: string): URL {
  const issuer = catalogueStorageIssuer();
  const url = new URL(path, issuer);
  if (url.origin !== new URL(issuer).origin) {
    throw new Error(
      `intraforge-storage: refused to request outside the configured issuer origin (${url.origin}).`,
    );
  }
  return url;
}
/** Returns null for "not found" (a normal, expected outcome — the part
 * simply isn't in the private catalogue yet), throws for anything else
 * (auth/network/server failure) so callers can tell the two apart. */
export async function searchOemPart(
  query: string,
): Promise<IntraForgeOEMPart | null> {
  if (!catalogueStorageEnabled()) {
    throw new Error(
      "intraforge-storage: not configured (INTRAFORGE_CATALOGUE_BEARER_TOKEN/INTRAFORGE_ISSUER).",
    );
  }
  const url = issuerUrl("/api/v1/catalogue/oem-parts/");
  url.searchParams.set("q", query);
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${catalogueStorageBearerToken()}`,
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(8000),
  });
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(
      `intraforge-storage: search failed with status ${response.status}.`,
    );
  }
  return (await response.json()) as IntraForgeOEMPart;
}
/** Persists exactly one resolved part+diagram+link — the cache-miss
 * fallback path, never a bulk write (one call = one part, see
 * ImportRow). */
export async function importOemPart(
  row: ImportRow,
): Promise<IntraForgeOEMPart> {
  if (!catalogueStorageEnabled()) {
    throw new Error(
      "intraforge-storage: not configured (INTRAFORGE_CATALOGUE_BEARER_TOKEN/INTRAFORGE_ISSUER).",
    );
  }
  const response = await fetch(
    issuerUrl("/api/v1/catalogue/oem-parts/import/"),
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${catalogueStorageBearerToken()}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(row),
      signal: AbortSignal.timeout(8000),
    },
  );
  if (!response.ok) {
    throw new Error(
      `intraforge-storage: import failed with status ${response.status}.`,
    );
  }
  return (await response.json()) as IntraForgeOEMPart;
}
/** The stored figure snapshot for a diagram — served from IntraForge's own
 * database, so it works with no external access. Null when the diagram
 * has none (yet) or doesn't exist. */
export async function getDiagramFigure(
  diagramId: string,
): Promise<IntraForgeDiagramDetail | null> {
  if (!catalogueStorageEnabled()) {
    throw new Error(
      "intraforge-storage: not configured (INTRAFORGE_CATALOGUE_BEARER_TOKEN/INTRAFORGE_ISSUER).",
    );
  }
  if (!/^[0-9a-f-]{36}$/i.test(diagramId)) return null;
  const response = await fetch(
    issuerUrl(`/api/v1/catalogue/diagrams/${diagramId}/`),
    {
      headers: {
        Authorization: `Bearer ${catalogueStorageBearerToken()}`,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(8000),
    },
  );
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(
      `intraforge-storage: diagram lookup failed with status ${response.status}.`,
    );
  }
  return (await response.json()) as IntraForgeDiagramDetail;
}
/** Persists one whole figure (its snapshot plus every part number on it
 * as a searchable record) — still bounded to the single figure the
 * caller just fetched, never a crawl. */
export async function importFigure(
  payload: FigureImport,
): Promise<IntraForgeDiagramDetail> {
  if (!catalogueStorageEnabled()) {
    throw new Error(
      "intraforge-storage: not configured (INTRAFORGE_CATALOGUE_BEARER_TOKEN/INTRAFORGE_ISSUER).",
    );
  }
  const response = await fetch(
    issuerUrl("/api/v1/catalogue/diagrams/import/"),
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${catalogueStorageBearerToken()}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(30000),
    },
  );
  if (!response.ok) {
    throw new Error(
      `intraforge-storage: figure import failed with status ${response.status}.`,
    );
  }
  return (await response.json()) as IntraForgeDiagramDetail;
}
/** Streams a locally stored drawing from IntraForge (the bearer token stays
 * on the server; the browser is served through /api/catalogue/diagram-image). */
export async function fetchDiagramImage(
  diagramId: string,
): Promise<Response | null> {
  if (!catalogueStorageEnabled()) return null;
  if (!/^[0-9a-f-]{36}$/i.test(diagramId)) return null;
  const response = await fetch(
    issuerUrl(`/api/v1/catalogue/diagrams/${diagramId}/image/`),
    {
      headers: { Authorization: `Bearer ${catalogueStorageBearerToken()}` },
      signal: AbortSignal.timeout(15000),
    },
  );
  return response.ok ? response : null;
}
