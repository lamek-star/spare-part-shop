"use client";
import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { Badge, Empty, useToast } from "./kit";
import { ApiError, post } from "./api";
import { useSession } from "./session";

export interface LinkedProduct {
  productId: string;
  sku: string;
  name: string;
  available: number | null;
}
export interface CalloutView {
  id: string;
  label: string;
  sequence: number;
  rect: { x1: number; y1: number; x2: number; y2: number } | null;
  space: "PIXEL" | "PERCENT";
  resolved: boolean;
  notes: string;
  parts: { id: string; oemNumber: string; description: string; quantity: number | null; statusClass: string }[];
}
export interface DrawingDetail {
  id: string;
  code: string;
  title: string;
  source: string;
  catalogues: string[];
  assetId: string | null;
  width: number | null;
  height: number | null;
  rights: string;
  rightsEvidence: string;
  imageAvailable: boolean;
  sourceImageUrl: string;
  callouts: CalloutView[];
  linked?: Record<string, LinkedProduct[]>;
}

/** "In My Products" chip, or nothing. */
export function InMyProducts({ linked }: { linked: LinkedProduct[] }) {
  if (!linked.length) return null;
  const l = linked[0];
  return (
    <span style={{ display: "inline-flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
      <Badge value="ACTIVE" label="✓ In My Products" />
      <Link href={`/products/${l.productId}`}>{l.sku}</Link>
      {l.available !== null && <span className="muted">{l.available} available</span>}
    </span>
  );
}

export function useAddToEnquiry() {
  const toast = useToast();
  const s = useSession();
  return {
    enabled: s.can("enquiries.write"),
    async add(part: { id: string; oemNumber: string; description: string }, vehicle = "") {
      try {
        await post("/enquiries/items", { oemNumber: part.oemNumber, partName: part.description, vehicleDescription: vehicle, quantity: 1, referencePartId: part.id });
        toast(`${part.oemNumber} added to the enquiry cart`);
      } catch (e) {
        toast(e instanceof ApiError ? e.message : "Could not add to the enquiry.");
      }
    },
  };
}

/**
 * The drawing with numbered hotspots on the left and every part line on it,
 * grouped by callout, on the right — the way a printed parts catalogue is
 * laid out. Selecting a hotspot highlights its rows and vice versa.
 */
export function DrawingViewer({ drawing, highlightPartId }: { drawing: DrawingDetail; highlightPartId?: string }) {
  const linked = drawing.linked ?? {};
  const [active, setActive] = useState<string>("");
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(drawing.width && drawing.height ? { w: drawing.width, h: drawing.height } : null);
  const [failed, setFailed] = useState(false);
  const [filter, setFilter] = useState("");
  const rows = useRef<Record<string, HTMLTableRowElement | null>>({});
  const enquiry = useAddToEnquiry();
  const needle = filter.trim().toLowerCase();
  const groups = useMemo(
    () =>
      drawing.callouts
        .map((c) => ({ ...c, parts: c.parts.filter((p) => !needle || p.oemNumber.toLowerCase().includes(needle) || p.description.toLowerCase().includes(needle) || c.label.toLowerCase().includes(needle)) }))
        .filter((c) => c.parts.length > 0 || (!needle && c.parts.length === 0)),
    [drawing.callouts, needle],
  );
  const imageUrl = drawing.assetId && drawing.imageAvailable ? `/api/v1/catalogue/assets/${drawing.assetId}` : "";
  const showImage = Boolean(imageUrl) && !failed;
  const total = drawing.callouts.reduce((n, c) => n + c.parts.length, 0);
  const box = (c: CalloutView) => {
    if (!c.rect || !natural) return null;
    const { x1, y1, x2, y2 } = c.rect;
    const pct = c.space === "PERCENT";
    return {
      left: `${pct ? x1 : (x1 / natural.w) * 100}%`,
      top: `${pct ? y1 : (y1 / natural.h) * 100}%`,
      width: `${pct ? x2 - x1 : ((x2 - x1) / natural.w) * 100}%`,
      height: `${pct ? y2 - y1 : ((y2 - y1) / natural.h) * 100}%`,
    };
  };
  const select = (id: string) => {
    setActive(id);
    rows.current[id]?.scrollIntoView({ behavior: "smooth", block: "center" });
  };
  return (
    <div className="sp-drawing">
      <div>
        <div className="sp-drawing-image">
          {showImage ? (
            <div className="sp-drawing-stage">
              {/* eslint-disable-next-line @next/next/no-img-element -- stored drawing served by the authenticated API */}
              <img
                src={imageUrl}
                alt={`Drawing ${drawing.code}`}
                style={{ maxWidth: "100%", height: "auto", display: "block" }}
                onLoad={(e) => setNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
                onError={() => setFailed(true)}
              />
              {natural &&
                drawing.callouts.map((c) => {
                  const b = box(c);
                  return (
                    b && (
                      <button key={c.id} type="button" aria-label={`Callout ${c.label}`} title={`Callout ${c.label}`} className={`sp-hotspot ${active === c.id ? "on" : ""}`} style={{ position: "absolute", ...b }} onClick={() => select(c.id)} />
                    )
                  );
                })}
            </div>
          ) : (
            <div className="sp-drawing-missing" style={{ padding: 28, textAlign: "center" }}>
              <strong>{drawing.code}</strong>
              <p className="muted">
                {drawing.rights === "DO_NOT_REPUBLISH" ? "This drawing may not be displayed (rights withdrawn)." : "The drawing image is not stored in this system, so only its parts list is shown."}
              </p>
              {drawing.sourceImageUrl && (
                <a href={drawing.sourceImageUrl} target="_blank" rel="noreferrer noopener">
                  View at the source
                </a>
              )}
            </div>
          )}
          <div className="muted sp-drawing-foot">
            {drawing.source} · {drawing.catalogues.join(", ")} · image rights: {drawing.rights.replace(/_/g, " ").toLowerCase()}
          </div>
        </div>
      </div>
      <div className="sp-drawing-parts">
        <div className="toolbar">
          <strong>
            {total} part line{total === 1 ? "" : "s"} on this drawing
          </strong>
          <input aria-label="Filter parts" placeholder="Filter by number, name or callout" value={filter} onChange={(e) => setFilter(e.target.value)} style={{ minWidth: 240 }} />
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>No.</th>
                <th>Part number</th>
                <th>Description</th>
                <th>Qty</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {groups.map((c) =>
                c.parts.length === 0 ? (
                  <tr key={c.id} ref={(el) => void (rows.current[c.id] = el)} className={active === c.id ? "selected-table-row" : undefined} onClick={() => select(c.id)}>
                    <td>
                      <span className="sp-callout">{c.label}</span>
                    </td>
                    <td colSpan={5} className="muted">
                      No part number recorded for this callout.
                    </td>
                  </tr>
                ) : (
                  c.parts.map((p, i) => (
                    <tr key={c.id + p.id} ref={(el) => void (i === 0 && (rows.current[c.id] = el))} className={active === c.id || highlightPartId === p.id ? "selected-table-row" : undefined} onClick={() => setActive(c.id)}>
                      <td>{i === 0 && <span className="sp-callout">{c.label}</span>}</td>
                      <td>
                        <Link href={`/catalogue/parts/${p.id}`}>
                          <strong>{p.oemNumber}</strong>
                        </Link>
                        <div>
                          <InMyProducts linked={linked[p.id] ?? []} />
                        </div>
                      </td>
                      <td>{p.description}</td>
                      <td>{p.quantity ?? ""}</td>
                      <td>
                        <Badge value={p.statusClass === "ENDED" ? "ENDED" : p.statusClass === "ACTIVE" ? "ACTIVE" : p.statusClass} />
                      </td>
                      <td>{enquiry.enabled && <button onClick={() => void enquiry.add(p)}>Add to enquiry</button>}</td>
                    </tr>
                  ))
                ),
              )}
            </tbody>
          </table>
          {!groups.length && <Empty>Nothing matches the filter.</Empty>}
        </div>
      </div>
    </div>
  );
}
