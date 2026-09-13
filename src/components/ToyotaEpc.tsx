"use client";
import { useEffect, useMemo, useState } from "react";
import { CatalogueClient } from "../catalogue/client";
import {
  DiagramDetail,
  ReferenceDetail,
  VinLookupResult,
} from "../catalogue/models";
import { ProviderPolicy } from "../catalogue/providerPolicy";
import {
  ToyotaModel,
  ToyotaSectionSummary,
} from "../integrations/catalogues/toyota-epc/types";
import { Services } from "../services/contracts";
import { Field, Table, Badge, Modal } from "./ui";
import ExplodedDiagramViewer from "./ExplodedDiagramViewer";
type Disabled = {
  disabled: true;
  reason: string;
  capabilities: unknown;
  license: unknown;
};
const isDisabled = (v: unknown): v is Disabled =>
  Boolean(v && typeof v === "object" && (v as Disabled).disabled === true);
const capabilityLabels: [string, string][] = [
  ["supportsVehicleLookup", "Vehicle lookup"],
  ["supportsVinLookup", "VIN lookup"],
  ["supportsDiagrams", "Diagrams"],
  ["supportsHotspots", "Hotspots"],
  ["supportsOemNumbers", "OEM numbers"],
  ["supportsFitment", "Fitment"],
  ["supportsSupersessions", "Supersessions"],
  ["supportsImages", "Images"],
];
export default function ToyotaEpc({ services }: { services: Services }) {
  const client = useMemo(() => new CatalogueClient("Owner"), []);
  const [status, setStatus] = useState<
    ({ enabled: boolean } & ProviderPolicy) | undefined
  >();
  const [statusError, setStatusError] = useState("");
  useEffect(() => {
    client
      .toyotaStatus()
      .then(setStatus)
      .catch((e) => setStatusError(e.message));
  }, [client]);
  const region = "EU";
  const [models, setModels] = useState<ToyotaModel[]>();
  const [modelQuery, setModelQuery] = useState("");
  const [modelDetail, setModelDetail] = useState<ToyotaModel>();
  const [catalogCode, setCatalogCode] = useState("");
  const [sections, setSections] = useState<ToyotaSectionSummary[]>();
  const [sectionCode, setSectionCode] = useState("");
  const [diagram, setDiagram] = useState<DiagramDetail>();
  const [diagramLoading, setDiagramLoading] = useState(false);
  const [diagramError, setDiagramError] = useState("");
  const [selectedCallout, setSelectedCallout] = useState("");
  const [part, setPart] = useState<ReferenceDetail>();
  const [history, setHistory] =
    useState<{ from: string; to: string; effective: string | null }[]>();
  const [oemQuery, setOemQuery] = useState("");
  const [vin, setVin] = useState("");
  const [vinResult, setVinResult] = useState<VinLookupResult>();
  const [error, setError] = useState("");
  const [copied, setCopied] = useState("");
  const [quoting, setQuoting] = useState(false);
  const enabled = status?.enabled === true;
  useEffect(() => {
    if (!enabled) return;
    client
      .toyotaModels(region)
      .then((r) => {
        if (!isDisabled(r)) setModels(r);
      })
      .catch((e) => setError(e.message));
  }, [client, enabled]);
  const filteredModels = (models ?? [])
    .filter((m) => m.name.toLowerCase().includes(modelQuery.toLowerCase()))
    .slice(0, 40);
  const openModel = async (slug: string) => {
    setError("");
    setCatalogCode("");
    setSections(undefined);
    setSectionCode("");
    setDiagram(undefined);
    setPart(undefined);
    try {
      const r = await client.toyotaModel(slug, region);
      if (isDisabled(r)) throw new Error(r.reason);
      setModelDetail(r);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const openVariant = async (code: string) => {
    setError("");
    setCatalogCode(code);
    setSectionCode("");
    setDiagram(undefined);
    setPart(undefined);
    try {
      const r = await client.toyotaSections(code, region);
      if (isDisabled(r)) throw new Error(r.reason);
      setSections(r);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const openSection = async (section: ToyotaSectionSummary) => {
    setSectionCode(section.section_code);
    setSelectedCallout("");
    setPart(undefined);
    if (!section.primary_figure) {
      setDiagram(undefined);
      setDiagramError("This section has no illustration on file.");
      return;
    }
    setDiagramLoading(true);
    setDiagramError("");
    try {
      const r = await client.toyotaDiagram(
        region,
        catalogCode,
        section.primary_figure,
      );
      if (isDisabled(r)) throw new Error(r.reason);
      setDiagram(r);
    } catch (e) {
      setDiagramError((e as Error).message);
    } finally {
      setDiagramLoading(false);
    }
  };
  const openPart = async (number: string) => {
    setError("");
    setHistory(undefined);
    try {
      const r = await client.toyotaPart(number);
      if (isDisabled(r)) throw new Error(r.reason);
      setPart(r);
      const h = await client.toyotaHistory(number, region);
      if (!isDisabled(h)) setHistory(h);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const selectCallout = (id: string) => {
    setSelectedCallout(id);
    const callout = diagram?.callouts.find((c) => c.id === id);
    const hit =
      callout &&
      diagram?.parts.find((p) => callout.partIds.includes(p.part.id));
    const oem = hit?.numbers.find((n) => n.type === "OEM_OE");
    if (oem) void openPart(oem.original);
    else setPart(undefined);
  };
  const runVin = async () => {
    setError("");
    try {
      const r = await client.toyotaVin(vin.trim());
      if (isDisabled(r)) throw new Error(r.reason);
      setVinResult(r);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const runOemSearch = async () => {
    await openPart(oemQuery.trim());
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
  const addToEnquiry = (number: string, name: string, vehicle: string) => {
    services.enquiries.addItem({
      oemNumber: number,
      partName: name,
      vehicleDescription: vehicle,
      quantity: 1,
      providerKey: "toyota-epc",
      sourceUrl: "https://toyota-epc.aftermarketcatalog.com",
    });
  };
  const enquiry = services.enquiries.current();
  if (statusError)
    return (
      <p role="alert" className="error">
        {statusError}
      </p>
    );
  if (!status) return <p role="status">Loading Toyota EPC status…</p>;
  if (!enabled)
    return (
      <section className="panel epc-disabled-panel">
        <h3>Toyota EPC</h3>
        <p>
          <Badge>DISABLED</Badge>{" "}
          {status.license.licenseStatus.replace(/_/g, " ").toLowerCase()}
        </p>
        <p>{status.license.notes}</p>
        <p className="muted">
          Adapter status: <strong>Ready</strong> — implemented and tested
          against verified real API response shapes (see
          tests/toyota-epc-mapper.test.ts, tests/toyota-epc-provider.test.ts and
          tests/live/toyota-epc.live.test.ts). Not reachable by normal users
          until this provider is enabled and its licence flags permit it — see
          docs/SPARE_PARTS_CATALOG_ARCHITECTURE.md, "Catalogue Data Licensing
          &amp; Provider Governance".
        </p>
        <ul className="provider-capabilities">
          {capabilityLabels.map(([key, label]) => {
            const value = (
              status.capabilities as unknown as Record<string, boolean>
            )[key];
            return (
              <li key={key} className={value ? "yes" : "no"}>
                {value ? "✓" : "✗"} {label}
              </li>
            );
          })}
        </ul>
        {status.license.termsUrl && (
          <p>
            <a href={status.license.termsUrl} target="_blank" rel="noreferrer">
              Source terms
            </a>
          </p>
        )}
      </section>
    );
  return (
    <>
      <p className="notice">
        Toyota EPC reference data — live from an independent aggregator, not
        stored locally. No prices are shown. Use Request Quote / Add to Enquiry
        rather than ordering directly.
      </p>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <section className="panel">
        <div className="toolbar">
          <Field label="Search OEM number">
            <input
              value={oemQuery}
              onChange={(e) => setOemQuery(e.target.value)}
              placeholder="e.g. 90915-20004"
            />
          </Field>
          <button onClick={runOemSearch}>Search</button>
          <Field label="VIN / frame number">
            <input
              value={vin}
              onChange={(e) => setVin(e.target.value)}
              placeholder="e.g. JTDKB20U903100000"
            />
          </Field>
          <button onClick={runVin}>Look up VIN</button>
        </div>
        {vinResult && (
          <div className="reference-diagrams">
            {vinResult.matches.length === 0 && (
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
      </section>
      <p className="epc-breadcrumb">
        Toyota{modelDetail ? ` > ${modelDetail.name}` : ""}
        {catalogCode ? ` > ${catalogCode}` : ""}
        {sectionCode
          ? ` > ${sections?.find((s) => s.section_code === sectionCode)?.name}`
          : ""}
      </p>
      <section className="panel epc-vehicle-tree">
        <div className="epc-vehicle-tree-nav">
          <Field label="Model">
            <input
              value={modelQuery}
              onChange={(e) => setModelQuery(e.target.value)}
              placeholder="Search models…"
            />
          </Field>
          <div style={{ maxHeight: 220, overflowY: "auto" }}>
            {filteredModels.map((m) => (
              <button
                key={m.slug}
                className={modelDetail?.slug === m.slug ? "selected" : ""}
                onClick={() => openModel(m.slug)}
              >
                {m.name}
              </button>
            ))}
          </div>
          {modelDetail && (
            <>
              <p className="muted small">Catalogue / variant</p>
              <div style={{ maxHeight: 160, overflowY: "auto" }}>
                {modelDetail.catalogs.map((c) => (
                  <button
                    key={c.catalog_code}
                    className={catalogCode === c.catalog_code ? "selected" : ""}
                    onClick={() => openVariant(c.catalog_code)}
                  >
                    {c.model_name.trim()} · {c.chassis_codes.join("/")}
                  </button>
                ))}
              </div>
            </>
          )}
          {sections && (
            <>
              <p className="muted small">Section</p>
              <div style={{ maxHeight: 260, overflowY: "auto" }}>
                {sections.map((s) => (
                  <button
                    key={s.section_code}
                    className={sectionCode === s.section_code ? "selected" : ""}
                    onClick={() => openSection(s)}
                  >
                    {s.name}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
        <div>
          {sectionCode && (
            <>
              <ExplodedDiagramViewer
                title={
                  sections?.find((s) => s.section_code === sectionCode)?.name ??
                  "Diagram"
                }
                imageUrl={
                  diagram && diagram.diagram.image.url
                    ? diagram.diagram.image.url
                    : undefined
                }
                hotspots={(diagram?.callouts ?? []).map((c) => ({
                  id: c.id,
                  label: c.display,
                  resolved: c.resolved,
                  rect: c.rect,
                  xPercent: c.x,
                  yPercent: c.y,
                }))}
                selectedId={selectedCallout}
                onSelect={selectCallout}
                loading={diagramLoading}
                error={diagramError}
                unavailableReason={
                  diagram
                    ? "Illustration not displayed — redistribution permission from the source has not been confirmed. Hotspot positions below are the real, verified coordinates."
                    : undefined
                }
              />
              {diagram && (
                <div className="epc-parts-column" style={{ marginTop: 14 }}>
                  <h3>Parts in this diagram</h3>
                  <Table
                    headers={[
                      "Callout",
                      "OEM number",
                      "Description",
                      "Resolved",
                      "",
                    ]}
                    selectedRow={diagram.callouts.findIndex(
                      (c) => c.id === selectedCallout,
                    )}
                    onRowClick={(i) => selectCallout(diagram.callouts[i].id)}
                    rows={diagram.callouts.map((c) => {
                      const hit = diagram.parts.find((p) =>
                        c.partIds.includes(p.part.id),
                      );
                      const oem = hit?.numbers.find((n) => n.type === "OEM_OE");
                      return [
                        c.display,
                        oem?.original ?? "Not listed",
                        hit?.part.description ?? "—",
                        c.resolved === false ? "No (fastener)" : "Yes",
                        <button onClick={() => selectCallout(c.id)}>
                          View
                        </button>,
                      ];
                    })}
                  />
                </div>
              )}
            </>
          )}
        </div>
      </section>
      {part && (
        <section className="panel">
          <div className="panel-head">
            <h3>{part.part.description}</h3>
            <Badge>{part.part.provenance.verification}</Badge>
          </div>
          <dl>
            <div>
              <dt>OEM part number</dt>
              <dd>
                <strong>{part.numbers[0]?.original}</strong>
              </dd>
            </div>
            <div>
              <dt>Manufacturer</dt>
              <dd>{part.part.manufacturer}</dd>
            </div>
            <div>
              <dt>Part group(s)</dt>
              <dd>{part.part.notes}</dd>
            </div>
          </dl>
          {history && history.length > 0 && (
            <>
              <h4>Supersession history</h4>
              <Table
                headers={[
                  "Superseded number",
                  "Replacement number",
                  "Effective",
                ]}
                rows={history.map((h) => [h.from, h.to, h.effective ?? "—"])}
              />
            </>
          )}
          <h4>Vehicle compatibility</h4>
          <Table
            headers={["Vehicle", "Catalogue", "Production"]}
            rows={part.fitments
              .slice(0, 20)
              .map((f) => [
                (f as unknown as { vehicle?: string }).vehicle ?? f.chassis,
                f.chassis,
                `${f.yearFrom || "?"}–${f.yearTo || "current"}`,
              ])}
          />
          <div className="actions">
            <button onClick={() => copyOem(part.numbers[0]?.original ?? "")}>
              {copied === part.numbers[0]?.original
                ? "Copied!"
                : "Copy OEM Number"}
            </button>
            <button
              className="primary"
              onClick={() =>
                addToEnquiry(
                  part.numbers[0]?.original ?? "",
                  part.part.description,
                  part.fitments[0]
                    ? ((part.fitments[0] as unknown as { vehicle?: string })
                        .vehicle ?? "")
                    : "",
                )
              }
            >
              Add to Enquiry
            </button>
            <button onClick={() => setQuoting(true)}>Request Quote</button>
          </div>
        </section>
      )}
      {enquiry.items.length > 0 && (
        <button
          className="epc-enquiry-badge primary"
          onClick={() => setQuoting(true)}
        >
          Enquiry ({enquiry.items.length})
        </button>
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
