"use client";
import { useMemo, useRef, useState } from "react";
import type {
  FigureData,
  FigureGroup,
  FigureRow,
} from "../integrations/catalogues/intraforge-storage/client";

/**
 * The complete parts list of one figure, laid out like a parts-catalogue
 * page: the drawing with its numbered callouts on the left, and every
 * part line on it — grouped by callout, with production dates, ended
 * marker, fitment codes and an Add button — on the right. Everything
 * shown comes from the snapshot stored in IntraForge, so it renders
 * offline. The drawing itself is shown when it is stored in IntraForge,
 * or when external display is explicitly enabled (see
 * intraforge-storage/config.ts externalDiagramImagesEnabled).
 */
export interface FigureViewerProps {
  figure: Partial<FigureData>;
  diagramCode: string;
  provider: string;
  /** URL the browser may load the drawing from, or "" to withhold it. */
  imageUrl: string;
  /** True when the drawing is served from IntraForge's own storage. */
  stored: boolean;
  /** The provider's own URL, for the attribution / missing-image link. */
  sourceImageUrl: string;
  /** Normalized number the visitor searched for — highlighted in the list. */
  highlight: string;
  normalize: (value: string) => string;
  onAdd: (row: FigureRow, group: FigureGroup) => void;
  addedKeys: Set<string>;
  stockOf: (normalized: string) => { available: number } | null;
}

const titleCase = (value: string) =>
  value
    .toLowerCase()
    .replace(
      /(^|[\s,(/-])([a-z])/g,
      (_m, lead: string, ch: string) => lead + ch.toUpperCase(),
    );
const CHIP_LIMIT = 4;

export default function OEMFigureViewer(props: FigureViewerProps) {
  const groups = useMemo(() => props.figure.groups ?? [], [props.figure]);
  const hotspots = props.figure.hotspots ?? [];
  const [filter, setFilter] = useState("");
  const [active, setActive] = useState("");
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [imageFailed, setImageFailed] = useState(false);
  const groupRefs = useRef<Record<string, HTMLTableRowElement | null>>({});

  const needle = filter.trim().toLowerCase();
  const needleKey = props.normalize(filter);
  const visible = groups
    .map((g) => ({
      group: g,
      rows: g.rows.filter(
        (r) =>
          !needle ||
          g.callout.toLowerCase().includes(needle) ||
          r.description.toLowerCase().includes(needle) ||
          r.part_number.toLowerCase().includes(needle) ||
          (needleKey && props.normalize(r.part_number).includes(needleKey)) ||
          r.fitment.some((f) => f.code.toLowerCase().includes(needle)),
      ),
    }))
    .filter((v) => v.rows.length > 0);
  const totalRows = groups.reduce((n, g) => n + g.rows.length, 0);
  const shownRows = visible.reduce((n, v) => n + v.rows.length, 0);
  const listed = hotspots.filter((h) => h.resolved).length;
  const unlisted = hotspots.length - listed;
  const showImage = Boolean(props.imageUrl) && !imageFailed;
  const fullSize = props.stored
    ? props.imageUrl
    : props.sourceImageUrl || props.imageUrl;

  function jumpTo(pnc: string) {
    setActive(pnc);
    groupRefs.current[pnc]?.scrollIntoView({
      behavior: "smooth",
      block: "center",
    });
  }

  return (
    <div className="epc">
      <div className="epc-figure">
        <div className="epc-image-card">
          {showImage ? (
            <div className="epc-image-stage">
              {/* eslint-disable-next-line @next/next/no-img-element -- catalogue drawing: proxied from IntraForge, or loaded by the browser from its source */}
              <img
                src={props.imageUrl}
                alt={`Diagram ${props.diagramCode}`}
                referrerPolicy="no-referrer"
                onLoad={(e) =>
                  setNatural({
                    w: e.currentTarget.naturalWidth,
                    h: e.currentTarget.naturalHeight,
                  })
                }
                onError={() => setImageFailed(true)}
              />
              {natural &&
                hotspots
                  .filter((h) => h.resolved)
                  .map((h, i) => (
                    <button
                      key={`${h.pnc}-${i}`}
                      type="button"
                      aria-label={`Callout ${h.label}`}
                      title={`Callout ${h.label}`}
                      className={`epc-hotspot ${active === h.pnc ? "on" : ""}`}
                      style={{
                        left: `${(h.rect.x / natural.w) * 100}%`,
                        top: `${(h.rect.y / natural.h) * 100}%`,
                        width: `${(h.rect.width / natural.w) * 100}%`,
                        height: `${(h.rect.height / natural.h) * 100}%`,
                      }}
                      onClick={() => jumpTo(h.pnc)}
                      onMouseEnter={() => setActive(h.pnc)}
                    />
                  ))}
            </div>
          ) : (
            <div className="epc-image-missing">
              <p>
                {imageFailed
                  ? "The drawing could not be loaded."
                  : "Drawing not shown — permission to display this source's illustration has not been confirmed."}
              </p>
              {props.sourceImageUrl && (
                <a
                  href={props.sourceImageUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  Open the drawing at its source ↗
                </a>
              )}
            </div>
          )}
          <div className="epc-image-foot">
            <span>
              <code>{props.diagramCode}</code> · {listed} callout
              {listed === 1 ? "" : "s"}
              {unlisted > 0 ? `, ${unlisted} unlisted` : ""}
            </span>
            {showImage && fullSize && (
              <a href={fullSize} target="_blank" rel="noreferrer noopener">
                Full size ↗
              </a>
            )}
          </div>
          {unlisted > 0 && (
            <p className="epc-note">
              Dashed callouts are standard fasteners the factory draws but does
              not list as separate parts — there is no part number behind them.
            </p>
          )}
          {showImage && (
            <p className="epc-note">
              Illustration source:{" "}
              {props.provider === "toyota-epc"
                ? "Toyota EPC aggregator (aftermarketcatalog.com)"
                : props.provider}
              {props.stored
                ? ", stored in your IntraForge catalogue."
                : ", loaded directly from the source and not stored."}
            </p>
          )}
        </div>
      </div>

      <div className="epc-parts">
        <input
          className="epc-filter"
          type="search"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter these parts…"
          aria-label="Filter parts on this figure"
        />
        <p className="epc-count">
          {needle
            ? `${shownRows} of ${totalRows} parts on this figure`
            : `${totalRows} parts on this figure`}
        </p>
        <div className="epc-table-wrap">
          <table className="epc-table">
            <thead>
              <tr>
                <th>Part number</th>
                <th>Description</th>
                <th>Fitment</th>
                <th>Price</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {visible.length === 0 && (
                <tr>
                  <td colSpan={5} className="epc-empty">
                    No part on this figure matches “{filter}”.
                  </td>
                </tr>
              )}
              {visible.map(({ group, rows }) => (
                <GroupBlock
                  key={group.pnc}
                  group={group}
                  rows={rows}
                  active={active === group.pnc}
                  setActive={setActive}
                  registerRef={(el) => {
                    groupRefs.current[group.pnc] = el;
                  }}
                  highlight={props.highlight}
                  normalize={props.normalize}
                  onAdd={props.onAdd}
                  addedKeys={props.addedKeys}
                  stockOf={props.stockOf}
                />
              ))}
            </tbody>
          </table>
        </div>
        <p className="epc-foot">
          No quantity column: the factory catalogue records which parts a
          vehicle takes, never how many. No price is held for these parts — Add
          sends the number to your enquiry so it can be quoted.
        </p>
      </div>
    </div>
  );
}

function GroupBlock({
  group,
  rows,
  active,
  setActive,
  registerRef,
  highlight,
  normalize,
  onAdd,
  addedKeys,
  stockOf,
}: {
  group: FigureGroup;
  rows: FigureRow[];
  active: boolean;
  setActive: (pnc: string) => void;
  registerRef: (el: HTMLTableRowElement | null) => void;
} & Pick<
  FigureViewerProps,
  "highlight" | "normalize" | "onAdd" | "addedKeys" | "stockOf"
>) {
  return (
    <>
      <tr
        ref={registerRef}
        className={`epc-group ${active ? "on" : ""}`}
        onMouseEnter={() => setActive(group.pnc)}
      >
        <td colSpan={5}>
          <span className="epc-callout">{group.callout}</span> —{" "}
          <strong>{titleCase(group.name)}</strong>
        </td>
      </tr>
      {rows.map((row, i) => {
        const key = normalize(row.part_number);
        const stock = stockOf(key);
        const lineKey = `${group.pnc}|${key}|${row.valid_from}|${i}`;
        return (
          <tr
            key={lineKey}
            className={`epc-row ${key === highlight ? "hit" : ""}`}
            onMouseEnter={() => setActive(group.pnc)}
          >
            <td className="epc-num">
              <span>{row.part_number}</span>
              {row.has_remarks && <em className="epc-chip note">note</em>}
            </td>
            <td>
              <div>{titleCase(row.description)}</div>
              <div className="epc-dates">
                {row.valid_from ?? "?"} → {row.valid_to ?? "present"}
                {!row.is_current && <em className="epc-chip ended">ended</em>}
              </div>
            </td>
            <td>
              <div className="epc-chips">
                {row.fitment.slice(0, CHIP_LIMIT).map((f) => (
                  <em
                    key={f.code}
                    className="epc-chip"
                    title={f.meaning ?? f.code}
                  >
                    {f.code}
                  </em>
                ))}
                {row.fitment.length > CHIP_LIMIT && (
                  <em
                    className="epc-chip more"
                    title={row.fitment
                      .slice(CHIP_LIMIT)
                      .map((f) => f.code)
                      .join(", ")}
                  >
                    +{row.fitment.length - CHIP_LIMIT}
                  </em>
                )}
              </div>
            </td>
            <td className="epc-price">
              {stock ? (
                <span className={stock.available > 0 ? "in" : "out"}>
                  {stock.available > 0
                    ? `In stock: ${stock.available}`
                    : "Not in stock"}
                </span>
              ) : (
                "—"
              )}
            </td>
            <td className="epc-add">
              <button
                type="button"
                disabled={addedKeys.has(key)}
                onClick={() => onAdd(row, group)}
              >
                {addedKeys.has(key) ? "Added ✓" : "Add"}
              </button>
            </td>
          </tr>
        );
      })}
    </>
  );
}
