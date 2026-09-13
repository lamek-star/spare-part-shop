"use client";
import { useMemo, useRef } from "react";
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
 * The exploded-diagram viewing surface: drag-to-pan once zoomed, clickable
 * hotspots (either percentage-positioned, from original demo artwork, or
 * pixel-rect positioned, from a live provider's native coordinates), and
 * loading/error states. Fully controlled — `zoom` and `fullscreen` are
 * owned by the caller's own toolbar (matching this app's existing
 * item-image viewer convention), so this component is just the surface,
 * not the chrome around it.
 *
 * When `imageUrl` is empty but `hotspots` carry pixel rects, it still
 * renders a wireframe of the real hotspot geometry — sized to the
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
  zoom,
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
  zoom: number;
}) {
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
  if (loading)
    return (
      <p role="status" className="empty">
        Loading diagram…
      </p>
    );
  if (error)
    return (
      <p role="alert" className="error">
        {error}
      </p>
    );
  if (!hasVisual)
    return <p className="empty">No diagram available for this selection.</p>;
  return (
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
            imageUrl ? "exploded-image" : "exploded-image exploded-wireframe"
          }
          style={{
            width: zoom * 100 + "%",
            aspectRatio: bbox ? `${bbox.width} / ${bbox.height}` : undefined,
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
  );
}
