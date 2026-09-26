"use client";
import { useState } from "react";
import { Services } from "../services/contracts";
import { Field } from "./ui";
import OEMFigureViewer from "./OEMFigureViewer";
import type {
  FigureData,
  FigureRow,
} from "../integrations/catalogues/intraforge-storage/client";
import { normalizeNumber } from "../domain/models";

interface DiagramInfo {
  id: string;
  provider: string;
  diagram_code: string;
  license_status: "EXTERNAL_REFERENCE_ONLY" | "LOCALLY_STORED";
  source_image_url: string;
  image_url: string | null;
}
interface DiagramPartInfo {
  callout: string;
  x: number | null;
  y: number | null;
  width: number | null;
  height: number | null;
  diagram: DiagramInfo;
}
interface OEMPartResult {
  id: string;
  manufacturer: string;
  part_number: string;
  normalized_part_number: string;
  description: string;
  applicability: string;
  fitment_notes: string;
  diagram_parts: DiagramPartInfo[];
}
/** Where the browser loads a stored drawing from: this app's own proxy
 * (IntraForge's URL needs a server-side credential the browser never has). */
const storedDrawing = (d: DiagramInfo) =>
  d.license_status === "LOCALLY_STORED" && d.image_url
    ? `/api/catalogue/diagram-image?id=${encodeURIComponent(d.id)}`
    : "";
/** Stock is this app's own commercial concern — checked against the
 * existing My Products/Inventory data, never against the catalogue
 * record itself (see docs/CATALOGUE_STORAGE.md "Never overwrite
 * catalogue data with customer pricing"). Matches purely by normalized
 * OEM number against existing PartNumber rows -- no new stock/purchase
 * model was added. */
function stockFor(
  services: Services,
  normalized: string,
): { partId: string; available: number } | null {
  const snapshot = services.snapshot();
  const number = snapshot.numbers.find((n) => n.normalized === normalized);
  if (!number) return null;
  const available = services.inventory
    .list()
    .filter((s) => s.partId === number.partId)
    .reduce((sum, s) => sum + s.available, 0);
  return { partId: number.partId, available };
}

/**
 * The simplified OEM workflow this app actually needs (see
 * docs/CATALOGUE_STORAGE.md): search a part number in any format →
 * show the part, its diagram/callout, and an ADD button — never a full
 * vehicle/EPC hierarchy. Backed by this app's own private,
 * IntraForge-stored catalogue (src/integrations/catalogues/
 * intraforge-storage), not the live Toyota EPC pass-through below (a
 * separate, unpersisted, unlicensed-for-storage integration — see
 * ReferenceCatalogue.tsx). ADD requires a real IntraForge sign-in,
 * checked here via /api/auth/me; an anonymous visitor is sent to
 * /auth/login with this page as the return destination.
 */
export default function OEMPartSearch({ services }: { services: Services }) {
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<OEMPartResult | null | undefined>(
    undefined,
  ); // undefined = not searched yet
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [added, setAdded] = useState(false);
  const [providerOff, setProviderOff] = useState(false);
  const [figures, setFigures] = useState<
    Record<string, Partial<FigureData> | null>
  >({});
  const [diagramIndex, setDiagramIndex] = useState(0);
  const [showExternalImages, setShowExternalImages] = useState(false);
  const [addedKeys, setAddedKeys] = useState<Set<string>>(new Set());

  async function search(e: React.FormEvent) {
    e.preventDefault();
    if (!query.trim()) return;
    setLoading(true);
    setError("");
    setAdded(false);
    setAddedKeys(new Set());
    setFigures({});
    setDiagramIndex(0);
    try {
      const res = await fetch(
        `/api/catalogue?action=oem-search&q=${encodeURIComponent(query)}`,
      );
      const body = await res.json();
      if (body.disabled) {
        setError(body.reason || "Catalogue storage is not available.");
        setResult(null);
      } else if (body.found) {
        setResult(body.part as OEMPartResult);
        const found = body.part as OEMPartResult;
        const byId = (body.figures ?? {}) as Record<
          string,
          Partial<FigureData> | null
        >;
        setFigures(byId);
        // Open on a drawing we hold the picture of, else any with a parts list.
        const best = found.diagram_parts.findIndex(
          (dp) => storedDrawing(dp.diagram) && byId[dp.diagram.id],
        );
        const anyFigure = found.diagram_parts.findIndex(
          (dp) => byId[dp.diagram.id],
        );
        setDiagramIndex(best >= 0 ? best : Math.max(anyFigure, 0));
        setShowExternalImages(body.showExternalImages === true);
      } else {
        setResult(null);
        setProviderOff(body.providerEnabled === false);
      }
    } catch {
      setError("Search failed. Please try again.");
      setResult(null);
    } finally {
      setLoading(false);
    }
  }

  /** ADD needs a real IntraForge sign-in; an anonymous visitor is sent to
   * /auth/login and returned here afterwards. */
  async function signedIn() {
    const me = await fetch("/api/auth/me")
      .then((r) => r.json())
      .catch(() => ({ signedIn: false }));
    if (!me.signedIn) {
      const returnTo = window.location.pathname + window.location.search;
      window.location.assign(
        `/auth/login?returnTo=${encodeURIComponent(returnTo)}`,
      );
      return false;
    }
    return true;
  }
  async function handleAdd() {
    if (!result || !(await signedIn())) return;
    services.enquiries.addItem({
      oemNumber: result.part_number,
      partName: result.description || result.part_number,
      vehicleDescription: "",
      quantity: 1,
      providerKey: "intraforge-catalogue",
      sourceUrl: result.diagram_parts[0]?.diagram.source_image_url || "",
    });
    setAdded(true);
    setAddedKeys((keys) => new Set(keys).add(result.normalized_part_number));
  }
  async function handleAddRow(row: FigureRow) {
    if (!(await signedIn())) return;
    services.enquiries.addItem({
      oemNumber: row.part_number,
      partName: row.description || row.part_number,
      vehicleDescription: "",
      quantity: 1,
      providerKey: "intraforge-catalogue",
      sourceUrl: result?.diagram_parts[0]?.diagram.source_image_url || "",
    });
    setAddedKeys((keys) => new Set(keys).add(normalizeNumber(row.part_number)));
  }

  const diagramPart = result?.diagram_parts[diagramIndex];
  const figure = diagramPart ? (figures[diagramPart.diagram.id] ?? null) : null;
  const stock = result
    ? stockFor(services, result.normalized_part_number)
    : null;

  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h3>OEM Part Search</h3>
          <small className="muted">
            Search by part number (15690-65010, 1569065010, or 15690 65010 — all
            resolve to the same part) or by name.
          </small>
        </div>
      </div>

      <form onSubmit={search} className="toolbar oem-search">
        <Field label="OEM part number or name">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="e.g. 15690-65010 or oil cooler"
          />
        </Field>
        <button type="submit" className="primary" disabled={loading}>
          {loading ? "Searching…" : "Search"}
        </button>
      </form>

      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}

      {result === null && !error && (
        <p className="empty">
          No matching part found in the catalogue.
          {providerOff &&
            " It is not in the offline catalogue yet — an administrator can add it under Catalogue → Import / Warm Up while the provider is online."}
        </p>
      )}

      {result && (
        <div className="reference-diagrams">
          <p>
            <strong>{result.manufacturer}</strong> · {result.part_number}
          </p>
          <p className="muted">{result.description || "—"}</p>
          {(result.applicability || result.fitment_notes) && (
            <p className="muted">
              {result.applicability && <>{result.applicability}</>}
              {result.applicability && result.fitment_notes && " · "}
              {result.fitment_notes}
            </p>
          )}

          {result.diagram_parts.length > 1 && (
            <div className="oem-drawings" role="group" aria-label="Drawings">
              <span className="muted">
                Drawn on {result.diagram_parts.length} figures:
              </span>
              {result.diagram_parts.map((dp, i) => (
                <button
                  key={dp.diagram.id}
                  type="button"
                  className={i === diagramIndex ? "primary" : ""}
                  aria-pressed={i === diagramIndex}
                  onClick={() => setDiagramIndex(i)}
                >
                  {dp.diagram.diagram_code}
                </button>
              ))}
            </div>
          )}
          {figure && diagramPart && (
            <OEMFigureViewer
              figure={figure}
              diagramCode={diagramPart.diagram.diagram_code}
              provider={diagramPart.diagram.provider}
              imageUrl={
                storedDrawing(diagramPart.diagram) ||
                (showExternalImages ? diagramPart.diagram.source_image_url : "")
              }
              stored={Boolean(storedDrawing(diagramPart.diagram))}
              sourceImageUrl={diagramPart.diagram.source_image_url}
              highlight={result.normalized_part_number}
              normalize={normalizeNumber}
              onAdd={handleAddRow}
              addedKeys={addedKeys}
              stockOf={(key) => stockFor(services, key)}
            />
          )}
          {!diagramPart ? (
            <p className="muted">No diagram is linked to this part yet.</p>
          ) : !figure ? (
            <>
              {storedDrawing(diagramPart.diagram) ? (
                // eslint-disable-next-line @next/next/no-img-element -- server-proxied, permission-confirmed catalogue image
                <img
                  src={storedDrawing(diagramPart.diagram)}
                  alt={`Diagram ${diagramPart.diagram.diagram_code}`}
                  style={{
                    maxWidth: "100%",
                    borderRadius: 6,
                    border: "1px solid var(--line)",
                  }}
                />
              ) : (
                <p className="notice">
                  Illustration not shown — redistribution permission from the
                  source has not been confirmed.
                </p>
              )}
              <p>
                <strong>Callout:</strong> {diagramPart.callout || "—"}
                <br />
                <strong>Source:</strong>{" "}
                {diagramPart.diagram.provider === "toyota-epc"
                  ? "Toyota catalogue provider"
                  : diagramPart.diagram.provider}
              </p>
              {diagramPart.diagram.source_image_url && (
                <p>
                  <a
                    href={diagramPart.diagram.source_image_url}
                    target="_blank"
                    rel="noreferrer noopener"
                  >
                    VIEW IMAGE
                  </a>
                </p>
              )}
            </>
          ) : null}

          {stock ? (
            <p>
              {stock.available > 0 ? (
                <span className="badge green">
                  In stock: {stock.available} unit
                  {stock.available === 1 ? "" : "s"}
                </span>
              ) : (
                <span className="badge amber">
                  Not in stock — will be purchased to order
                </span>
              )}
            </p>
          ) : (
            <p className="muted">
              Not yet carried in My Products — will be purchased to order.
            </p>
          )}

          <div className="actions">
            <button onClick={handleAdd} disabled={added} className="primary">
              {added ? "Added ✓" : "ADD"}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
