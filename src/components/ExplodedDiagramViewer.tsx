"use client";
import { useMemo, useRef, useState } from "react";
export interface DiagramHotspot {
  id: string;
  label: string;
  resolved?: boolean;
  /** Pixel-space rectangle in the source image's native coordinates. */
  rect?: { x1: number; y1: number; x2: number; y2: number };
  /** Percentage-of-image position, used by hand-authored demo diagrams. */
  xPercent?: number;
  yPercent?: number;
}
/**
 * A professional exploded-diagram viewer: zoom in/out/reset, drag-to-pan
 * once zoomed, fullscreen, loading/error states, and clickable hotspots —
 * either percentage-positioned (original demo artwork) or pixel-rect
 * positioned (a provider's native coordinates, e.g. Toyota EPC).
 *
 * When `imageUrl` is empty but `hotspots` carry pixel rects, the viewer
 * still renders a wireframe of the real hotspot geometry — sized to the
 * hotspots' own bounding box — without the underlying illustration. That
 * happens deliberately whenever a provider's image isn't licensed for
 * display (see `unavailableReason`); it proves the coordinate mapping is
 * genuinely correct without reproducing anyone's artwork.
 */
export default function ExplodedDiagramViewer({
  title,
  imageUrl,
  imageAlt,
  hotspots,
  selectedId,
  onSelect,
  loading,
  error,
  unavailableReason,
}: {
  title: string;
  imageUrl?: string;
  imageAlt?: string;
  hotspots: DiagramHotspot[];
  selectedId?: string;
  onSelect: (id: string) => void;
  loading?: boolean;
  error?: string;
  unavailableReason?: string;
}) {
  const [zoom, setZoom] = useState(1);
  const [fullscreen, setFullscreen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const dragging = useRef<{
    x: number;
    y: number;
    left: number;
    top: number;
  } | null>(null);
  const bbox = useMemo(() => {
    const rects = hotspots.map((h) => h.rect).filter(Boolean) as {
      x1: number;
      y1: number;
      x2: number;
      y2: number;
    }[];
    if (!rects.length) return undefined;
    const width = Math.max(...rects.map((r) => r.x2)) * 1.08;
    const height = Math.max(...rects.map((r) => r.y2)) * 1.08;
    return { width, height };
  }, [hotspots]);
  const positioned = hotspots.map((h) => {
    if (h.rect && bbox) {
      const cx = ((h.rect.x1 + h.rect.x2) / 2 / bbox.width) * 100;
      const cy = ((h.rect.y1 + h.rect.y2) / 2 / bbox.height) * 100;
      const w = ((h.rect.x2 - h.rect.x1) / bbox.width) * 100;
      const ht = ((h.rect.y2 - h.rect.y1) / bbox.height) * 100;
      return { ...h, cx, cy, w, ht };
    }
    return {
      ...h,
      cx: h.xPercent,
      cy: h.yPercent,
      w: undefined,
      ht: undefined,
    };
  });
  const startDrag = (e: React.MouseEvent) => {
    if (zoom <= 1 || !scrollRef.current) return;
    dragging.current = {
      x: e.clientX,
      y: e.clientY,
      left: scrollRef.current.scrollLeft,
      top: scrollRef.current.scrollTop,
    };
  };
  const onDrag = (e: React.MouseEvent) => {
    if (!dragging.current || !scrollRef.current) return;
    scrollRef.current.scrollLeft =
      dragging.current.left - (e.clientX - dragging.current.x);
    scrollRef.current.scrollTop =
      dragging.current.top - (e.clientY - dragging.current.y);
  };
  const endDrag = () => {
    dragging.current = null;
  };
  const hasVisual = Boolean(imageUrl) || Boolean(bbox);
  return (
    <div className={`exploded-viewer${fullscreen ? " epc-fullscreen" : ""}`}>
      <div className="panel-head">
        <h3>{title}</h3>
        <div className="actions">
          <button onClick={() => setZoom((z) => Math.max(1, z - 0.5))}>
            Zoom out
          </button>
          <span>{Math.round(zoom * 100)}%</span>
          <button onClick={() => setZoom((z) => Math.min(3, z + 0.5))}>
            Zoom in
          </button>
          <button onClick={() => setZoom(1)}>Reset zoom</button>
          <button
            aria-pressed={fullscreen}
            onClick={() => setFullscreen(!fullscreen)}
          >
            {fullscreen ? "Exit fullscreen" : "Fullscreen"}
          </button>
        </div>
      </div>
      {loading ? (
        <p role="status" className="empty">
          Loading diagram…
        </p>
      ) : error ? (
        <p role="alert" className="error">
          {error}
        </p>
      ) : !hasVisual ? (
        <p className="empty">No diagram available for this selection.</p>
      ) : (
        <>
          {unavailableReason && !imageUrl && (
            <p className="notice">{unavailableReason}</p>
          )}
          <div
            className="exploded-scroll"
            ref={scrollRef}
            onMouseDown={startDrag}
            onMouseMove={onDrag}
            onMouseUp={endDrag}
            onMouseLeave={endDrag}
            style={{ cursor: zoom > 1 ? "grab" : "default" }}
          >
            <div
              className={
                imageUrl
                  ? "exploded-image"
                  : "exploded-image exploded-wireframe"
              }
              style={{
                width: zoom * 100 + "%",
                aspectRatio: bbox
                  ? `${bbox.width} / ${bbox.height}`
                  : undefined,
              }}
            >
              {imageUrl && <img src={imageUrl} alt={imageAlt ?? title} />}
              {positioned.map((h) => (
                <button
                  key={h.id}
                  aria-label={`Callout ${h.label}`}
                  aria-pressed={selectedId === h.id}
                  aria-disabled={h.resolved === false}
                  className={
                    "diagram-hotspot" +
                    (h.w !== undefined ? " diagram-hotspot-rect" : "")
                  }
                  style={
                    h.w !== undefined
                      ? {
                          left: h.cx + "%",
                          top: h.cy + "%",
                          width: h.w + "%",
                          height: h.ht + "%",
                          borderRadius: 4,
                        }
                      : { left: h.cx + "%", top: h.cy + "%" }
                  }
                  onClick={() => onSelect(h.id)}
                >
                  {h.label}
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
