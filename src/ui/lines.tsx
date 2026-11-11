"use client";
import { useEffect, useRef, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { get, minorToInput, parseMinor, qs } from "./api";

export interface EditLine {
  key: string;
  productId: string | null;
  sku: string;
  oemNumber: string;
  description: string;
  quantity: string;
  price: string;
  discount: string;
}
interface ProductHit {
  id: string;
  sku: string;
  name: string;
  priceMinor: number;
  costMinor: number | null;
  brand: string;
}
let counter = 0;
export const newLine = (over: Partial<EditLine> = {}): EditLine => ({
  key: `l${++counter}`,
  productId: null,
  sku: "",
  oemNumber: "",
  description: "",
  quantity: "1",
  price: "",
  discount: "",
  ...over,
});
export const linesFromDocument = (
  lines: {
    productId: string | null;
    sku: string;
    oemNumber: string;
    description: string;
    quantity: number;
    unitPriceMinor: number;
    discountBp: number;
  }[],
): EditLine[] =>
  lines.map((l) =>
    newLine({
      productId: l.productId,
      sku: l.sku,
      oemNumber: l.oemNumber,
      description: l.description,
      quantity: String(l.quantity),
      price: minorToInput(l.unitPriceMinor),
      discount: l.discountBp ? String(l.discountBp / 100) : "",
    }),
  );

/** Validates the editor rows and turns them into the API payload. */
export function linesPayload(lines: EditLine[], kind: "sales" | "purchase") {
  if (!lines.length) throw new Error("Add at least one line.");
  return lines.map((l, i) => {
    const n = i + 1;
    if (!/^\d+$/.test(l.quantity.trim()) || Number(l.quantity) < 1)
      throw new Error(
        `Line ${n}: quantity must be a whole number of at least 1.`,
      );
    const price = l.price.trim() === "" ? 0 : parseMinor(l.price);
    if (price === null)
      throw new Error(`Line ${n}: the price must be an amount such as 12.50.`);
    let discountBp = 0;
    if (l.discount.trim()) {
      if (
        !/^\d+(\.\d{1,2})?$/.test(l.discount.trim()) ||
        Number(l.discount) > 100
      )
        throw new Error(
          `Line ${n}: the discount must be a percentage between 0 and 100.`,
        );
      discountBp = Math.round(Number(l.discount) * 100);
    }
    if (kind === "purchase") {
      if (!l.productId) throw new Error(`Line ${n}: choose a product.`);
      return {
        productId: l.productId,
        quantity: Number(l.quantity),
        unitCostMinor: price,
        discountBp,
      };
    }
    if (!l.productId && !l.description.trim())
      throw new Error(`Line ${n}: choose a product or type a description.`);
    return {
      productId: l.productId,
      sku: l.sku,
      oemNumber: l.oemNumber,
      description: l.description.trim() || undefined,
      quantity: Number(l.quantity),
      unitPriceMinor: price,
      discountBp,
    };
  });
}

export function ProductPicker({
  onPick,
  placeholder = "Search my products by name, SKU or part number…",
}: {
  onPick: (p: ProductHit) => void;
  placeholder?: string;
}) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<ProductHit[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const seq = useRef(0);
  const pick = (h: ProductHit) => {
    onPick(h);
    setQ("");
    setHits([]);
    setActive(0);
  };
  // Enter picks the highlighted product -- also right after a barcode scanner typed a SKU, before the
  // list has appeared: then an exact SKU match (or the only hit) is taken.
  const onKey = async (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!hits.length) return;
      setOpen(true);
      setActive(
        (a) =>
          (a + (e.key === "ArrowDown" ? 1 : hits.length - 1)) % hits.length,
      );
      return;
    }
    if (e.key === "Escape") return setOpen(false);
    if (e.key !== "Enter") return;
    e.preventDefault();
    const term = q.trim();
    if (!term) return;
    if (open && hits.length)
      return pick(hits[Math.min(active, hits.length - 1)]);
    const mine = ++seq.current;
    try {
      const r = await get<{ items: ProductHit[] }>(
        `/products${qs({ q: term, pageSize: 8, status: "ACTIVE" })}`,
      );
      if (mine !== seq.current) return;
      const exact = r.items.find(
        (h) => h.sku.toLowerCase() === term.toLowerCase(),
      );
      if (exact || r.items.length === 1) pick(exact ?? r.items[0]);
      else {
        setHits(r.items);
        setOpen(true);
      }
    } catch {
      // the list stays as it is; the person can pick with the mouse
    }
  };
  useEffect(() => {
    const term = q.trim();
    if (!term) {
      setHits([]);
      return;
    }
    const mine = ++seq.current;
    const t = setTimeout(() => {
      get<{ items: ProductHit[] }>(
        `/products${qs({ q: term, pageSize: 8, status: "ACTIVE" })}`,
      ).then(
        (r) => mine === seq.current && setHits(r.items),
        () => mine === seq.current && setHits([]),
      );
    }, 200);
    return () => clearTimeout(t);
  }, [q]);
  return (
    <div style={{ position: "relative" }}>
      <input
        aria-label="Find a product"
        placeholder={placeholder}
        value={q}
        onChange={(e) => (setQ(e.target.value), setOpen(true), setActive(0))}
        onKeyDown={onKey}
        aria-expanded={open && hits.length > 0}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        style={{ width: "100%" }}
      />
      {open && hits.length > 0 && (
        <div
          className="search-results"
          style={{
            position: "absolute",
            zIndex: 30,
            left: 0,
            right: 0,
            top: "100%",
          }}
        >
          {hits.map((h, i) => (
            <button
              type="button"
              key={h.id}
              aria-selected={i === active}
              style={i === active ? { background: "#eef3f6" } : undefined}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setActive(i)}
              onClick={() => pick(h)}
            >
              {h.name}
              <small>
                {h.sku}
                {h.brand ? ` · ${h.brand}` : ""}
              </small>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function LineEditor({
  lines,
  onChange,
  kind,
}: {
  lines: EditLine[];
  onChange: (l: EditLine[]) => void;
  kind: "sales" | "purchase";
}) {
  const set = (key: string, patch: Partial<EditLine>) =>
    onChange(lines.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const cols =
    kind === "sales"
      ? "minmax(200px,3fr) 70px 110px 80px 32px"
      : "minmax(200px,3fr) 70px 110px 80px 32px";
  return (
    <div>
      <ProductPicker
        onPick={(p) =>
          onChange([
            ...lines,
            newLine({
              productId: p.id,
              sku: p.sku,
              description: p.name,
              price: minorToInput(
                kind === "sales" ? p.priceMinor : (p.costMinor ?? 0),
              ),
            }),
          ])
        }
      />
      <div
        style={{
          display: "grid",
          gridTemplateColumns: cols,
          gap: 8,
          alignItems: "center",
          margin: "12px 0 6px",
        }}
        className="muted"
      >
        <small>Item</small>
        <small>Qty</small>
        <small>{kind === "sales" ? "Unit price" : "Unit cost"}</small>
        <small>Disc. %</small>
        <span />
      </div>
      {lines.map((l) => (
        <div
          key={l.key}
          style={{
            display: "grid",
            gridTemplateColumns: cols,
            gap: 8,
            alignItems: "center",
            marginBottom: 8,
          }}
        >
          <div>
            {l.productId ? (
              <div>
                <strong>{l.description}</strong>
                <small className="muted" style={{ display: "block" }}>
                  {l.sku}
                </small>
              </div>
            ) : (
              <input
                aria-label="Description"
                placeholder="Description (item not in My Products)"
                value={l.description}
                onChange={(e) => set(l.key, { description: e.target.value })}
                style={{ width: "100%" }}
              />
            )}
          </div>
          <input
            aria-label="Quantity"
            inputMode="numeric"
            value={l.quantity}
            onChange={(e) => set(l.key, { quantity: e.target.value })}
          />
          <input
            aria-label="Price"
            inputMode="decimal"
            value={l.price}
            onChange={(e) => set(l.key, { price: e.target.value })}
          />
          <input
            aria-label="Discount percent"
            inputMode="decimal"
            value={l.discount}
            onChange={(e) => set(l.key, { discount: e.target.value })}
          />
          <button
            type="button"
            aria-label="Remove line"
            onClick={() => onChange(lines.filter((x) => x.key !== l.key))}
            style={{ padding: 6 }}
          >
            <Trash2 size={15} />
          </button>
        </div>
      ))}
      {kind === "sales" && (
        <button type="button" onClick={() => onChange([...lines, newLine()])}>
          <Plus size={15} /> Add a free-text line
        </button>
      )}
    </div>
  );
}
