"use client";
import Link from "next/link";
import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { get, qs } from "../../../ui/api";
import { Empty, ErrorBanner, PageHead, Panel, Money } from "../../../ui/kit";

interface Found {
  product: {
    id: string;
    sku: string;
    name: string;
    brand: string;
    priceMinor: number;
    currency: string;
    status: string;
  };
  available: number;
  locations: {
    locationCode: string;
    warehouseName: string;
    available: number;
  }[];
  primaryImageUrl: string | null;
}
function Scan() {
  const params = useSearchParams();
  const [code, setCode] = useState(params.get("code") ?? "");
  const [found, setFound] = useState<Found | null>(null);
  const [state, setState] = useState<"idle" | "none">("idle");
  const [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null);
  async function lookup(value: string) {
    const v = value.trim();
    if (!v) return;
    setError("");
    try {
      setFound(await get<Found>(`/products/lookup${qs({ code: v })}`));
      setState("idle");
    } catch (e) {
      setFound(null);
      const err = e as { status?: number; message: string };
      if (err.status === 404) setState("none");
      else setError(err.message);
    }
  }
  useEffect(() => {
    const initial = params.get("code");
    if (initial) void lookup(initial);
    input.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);
  return (
    <>
      <PageHead
        title="Scan / lookup"
        subtitle="Scan a barcode or QR label with a scanner, or type a SKU or any part number, then press Enter."
      />
      <Panel>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void lookup(code);
            setCode("");
          }}
        >
          <input
            ref={input}
            aria-label="Code"
            autoFocus
            autoComplete="off"
            placeholder="Scan or type a code…"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            style={{ width: "100%", fontSize: 18, padding: 12 }}
          />
        </form>
      </Panel>
      <ErrorBanner message={error} />
      {state === "none" && (
        <Panel>
          <Empty>
            No product in My Products matches that code.{" "}
            <Link
              href={`/catalogue?q=${encodeURIComponent(params.get("code") ?? code)}`}
            >
              Search the Reference Catalogue
            </Link>{" "}
            instead.
          </Empty>
        </Panel>
      )}
      {found && (
        <Panel
          title={found.product.name}
          actions={
            <Link
              className="button primary"
              href={`/products/${found.product.id}`}
            >
              Open product
            </Link>
          }
        >
          <div style={{ display: "flex", gap: 18 }}>
            {found.primaryImageUrl && (
              // eslint-disable-next-line @next/next/no-img-element -- served by the authenticated API
              <img
                src={found.primaryImageUrl}
                alt=""
                width={120}
                height={120}
                style={{
                  objectFit: "cover",
                  borderRadius: 6,
                  border: "1px solid var(--line)",
                }}
              />
            )}
            <div>
              <p>
                <strong>{found.product.sku}</strong>{" "}
                {found.product.brand && `· ${found.product.brand}`}
              </p>
              <p style={{ fontSize: 22, margin: "4px 0" }}>
                {found.available} <small className="muted">available</small> ·{" "}
                <Money
                  minor={found.product.priceMinor}
                  currency={found.product.currency}
                />
              </p>
              {found.locations.map((l) => (
                <div key={l.warehouseName + l.locationCode} className="muted">
                  {l.warehouseName} · {l.locationCode}: {l.available}
                </div>
              ))}
            </div>
          </div>
        </Panel>
      )}
    </>
  );
}
export default function ScanPage() {
  return (
    <Suspense fallback={null}>
      <Scan />
    </Suspense>
  );
}
