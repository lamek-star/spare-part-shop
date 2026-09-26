import { toyotaEpcProvider } from "../toyota-epc";
import { normalizeNumber } from "../../../domain/models";
import { TOYOTA_EPC_BASE_URL, toyotaEpcEnabled } from "../toyota-epc/config";
import type { ToyotaFigure, ToyotaPart } from "../toyota-epc/types";
import type {
  FigureData,
  FigureGroup,
  FigureImport,
  FigureRow,
} from "./client";

/**
 * Resolves ONE OEM part number against the *live* Toyota EPC source and
 * returns the whole figure it is drawn on, ready to persist in IntraForge
 * (see docs/CATALOGUE_STORAGE.md and docs/CATALOGUE_IMPORT.md). Used
 * only as a cache-miss fallback from the search endpoint and by the
 * admin warm-up job — never a crawl: exactly one search, one sections
 * lookup and one figure fetch, plus at most two further figure fetches
 * (via the part's own group) only when the part is not on the section's
 * primary drawing.
 *
 * Every part line on that one figure is kept, not only the searched
 * number, so the drawing's complete parts list can be shown offline.
 * Returns null (not an error) whenever nothing genuinely resolves —
 * never fabricates a diagram/callout/applicability the source doesn't
 * actually provide.
 */
export interface ResolvedToyotaPart {
  /** The number as the source displays it, e.g. "15690-65010". */
  partNumber: string;
  figure: FigureImport;
}

const MAX_FIGURE_ATTEMPTS = 3;

function toRow(part: ToyotaPart): FigureRow {
  const seen = new Set<string>();
  const fitment: FigureRow["fitment"] = [];
  for (const f of part.fitment) {
    if (!f.code || seen.has(f.code)) continue;
    seen.add(f.code);
    fitment.push({ code: f.code, meaning: f.meaning });
  }
  return {
    part_number: part.part_number_display,
    description: part.name,
    valid_from: part.valid.from,
    valid_to: part.valid.to,
    is_current: part.is_current,
    fitment,
    has_remarks: part.has_remarks,
  };
}

export function buildFigureData(figure: ToyotaFigure): FigureData {
  const rect = (r: ToyotaFigure["hotspots"][number]["rect"]) => ({
    x: r.x1,
    y: r.y1,
    width: r.x2 - r.x1,
    height: r.y2 - r.y1,
  });
  const groups: FigureGroup[] = [];
  const seenPnc = new Set<string>();
  for (const hotspot of figure.hotspots) {
    if (!hotspot.resolved || seenPnc.has(hotspot.pnc)) continue;
    seenPnc.add(hotspot.pnc);
    groups.push({
      callout: hotspot.label,
      pnc: hotspot.pnc,
      name: hotspot.name,
      rect: rect(hotspot.rect),
      rows: figure.parts.filter((p) => p.pnc === hotspot.pnc).map(toRow),
    });
  }
  return {
    figure_key: figure.figure_key,
    catalog: figure.catalog,
    hotspots: figure.hotspots.map((h) => ({
      label: h.label,
      pnc: h.pnc,
      resolved: h.resolved,
      rect: rect(h.rect),
    })),
    groups,
  };
}

export async function resolveToyotaOemPart(
  query: string,
  /** Optional vehicle catalogue code (e.g. "221230"): a part is sold on
   * many vehicles and each has its own drawing, so this picks which. */
  catalog?: string,
): Promise<ResolvedToyotaPart | null> {
  if (!toyotaEpcEnabled()) return null;
  const normalized = normalizeNumber(query);
  if (!normalized) return null;

  const searchResult = await toyotaEpcProvider.search(query);
  const wanted = catalog?.trim().toUpperCase();
  const match = searchResult.results.part_numbers.find(
    (p) =>
      normalizeNumber(p.part_number) === normalized &&
      (!wanted || p.catalog_code.toUpperCase() === wanted),
  );
  if (!match) return null;

  const sections = await toyotaEpcProvider.getSections(
    match.region,
    match.catalog_code,
  );
  const section = sections.find((s) => s.section_code === match.section_code);
  const candidates: string[] = section?.primary_figure
    ? [section.primary_figure]
    : [];

  let groupLoaded = false;
  for (let attempt = 0; attempt < MAX_FIGURE_ATTEMPTS; attempt++) {
    if (!candidates[attempt] && !groupLoaded) {
      // No (further) candidate on the section's primary drawing: ask the
      // part's own group which figures it appears on.
      groupLoaded = true;
      const group = await toyotaEpcProvider.getPartGroup(
        match.region,
        match.catalog_code,
        match.pnc,
      );
      for (const key of group.figures)
        if (!candidates.includes(key)) candidates.push(key);
    }
    const key = candidates[attempt];
    if (!key) return null;
    const figure = await toyotaEpcProvider.getFigure(
      match.region as "EU" | "GR" | "US" | "JP",
      match.catalog_code,
      key,
    );
    const hit = figure.parts.find(
      (p) => normalizeNumber(p.part_number) === normalized,
    );
    if (!hit) continue;
    const data = buildFigureData(figure);
    return {
      partNumber: hit.part_number_display,
      figure: {
        provider: "toyota-epc",
        provider_diagram_id: figure.figure_key,
        diagram_code: figure.figure_key,
        source_image_url: new URL(
          figure.image.url,
          TOYOTA_EPC_BASE_URL,
        ).toString(),
        manufacturer: "Toyota",
        figure_data: data,
      },
    };
  }
  return null;
}
