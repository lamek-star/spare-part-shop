"use client";
import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Search } from "lucide-react";
import { useSession } from "../../../ui/session";
import {
  Badge,
  DataTable,
  Empty,
  ErrorBanner,
  Loading,
  Metrics,
  PageHead,
  Pager,
  Panel,
  useApi,
} from "../../../ui/kit";
import { qs } from "../../../ui/api";
import {
  InMyProducts,
  useAddToEnquiry,
  type LinkedProduct,
} from "../../../ui/catalogue";

interface Hit {
  id: string;
  manufacturer: string;
  oemNumber: string;
  description: string;
  pnc: string;
  status: string;
  statusClass: string;
  vehicles: string[];
  drawingCount: number;
  linkedProducts: LinkedProduct[];
}
interface Browse {
  manufacturers: { id: string; name: string; parts: number }[];
  models: { id: string; manufacturerId: string; name: string }[];
  engines: string[];
  markets: string[];
  sections: { id: string; code: string; name: string }[];
}
interface Stats {
  manufacturers: number;
  parts: number;
  vehicles: number;
  drawings: number;
  drawingsWithImages: number;
}

function CatalogueSearch() {
  const s = useSession();
  const router = useRouter();
  const params = useSearchParams();
  const [q, setQ] = useState(params.get("q") ?? "");
  const [filters, setFilters] = useState({
    manufacturer: "",
    model: "",
    chassis: "",
    engine: "",
    market: "",
    status: "",
    hasDrawing: false,
  });
  const [page, setPage] = useState(1);
  const [showFilters, setShowFilters] = useState(false);
  const enquiry = useAddToEnquiry();
  const term = params.get("q") ?? "";
  const active =
    term ||
    filters.manufacturer ||
    filters.model ||
    filters.chassis ||
    filters.engine ||
    filters.market ||
    filters.status ||
    filters.hasDrawing;
  const stats = useApi<Stats>("/catalogue/stats");
  const browse = useApi<Browse>("/catalogue/browse");
  const results = useApi<{ items: Hit[]; total: number }>(
    active
      ? `/catalogue/search${qs({ q: term, page, pageSize: 20, ...filters, hasDrawing: filters.hasDrawing || undefined })}`
      : null,
  );
  useEffect(() => setQ(term), [term]);
  const setF = (k: keyof typeof filters, v: string | boolean) => (
    setFilters((f) => ({ ...f, [k]: v })),
    setPage(1)
  );
  const empty = stats.data && stats.data.parts === 0;
  return (
    <>
      <PageHead
        title="Reference Catalogue"
        subtitle="Manufacturer part numbers, fitment and drawings. This is reference data — it holds no shop prices or stock."
      />
      {stats.data && (
        <Metrics
          items={[
            {
              label: "Reference parts",
              value: stats.data.parts.toLocaleString("en-US"),
            },
            { label: "Manufacturers", value: stats.data.manufacturers },
            {
              label: "Vehicles",
              value: stats.data.vehicles.toLocaleString("en-US"),
            },
            {
              label: "Drawings",
              value: stats.data.drawings,
              hint: `${stats.data.drawingsWithImages} with stored images`,
            },
          ]}
        />
      )}
      {empty && (
        <div className="notice">
          <strong>The Reference Catalogue is empty.</strong>{" "}
          {s.can("catalogue.import") ? (
            <>
              Import a CSV or an offline catalogue package to fill it.{" "}
              <Link href="/catalogue/import">Go to import</Link>.
            </>
          ) : (
            "Ask an administrator to import catalogue data."
          )}
        </div>
      )}
      <form
        className="toolbar"
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          setPage(1);
          router.push(`/catalogue${qs({ q: q.trim() })}`);
        }}
      >
        <div className="search-box" style={{ maxWidth: 640 }}>
          <Search size={17} />
          <input
            aria-label="Search the reference catalogue"
            placeholder="Part number (any format), description, vehicle or chassis…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            style={{ border: 0, flex: 1, outline: "none", padding: "11px 0" }}
            autoFocus
          />
        </div>
        <button className="primary">Search</button>
        <button type="button" onClick={() => setShowFilters(!showFilters)}>
          {showFilters ? "Hide filters" : "Filters"}
        </button>
      </form>
      {showFilters && browse.data && (
        <Panel title="Filters">
          <div className="form-grid">
            <label className="field">
              Manufacturer
              <select
                value={filters.manufacturer}
                onChange={(e) => setF("manufacturer", e.target.value)}
              >
                <option value="">Any</option>
                {browse.data.manufacturers.map((m) => (
                  <option key={m.id} value={m.name}>
                    {m.name} ({m.parts})
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              Model
              <select
                value={filters.model}
                onChange={(e) => setF("model", e.target.value)}
              >
                <option value="">Any</option>
                {[...new Set(browse.data.models.map((m) => m.name))].map(
                  (m) => (
                    <option key={m}>{m}</option>
                  ),
                )}
              </select>
            </label>
            <label className="field">
              Chassis / frame
              <input
                value={filters.chassis}
                onChange={(e) => setF("chassis", e.target.value)}
                placeholder="e.g. AT151"
              />
            </label>
            <label className="field">
              Engine
              <select
                value={filters.engine}
                onChange={(e) => setF("engine", e.target.value)}
              >
                <option value="">Any</option>
                {browse.data.engines.map((m) => (
                  <option key={m}>{m}</option>
                ))}
              </select>
            </label>
            <label className="field">
              Market
              <select
                value={filters.market}
                onChange={(e) => setF("market", e.target.value)}
              >
                <option value="">Any</option>
                {browse.data.markets.map((m) => (
                  <option key={m}>{m}</option>
                ))}
              </select>
            </label>
            <label className="field">
              Part status
              <select
                value={filters.status}
                onChange={(e) => setF("status", e.target.value)}
              >
                <option value="">Any</option>
                <option value="ACTIVE">Active</option>
                <option value="ENDED">Ended / discontinued</option>
                <option value="SUPERSEDED">Superseded</option>
              </select>
            </label>
          </div>
          <label>
            <input
              type="checkbox"
              checked={filters.hasDrawing}
              onChange={(e) => setF("hasDrawing", e.target.checked)}
            />{" "}
            Only parts that appear on a drawing
          </label>
        </Panel>
      )}
      <ErrorBanner message={results.error} />
      {active ? (
        <Panel
          title={
            results.data
              ? `${results.data.total.toLocaleString("en-US")} result${results.data.total === 1 ? "" : "s"}`
              : "Searching"
          }
        >
          {results.loading && !results.data && <Loading what="Searching" />}
          {results.data && (
            <>
              <DataTable
                rowKey={(h) => h.id}
                rows={results.data.items}
                empty="No reference part matches. Check the number, try fewer words, or import more catalogue data."
                columns={[
                  {
                    header: "Part number",
                    cell: (h) => (
                      <div>
                        <Link href={`/catalogue/parts/${h.id}`}>
                          <strong>{h.oemNumber}</strong>
                        </Link>
                        <small className="muted" style={{ display: "block" }}>
                          {h.manufacturer}
                          {h.pnc ? ` · PNC ${h.pnc}` : ""}
                        </small>
                      </div>
                    ),
                  },
                  { header: "Description", cell: (h) => h.description },
                  {
                    header: "Fits",
                    cell: (h) =>
                      h.vehicles.length
                        ? `${h.vehicles.slice(0, 3).join(", ")}${h.vehicles.length > 3 ? ` +${h.vehicles.length - 3}` : ""}`
                        : "",
                  },
                  {
                    header: "Drawings",
                    align: "right",
                    cell: (h) => h.drawingCount || "",
                  },
                  {
                    header: "Status",
                    cell: (h) => (
                      <Badge
                        value={h.statusClass}
                        label={h.status || undefined}
                      />
                    ),
                  },
                  {
                    header: "My Products",
                    cell: (h) => <InMyProducts linked={h.linkedProducts} />,
                  },
                  {
                    header: "",
                    cell: (h) =>
                      enquiry.enabled && (
                        <button onClick={() => void enquiry.add(h)}>
                          Add to enquiry
                        </button>
                      ),
                  },
                ]}
              />
              <Pager
                page={page}
                pageSize={20}
                total={results.data.total}
                onPage={setPage}
              />
            </>
          )}
        </Panel>
      ) : (
        !empty &&
        browse.data && (
          <Panel title="Browse by manufacturer">
            {browse.data.manufacturers.length === 0 && (
              <Empty>Nothing to browse yet.</Empty>
            )}
            <div className="actions">
              {browse.data.manufacturers.map((m) => (
                <button key={m.id} onClick={() => setF("manufacturer", m.name)}>
                  {m.name} <span className="muted">({m.parts})</span>
                </button>
              ))}
            </div>
            <p className="muted">
              Or search above by part number in any format — “90915-10009”,
              “9091510009” and “90915 10009” all find the same part.
            </p>
          </Panel>
        )
      )}
    </>
  );
}
export default function CataloguePage() {
  return (
    <Suspense fallback={<Loading />}>
      <CatalogueSearch />
    </Suspense>
  );
}
