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
import { useT } from "../../../ui/i18n";

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
  const t = useT();
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
        title={t("nav.catalogue")}
        subtitle={t("cat.manufacturerPartNumbersFitmentAnd")}
      />
      {stats.data && (
        <Metrics
          items={[
            {
              label: t("cat.referenceParts"),
              value: stats.data.parts.toLocaleString("en-US"),
            },
            { label: t("cat.manufacturers"), value: stats.data.manufacturers },
            {
              label: t("cat.vehicles"),
              value: stats.data.vehicles.toLocaleString("en-US"),
            },
            {
              label: t("cat.drawings"),
              value: stats.data.drawings,
              hint: `${stats.data.drawingsWithImages} with stored images`,
            },
          ]}
        />
      )}
      {empty && (
        <div className="notice">
          <strong>{t("cat.theReferenceCatalogueIsEmpty")}</strong>{" "}
          {s.can("catalogue.import") ? (
            <>
              Import a CSV or an offline catalogue package to fill it.{" "}
              <Link href="/catalogue/import">{t("cat.goToImport")}</Link>.
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
            aria-label={t("cat.searchTheReferenceCatalogue")}
            placeholder={t("cat.partNumberAnyFormatDescription")}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            style={{ border: 0, flex: 1, outline: "none", padding: "11px 0" }}
            autoFocus
          />
        </div>
        <button className="primary">{t("common.search")}</button>
        <button type="button" onClick={() => setShowFilters(!showFilters)}>
          {showFilters ? t("cat.hideFilters") : t("cat.filters")}
        </button>
      </form>
      {showFilters && browse.data && (
        <Panel title={t("cat.filters")}>
          <div className="form-grid">
            <label className="field">
              Manufacturer
              <select
                value={filters.manufacturer}
                onChange={(e) => setF("manufacturer", e.target.value)}
              >
                <option value="">{t("cat.any")}</option>
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
                <option value="">{t("cat.any")}</option>
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
                placeholder={t("cat.eGAt151")}
              />
            </label>
            <label className="field">
              Engine
              <select
                value={filters.engine}
                onChange={(e) => setF("engine", e.target.value)}
              >
                <option value="">{t("cat.any")}</option>
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
                <option value="">{t("cat.any")}</option>
                {browse.data.markets.map((m) => (
                  <option key={m}>{m}</option>
                ))}
              </select>
            </label>
            <label className="field">
              {t("cat.partStatus")}
              <select
                value={filters.status}
                onChange={(e) => setF("status", e.target.value)}
              >
                <option value="">{t("cat.any")}</option>
                <option value="ACTIVE">{t("status.ACTIVE")}</option>
                <option value="ENDED">{t("cat.endedDiscontinued")}</option>
                <option value="SUPERSEDED">{t("cat.superseded")}</option>
              </select>
            </label>
          </div>
          <label>
            <input
              type="checkbox"
              checked={filters.hasDrawing}
              onChange={(e) => setF("hasDrawing", e.target.checked)}
            />{" "}
            {t("cat.onlyOnDrawing")}
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
          {results.loading && !results.data && (
            <Loading what={t("cat.searching")} />
          )}
          {results.data && (
            <>
              <DataTable
                rowKey={(h) => h.id}
                rows={results.data.items}
                empty={t("cat.noReferencePartMatchesCheck")}
                columns={[
                  {
                    header: t("cat.partNumber"),
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
                  {
                    header: t("lines.description"),
                    cell: (h) => h.description,
                  },
                  {
                    header: t("cat.fits"),
                    cell: (h) =>
                      h.vehicles.length
                        ? `${h.vehicles.slice(0, 3).join(", ")}${h.vehicles.length > 3 ? ` +${h.vehicles.length - 3}` : ""}`
                        : "",
                  },
                  {
                    header: t("cat.drawings"),
                    align: "right",
                    cell: (h) => h.drawingCount || "",
                  },
                  {
                    header: t("common.status"),
                    cell: (h) => (
                      <Badge
                        value={h.statusClass}
                        label={h.status || undefined}
                      />
                    ),
                  },
                  {
                    header: t("nav.products"),
                    cell: (h) => <InMyProducts linked={h.linkedProducts} />,
                  },
                  {
                    header: "",
                    cell: (h) =>
                      enquiry.enabled && (
                        <button onClick={() => void enquiry.add(h)}>
                          {t("cat.addToEnquiry")}
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
          <Panel title={t("cat.browseByManufacturer")}>
            {browse.data.manufacturers.length === 0 && (
              <Empty>{t("cat.nothingToBrowseYet")}</Empty>
            )}
            <div className="actions">
              {browse.data.manufacturers.map((m) => (
                <button key={m.id} onClick={() => setF("manufacturer", m.name)}>
                  {m.name} <span className="muted">({m.parts})</span>
                </button>
              ))}
            </div>
            <p className="muted">{t("cat.anyFormat")}</p>
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
