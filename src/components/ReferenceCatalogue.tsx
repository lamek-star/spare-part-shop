"use client";
import { useState, useEffect, useMemo } from "react";
import { UnifiedCatalogueClient } from "../catalogue/unifiedClient";
import {
  BrowseOptions,
  Page,
  ReferenceHit,
  ReferenceDetail,
  DiagramDetail,
  VinLookupResult,
  canDisplayImage,
} from "../catalogue/models";
import { Services } from "../services/contracts";
import { Field, Table, Badge, Modal } from "./ui";
import { money } from "../domain/models";
import ExplodedDiagramViewer, { DiagramHotspot } from "./ExplodedDiagramViewer";
const hotspotsFor = (diagram: DiagramDetail): DiagramHotspot[] =>
  diagram.callouts.map((c) => ({
    id: c.id,
    label: c.display,
    resolved: c.resolved,
    rect: c.rect,
    xPercent: c.x,
    yPercent: c.y,
  }));
const isEpc = (sourceProvider: string) => sourceProvider === "toyota-epc";
export default function ReferenceCatalogue({
  services,
  role,
  initialId = "",
  openCompany,
}: {
  services: Services;
  role: string;
  initialId?: string;
  openCompany: (id: string) => void;
}) {
  const client = useMemo(() => new UnifiedCatalogueClient(role), [role]);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [results, setResults] = useState<Page<ReferenceHit>>();
  const [options, setOptions] = useState<BrowseOptions>();
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [detail, setDetail] = useState<ReferenceDetail>();
  const [diagram, setDiagram] = useState<DiagramDetail>();
  const [selected, setSelected] = useState("");
  const [tab, setTab] = useState("Overview");
  const [adopting, setAdopting] = useState(false);
  const [quoting, setQuoting] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState("");
  const [loading, setLoading] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [fullscreen, setFullscreen] = useState(false);
  const [expandedNumbers, setExpandedNumbers] = useState<Set<string>>(
    new Set(),
  );
  const [vin, setVin] = useState("");
  const [vinResult, setVinResult] = useState<VinLookupResult>();
  const company = services
    .snapshot()
    .parts.find((p) => p.preferredCataloguePartId === detail?.part.id);
  const loadPart = async (id: string) => {
    setLoading(true);
    try {
      setDetail(await client.getPart(id));
      setTab("Overview");
      setError("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    if (initialId)
      void client
        .getPart(initialId)
        .then(setDetail)
        .catch((e) => setError(e.message));
  }, [initialId, client]);
  useEffect(() => {
    let live = true;
    setLoading(true);
    Promise.all([
      client.browse(filters),
      client.searchParts(
        query,
        page,
        filters.variant,
        filters.category,
        filters.year,
        filters.engine,
        filters.model,
        filters.make,
      ),
    ])
      .then(([o, r]) => {
        if (live) {
          setOptions(o);
          setResults(r);
          setError("");
        }
      })
      .catch((e) => {
        if (live) setError(e.message);
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [client, query, page, filters]);
  const change = (name: string, value: string) => {
    setFilters((f): Record<string, string> =>
      name === "make"
        ? { make: value }
        : name === "model"
          ? { make: f.make, model: value }
          : name === "variant"
            ? { make: f.make, model: f.model, variant: value }
            : { ...f, [name]: value },
    );
    setPage(1);
    setDiagram(undefined);
    setSelected("");
  };
  const openDiagram = async (id: string, calloutId = "") => {
    try {
      setDiagram(await client.getDiagram(id));
      setDetail(undefined);
      setSelected(calloutId);
      setZoom(1);
      setFullscreen(false);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const quickAdopt = async (id: string) => {
    await loadPart(id);
    setAdopting(true);
  };
  const runVin = async () => {
    if (!vin.trim()) return;
    try {
      setVinResult(await client.lookupVin(vin.trim()));
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const copyOem = async (number: string) => {
    try {
      await navigator.clipboard.writeText(number);
      setCopied(number);
      setTimeout(() => setCopied(""), 1500);
    } catch {
      setCopied("");
    }
  };
  const addToEnquiry = (
    number: string,
    name: string,
    vehicle: string,
    providerKey: string,
  ) => {
    services.enquiries.addItem({
      oemNumber: number,
      partName: name,
      vehicleDescription: vehicle,
      quantity: 1,
      providerKey,
      sourceUrl: "https://toyota-epc.aftermarketcatalog.com",
    });
  };
  const enquiry = services.enquiries.current();
  useEffect(() => {
    if (!selected) return;
    document
      .querySelector(".epc-parts-column .selected-table-row")
      ?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [selected]);
  const companyProduct = (partId: string) =>
    services
      .snapshot()
      .parts.find((p) => p.preferredCataloguePartId === partId);
  const stockOf = (companyPartId: string) =>
    services.inventory
      .list()
      .filter((x) => x.partId === companyPartId)
      .reduce((n, x) => n + x.available, 0);
  const toggleExpanded = (key: string) =>
    setExpandedNumbers((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  return (
    <>
      <p className="notice">
        Reference catalogue data is separate from My Products. Original demo
        content is illustrative and unverified; live provider data (when
        enabled) carries its own source and licence — see each part&rsquo;s
        Source Information tab. No supplier prices are shown here.
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
          <button
            onClick={() => {
              setFilters({ ...filters });
            }}
          >
            Retry
          </button>
        </p>
      )}
      {loading && <p role="status">Loading catalogue…</p>}
      {detail ? (
        <section className="panel">
          <div className="panel-head">
            <div>
              <button onClick={() => setDetail(undefined)}>
                ← Back to catalogue
              </button>
              <h2>{detail.part.description}</h2>
              <Badge>Reference part</Badge>{" "}
              <Badge>{detail.part.provenance.verification}</Badge>
            </div>
            <div className="actions">
              {isEpc(detail.part.provenance.sourceProvider) && (
                <>
                  <button
                    onClick={() => copyOem(detail.numbers[0]?.original ?? "")}
                  >
                    {copied === detail.numbers[0]?.original
                      ? "Copied!"
                      : "Copy OEM Number"}
                  </button>
                  <button
                    onClick={() =>
                      addToEnquiry(
                        detail.numbers[0]?.original ?? "",
                        detail.part.description,
                        detail.fitments[0]?.vehicle ?? "",
                        detail.part.provenance.sourceProvider,
                      )
                    }
                  >
                    Add to Enquiry
                  </button>
                  <button onClick={() => setQuoting(true)}>
                    Request Quote
                  </button>
                </>
              )}
              {company ? (
                <button
                  className="primary"
                  onClick={() => openCompany(company.id)}
                >
                  Open My Product
                </button>
              ) : (
                <button className="primary" onClick={() => setAdopting(true)}>
                  Add to My Products
                </button>
              )}
            </div>
          </div>
          <div className="tabs">
            {[
              "Overview",
              "Part Numbers",
              "Cross References",
              "Vehicle Compatibility",
              "Diagrams",
              "Source Information",
            ].map((t) => (
              <button
                key={t}
                className={tab === t ? "selected" : ""}
                onClick={() => setTab(t)}
              >
                {t}
              </button>
            ))}
          </div>
          {tab === "Overview" ? (
            <>
              <p>{detail.part.catalogueDescription}</p>
              <dl>
                <div>
                  <dt>Manufacturer</dt>
                  <dd>{detail.part.manufacturer}</dd>
                </div>
                <div>
                  <dt>Record status</dt>
                  <dd>{detail.part.status}</dd>
                </div>
                <div>
                  <dt>Company product</dt>
                  <dd>
                    {company
                      ? `${company.sku} · ${money(company.price)}`
                      : "Not added to My Products"}
                  </dd>
                </div>
              </dl>
              <p>{detail.part.notes}</p>
            </>
          ) : tab === "Part Numbers" ? (
            <Table
              headers={[
                "Original number",
                "Normalized search key",
                "Type",
                "Manufacturer",
                "Source record",
              ]}
              rows={detail.numbers.map((n) => [
                n.original,
                n.normalized,
                n.type,
                n.manufacturer,
                n.provenance.sourceRecordId,
              ])}
            />
          ) : tab === "Cross References" ? (
            <Table
              headers={[
                "Source number",
                "Relationship",
                "Target number",
                "Verification",
                "Notes",
                "",
              ]}
              rows={detail.crossReferences.map((r) => [
                r.source,
                r.type,
                r.target,
                r.provenance.verification,
                r.notes,
                <button onClick={() => loadPart(r.targetPartId)}>
                  Open related part
                </button>,
              ])}
            />
          ) : tab === "Vehicle Compatibility" ? (
            <Table
              headers={[
                "Vehicle / chassis / engine",
                "Production",
                "Transmission",
                "Market",
                "Position",
                "Verification",
              ]}
              rows={detail.fitments.map((f) => [
                f.vehicle,
                `${f.yearFrom}–${f.yearTo}`,
                f.transmission,
                f.market,
                f.position,
                f.provenance.verification,
              ])}
            />
          ) : tab === "Diagrams" ? (
            <div className="reference-diagrams">
              {detail.diagrams.length === 0 && (
                <p className="empty">
                  No diagram back-reference available for this part.
                </p>
              )}
              {detail.diagrams.map(({ diagram: d, callout: c }) => (
                <button
                  key={d.id + c.id}
                  onClick={() => openDiagram(d.id, c.id)}
                >
                  Found in diagram: {d.title} · {d.code}
                  <br />
                  Callout: {c.display}
                </button>
              ))}
            </div>
          ) : (
            <dl>
              {Object.entries(detail.part.provenance).map(([k, v]) => (
                <div key={k}>
                  <dt>{k}</dt>
                  <dd>
                    {k === "sourceUrl" && v ? (
                      <a href={v} target="_blank" rel="noreferrer">
                        Open source
                      </a>
                    ) : (
                      v || "Not supplied"
                    )}
                  </dd>
                </div>
              ))}
            </dl>
          )}
          {company && (
            <div className="notice">
              My Product: {company.sku} · Available{" "}
              {services.inventory
                .list()
                .filter((x) => x.partId === company.id)
                .reduce((n, x) => n + x.available, 0)}{" "}
              · {money(company.price)}.{" "}
              <button onClick={() => openCompany(company.id)}>
                Inventory, suppliers, purchases, sales & documents
              </button>
            </div>
          )}
        </section>
      ) : (
        <>
          <section className="panel">
            <div className="toolbar">
              <Field label="Search OEM, reference or description">
                <input
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setPage(1);
                  }}
                  placeholder="Try DEMO-OE-HL-1"
                />
              </Field>
              <Field label="Make">
                <select
                  value={filters.make ?? ""}
                  onChange={(e) => change("make", e.target.value)}
                >
                  <option value="">All makes</option>
                  {options?.makes.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Model">
                <select
                  value={filters.model ?? ""}
                  onChange={(e) => change("model", e.target.value)}
                >
                  <option value="">All models</option>
                  {options?.models.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Variant">
                <select
                  value={filters.variant ?? ""}
                  onChange={(e) => change("variant", e.target.value)}
                >
                  <option value="">All variants</option>
                  {options?.variants.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.chassis} / {v.engineCode} / {v.yearFrom}–{v.yearTo} /{" "}
                      {v.market}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Year">
                <input
                  type="number"
                  min="1900"
                  max="2100"
                  value={filters.year ?? ""}
                  onChange={(e) => change("year", e.target.value)}
                />
              </Field>
              <Field label="Engine">
                <select
                  value={filters.engine ?? ""}
                  onChange={(e) => change("engine", e.target.value)}
                >
                  <option value="">All engines</option>
                  {[...new Set(options?.variants.map((v) => v.engineCode))].map(
                    (e) => (
                      <option key={e}>{e}</option>
                    ),
                  )}
                </select>
              </Field>
              <Field label="Category">
                <select
                  value={filters.category ?? ""}
                  onChange={(e) => change("category", e.target.value)}
                >
                  <option value="">All categories</option>
                  {options?.categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.parentId ? "↳ " : ""}
                      {c.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="VIN / frame number">
                <input
                  value={vin}
                  onChange={(e) => setVin(e.target.value)}
                  placeholder="e.g. JTDKB20U903100000"
                />
              </Field>
              <button onClick={runVin}>Look up VIN</button>
              {enquiry.items.length > 0 && (
                <button className="primary" onClick={() => setQuoting(true)}>
                  Enquiry ({enquiry.items.length})
                </button>
              )}
            </div>
            {vinResult && (
              <div className="reference-diagrams">
                {!vinResult.supported && (
                  <p className="empty">
                    VIN lookup is currently unavailable (no enabled provider
                    supports it).
                  </p>
                )}
                {vinResult.supported && vinResult.matches.length === 0 && (
                  <p className="empty">No catalogue matched this VIN.</p>
                )}
                {vinResult.matches.map((m, i) => (
                  <p key={i}>
                    {m.vehicle} — {m.chassis} ({m.productionFrom}–
                    {m.productionTo ?? "current"})
                  </p>
                ))}
              </div>
            )}
            <div className="reference-diagrams">
              {options?.diagrams.map((d) => (
                <button key={d.id} onClick={() => openDiagram(d.id)}>
                  Open diagram: {d.title}
                </button>
              ))}
            </div>
          </section>
          {diagram &&
            (() => {
              const selectedCallout = diagram.callouts.find(
                (c) => c.id === selected,
              );
              const selectedHit =
                selectedCallout &&
                diagram.parts.find(
                  (p) => p.part.id === selectedCallout.partIds[0],
                );
              const selectedCompany = selectedHit
                ? companyProduct(selectedHit.part.id)
                : undefined;
              const selectedOemNumbers =
                selectedHit?.numbers.filter((n) => n.type === "OEM_OE") ?? [];
              const selectedIsEpc = Boolean(
                selectedHit &&
                isEpc(selectedHit.part.provenance.sourceProvider),
              );
              return (
                <section
                  className={`panel epc-diagram-panel${fullscreen ? " epc-fullscreen" : ""}`}
                >
                  <div className="panel-head">
                    <div>
                      <small>
                        {[
                          options?.makes.find((m) => m.id === filters.make)
                            ?.name,
                          options?.models.find((m) => m.id === filters.model)
                            ?.name,
                          options?.variants.find(
                            (v) => v.id === filters.variant,
                          )?.chassis,
                          options?.variants.find(
                            (v) => v.id === filters.variant,
                          )?.engineCode,
                          options?.categories.find(
                            (c) => c.id === diagram.diagram.categoryId,
                          )?.name,
                        ]
                          .filter(Boolean)
                          .join(" / ")}
                      </small>
                      <h3>{diagram.diagram.title}</h3>
                      <small>
                        {diagram.diagram.code} · Revision{" "}
                        {diagram.diagram.revision}
                      </small>
                    </div>
                    <div className="actions">
                      <button onClick={() => setZoom(Math.max(1, zoom - 0.5))}>
                        Zoom out
                      </button>
                      <span>{zoom * 100}%</span>
                      <button onClick={() => setZoom(Math.min(3, zoom + 0.5))}>
                        Zoom in
                      </button>
                      <button onClick={() => setZoom(1)}>Fit</button>
                      <button
                        aria-pressed={fullscreen}
                        onClick={() => setFullscreen(!fullscreen)}
                      >
                        {fullscreen ? "Exit fullscreen" : "Fullscreen"}
                      </button>
                    </div>
                  </div>
                  <div className="epc-layout">
                    <div className="epc-diagram-column">
                      <ExplodedDiagramViewer
                        title={diagram.diagram.title}
                        imageUrl={
                          canDisplayImage(diagram.diagram.image)
                            ? diagram.diagram.image.url
                            : undefined
                        }
                        hotspots={hotspotsFor(diagram)}
                        selectedId={selected}
                        onSelect={setSelected}
                        zoom={zoom}
                        unavailableReason="Illustration not displayed — redistribution permission from the source has not been confirmed. Hotspot positions below are the real, verified coordinates."
                      />
                      <small>{diagram.diagram.image.attribution}</small>
                    </div>
                    <div className="epc-parts-column">
                      <h3>Parts in this diagram</h3>
                      {selectedCallout && selectedHit && (
                        <div className="epc-selected-callout">
                          <strong>Callout {selectedCallout.display}</strong>
                          <p>{selectedHit.part.description}</p>
                          <dl>
                            <div>
                              <dt>OEM/OE number(s)</dt>
                              <dd>
                                {selectedOemNumbers.length === 0 ? (
                                  "Not listed"
                                ) : (
                                  <ul className="epc-number-list">
                                    {selectedOemNumbers.map((n) => (
                                      <li key={n.id}>
                                        <strong>{n.original}</strong>
                                        {n.applicability && (
                                          <span className="muted">
                                            {" "}
                                            · {n.applicability}
                                          </span>
                                        )}
                                      </li>
                                    ))}
                                  </ul>
                                )}
                              </dd>
                            </div>
                            {selectedCallout.quantity !== undefined && (
                              <div>
                                <dt>Quantity</dt>
                                <dd>{selectedCallout.quantity}</dd>
                              </div>
                            )}
                            {selectedHit.part.position && (
                              <div>
                                <dt>Position</dt>
                                <dd>{selectedHit.part.position}</dd>
                              </div>
                            )}
                            <div>
                              <dt>Applicability</dt>
                              <dd>
                                {selectedHit.part.notes || "Not specified"}
                              </dd>
                            </div>
                            <div>
                              <dt>Verification</dt>
                              <dd>
                                {selectedHit.part.provenance.verification}
                              </dd>
                            </div>
                          </dl>
                          {selectedCompany && (
                            <p className="epc-company-line">
                              <Badge>My Product</Badge> {selectedCompany.sku} ·{" "}
                              {stockOf(selectedCompany.id)} in stock ·{" "}
                              {money(selectedCompany.price)}
                            </p>
                          )}
                          <div className="actions">
                            <button
                              onClick={() => loadPart(selectedHit.part.id)}
                            >
                              View Part
                            </button>
                            {selectedIsEpc && (
                              <>
                                <button
                                  onClick={() =>
                                    copyOem(
                                      selectedOemNumbers[0]?.original ?? "",
                                    )
                                  }
                                >
                                  Copy OEM Number
                                </button>
                                <button
                                  onClick={() =>
                                    addToEnquiry(
                                      selectedOemNumbers[0]?.original ?? "",
                                      selectedHit.part.description,
                                      "",
                                      selectedHit.part.provenance
                                        .sourceProvider,
                                    )
                                  }
                                >
                                  Add to Enquiry
                                </button>
                              </>
                            )}
                            {selectedCompany ? (
                              <button
                                className="primary"
                                onClick={() => openCompany(selectedCompany.id)}
                              >
                                Open My Product
                              </button>
                            ) : (
                              <button
                                className="primary"
                                onClick={() => quickAdopt(selectedHit.part.id)}
                              >
                                Add to My Products
                              </button>
                            )}
                          </div>
                        </div>
                      )}
                      <Table
                        selectedRow={diagram.callouts
                          .flatMap((c) => c.partIds.map(() => c.id))
                          .indexOf(selected)}
                        onRowClick={(i) =>
                          setSelected(
                            diagram.callouts.flatMap((c) =>
                              c.partIds.map(() => c.id),
                            )[i],
                          )
                        }
                        headers={[
                          "Callout",
                          "OEM/reference number",
                          "Description",
                          "Qty",
                          "Company availability",
                          "",
                        ]}
                        rows={diagram.callouts.flatMap((c) =>
                          c.partIds.map((id) => {
                            const hit = diagram.parts.find(
                              (p) => p.part.id === id,
                            )!;
                            const oem = hit.numbers.filter(
                              (n) => n.type === "OEM_OE",
                            );
                            const product = companyProduct(id);
                            return [
                              <button
                                className={
                                  "diagram-hotspot-row" +
                                  (selected === c.id ? " primary" : "")
                                }
                                aria-pressed={selected === c.id}
                                onClick={() => setSelected(c.id)}
                              >
                                {c.display}
                              </button>,
                              oem.length <= 1 ? (
                                (oem[0]?.original ?? "Not listed")
                              ) : (
                                <div className="epc-number-options">
                                  <button
                                    className="text-link"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      toggleExpanded(c.id);
                                    }}
                                  >
                                    {oem.length} variants available ·{" "}
                                    {expandedNumbers.has(c.id)
                                      ? "Collapse"
                                      : "Expand"}
                                  </button>
                                  {expandedNumbers.has(c.id) && (
                                    <ul className="epc-number-list">
                                      {oem.map((n) => (
                                        <li key={n.id}>
                                          <strong>{n.original}</strong>
                                          {n.applicability && (
                                            <span className="muted">
                                              {" "}
                                              · {n.applicability}
                                            </span>
                                          )}
                                        </li>
                                      ))}
                                    </ul>
                                  )}
                                </div>
                              ),
                              hit.part.description,
                              c.quantity ?? "—",
                              product ? (
                                <span className="epc-company-available">
                                  <Badge>My Product</Badge> {product.sku} ·{" "}
                                  {stockOf(product.id)} available
                                </span>
                              ) : (
                                "Not in My Products"
                              ),
                              <button onClick={() => loadPart(id)}>
                                View reference part
                              </button>,
                            ];
                          }),
                        )}
                      />
                    </div>
                  </div>
                </section>
              );
            })()}
          <section className="panel">
            <div className="panel-head">
              <h3>Reference parts</h3>
              <small>{results?.total ?? 0} matches</small>
            </div>
            <Table
              headers={[
                "Part",
                "Manufacturer",
                "Identifiers",
                "Verification",
                "",
              ]}
              rows={(results?.items ?? []).map((h) => [
                h.part.description,
                h.part.manufacturer,
                h.numbers.map((n) => n.original).join(" · "),
                <Badge>{h.part.provenance.verification}</Badge>,
                <button onClick={() => loadPart(h.part.id)}>
                  Open reference
                </button>,
              ])}
            />
            <div className="pagination">
              <button disabled={page <= 1} onClick={() => setPage(page - 1)}>
                Previous
              </button>
              <span>Page {page}</span>
              <button
                disabled={!results || page * results.pageSize >= results.total}
                onClick={() => setPage(page + 1)}
              >
                Next
              </button>
            </div>
          </section>
        </>
      )}
      {adopting && detail && (
        <Modal title="Add to My Products" onClose={() => setAdopting(false)}>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              try {
                await services.catalogue.adopt(detail, {
                  sku: String(f.get("sku")),
                  supplierId: String(f.get("supplier")),
                  warehouseId: String(f.get("warehouse")),
                  cost: Number(f.get("cost")),
                  price: Number(f.get("price")),
                  reorder: Number(f.get("reorder")),
                  currency: "AED",
                });
                setAdopting(false);
                setError("");
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          >
            {error && (
              <p role="alert" className="error">
                {error}
              </p>
            )}
            <Field label="Internal SKU">
              <input name="sku" required />
            </Field>
            <Field label="Supplier">
              <select name="supplier">
                {services
                  .snapshot()
                  .contacts.filter((c) => c.kind === "Supplier")
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
              </select>
            </Field>
            <div className="form-grid">
              {["cost", "price", "reorder"].map((k) => (
                <Field
                  key={k}
                  label={
                    k === "cost"
                      ? "Cost (AED)"
                      : k === "price"
                        ? "Selling price (AED)"
                        : "Reorder level"
                  }
                >
                  <input
                    name={k}
                    type="number"
                    min={0}
                    step={k === "reorder" ? 1 : 0.01}
                    required
                    defaultValue={0}
                  />
                </Field>
              ))}
              <Field label="Currency">
                <input value="AED" readOnly />
              </Field>
            </div>
            <Field label="Default warehouse">
              <select name="warehouse">
                {services.snapshot().warehouses.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
            </Field>
            <p className="muted">
              Creates a company product with zero stock. Receive or adjust stock
              through normal inventory workflows.
            </p>
            <button className="primary">Create My Product</button>
          </form>
        </Modal>
      )}
      {quoting && (
        <Modal title="Spare parts enquiry" onClose={() => setQuoting(false)}>
          <Table
            headers={["OEM number", "Part", "Qty", ""]}
            rows={enquiry.items.map((i) => [
              i.oemNumber,
              i.partName,
              i.quantity,
              <button onClick={() => services.enquiries.removeItem(i.id)}>
                Remove
              </button>,
            ])}
          />
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              try {
                await services.enquiries.submit({
                  name: String(f.get("name")),
                  email: String(f.get("email")),
                  phone: String(f.get("phone") ?? ""),
                  vin: String(f.get("vin") ?? ""),
                  notes: String(f.get("notes") ?? ""),
                });
                setQuoting(false);
                setError("");
              } catch (err) {
                setError((err as Error).message);
              }
            }}
          >
            {error && (
              <p role="alert" className="error">
                {error}
              </p>
            )}
            <Field label="Your name">
              <input name="name" required />
            </Field>
            <Field label="Email">
              <input name="email" type="email" required />
            </Field>
            <Field label="Phone">
              <input name="phone" />
            </Field>
            <Field label="Vehicle VIN (optional)">
              <input name="vin" defaultValue={vin} />
            </Field>
            <Field label="Notes">
              <textarea name="notes" rows={3} />
            </Field>
            <button className="primary" disabled={!enquiry.items.length}>
              Submit enquiry
            </button>
          </form>
        </Modal>
      )}
    </>
  );
}
