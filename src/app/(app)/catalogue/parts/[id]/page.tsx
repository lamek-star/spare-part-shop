"use client";
import Link from "next/link";
import { use, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "../../../../../ui/session";
import {
  Badge,
  DataTable,
  Empty,
  ErrorBanner,
  FormModal,
  KeyValues,
  Loading,
  PageHead,
  Panel,
  useAction,
  useApi,
  useToast,
  type FieldSpec,
} from "../../../../../ui/kit";
import { formatDate, post, put, titleCase } from "../../../../../ui/api";
import {
  InMyProducts,
  useAddToEnquiry,
  type LinkedProduct,
} from "../../../../../ui/catalogue";
import { locationOptions, useWarehouses } from "../../../../../ui/stock";

interface Part {
  id: string;
  manufacturer: string;
  oemNumber: string;
  description: string;
  pnc: string;
  partGroup: string;
  status: string;
  statusClass: string;
  notes: string;
  verification: string;
  fitments: {
    id: string;
    make: string;
    model: string;
    generation: string;
    chassis: string;
    engineText: string;
    productionFrom: string | null;
    productionTo: string | null;
    market: string;
    position: string;
    notes: string;
    catalogue: string;
    section: string;
  }[];
  drawings: {
    drawingId: string;
    code: string;
    title: string;
    callout: string;
    catalogue: string;
    section: string;
    hasImage: boolean;
  }[];
  relations: {
    id: string;
    relation: string;
    relatedNumber: string;
    relatedPartId: string | null;
    direction: "in" | "out";
    notes: string;
  }[];
  facts: {
    id: string;
    source: string;
    description: string;
    status: string;
    priceUsdMinor: number | null;
    priceJpy: number | null;
    notes: string;
    observedAt: string;
  }[];
  sources: {
    id: string;
    source: string;
    externalId: string;
    sourceUrl: string;
    catalogueCode: string;
    market: string;
    importedAt: string;
  }[];
  linkedProducts: LinkedProduct[];
}
export default function ReferencePartPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const s = useSession();
  const router = useRouter();
  const toast = useToast();
  const p = useApi<Part>(`/catalogue/parts/${id}`);
  const [importing, setImporting] = useState(false);
  const enquiry = useAddToEnquiry();
  const verify = useAction(p.reload);
  const suppliers = useApi<{ items: { id: string; name: string }[] }>(
    importing && s.can("suppliers.read")
      ? "/suppliers?pageSize=100&status=ACTIVE"
      : null,
  );
  const wh = useWarehouses(importing && s.can("inventory.read"));
  if (p.loading && !p.data) return <Loading />;
  if (!p.data)
    return <ErrorBanner message={p.error || "Reference part not found."} />;
  const x = p.data;
  const mine = x.linkedProducts[0];
  const fields: FieldSpec[] = [
    {
      name: "sku",
      label: "Your SKU",
      required: true,
      help: "Your own stock code for this item.",
    },
    { name: "name", label: "Product name", required: true },
    {
      name: "priceMinor",
      label: "Selling price",
      type: "money",
      optional: true,
    },
    ...(s.can("products.cost.read")
      ? ([
          {
            name: "costMinor",
            label: "Cost price",
            type: "money",
            optional: true,
          },
        ] as FieldSpec[])
      : []),
    {
      name: "reorderLevel",
      label: "Reorder level",
      type: "number",
      optional: true,
    },
    ...(suppliers.data?.items.length
      ? ([
          {
            name: "supplierId",
            label: "Supplier",
            type: "select",
            optional: true,
            options: [
              { value: "", label: "— none —" },
              ...suppliers.data.items.map((v) => ({
                value: v.id,
                label: v.name,
              })),
            ],
          },
        ] as FieldSpec[])
      : []),
    ...(wh.data?.locations.length && s.can("inventory.write")
      ? ([
          {
            name: "locationId",
            label: "Store in",
            type: "select",
            optional: true,
            options: [
              { value: "", label: "— no stock yet —" },
              ...locationOptions(wh.data),
            ],
          },
          {
            name: "openingQuantity",
            label: "Quantity in stock now",
            type: "number",
            optional: true,
          },
        ] as FieldSpec[])
      : []),
  ];
  const vehicleOf = (f: Part["fitments"][number]) =>
    [f.make, f.model, f.chassis].filter(Boolean).join(" ");
  return (
    <>
      <PageHead
        title={x.oemNumber}
        subtitle={
          <>
            {x.manufacturer} ·{" "}
            <Badge value={x.statusClass} label={x.status || undefined} /> ·{" "}
            <Badge value={x.verification} />
          </>
        }
        back={{ href: "/catalogue", label: "Reference Catalogue" }}
        actions={
          enquiry.enabled && (
            <button
              onClick={() =>
                void enquiry.add(
                  x,
                  x.fitments[0] ? vehicleOf(x.fitments[0]) : "",
                )
              }
            >
              Add to enquiry
            </button>
          )
        }
      />
      <ErrorBanner message={verify.error} onClose={verify.clear} />

      <Panel title="My Products">
        {mine ? (
          <div
            style={{
              display: "flex",
              gap: 18,
              alignItems: "center",
              flexWrap: "wrap",
            }}
          >
            <InMyProducts linked={x.linkedProducts} />
            {s.can("products.read") && (
              <Link
                className="button primary"
                href={`/products/${mine.productId}`}
              >
                VIEW MY PRODUCT
              </Link>
            )}
            {x.linkedProducts.length > 1 && (
              <span className="muted">
                +{x.linkedProducts.length - 1} more linked
              </span>
            )}
          </div>
        ) : (
          <div
            style={{
              display: "flex",
              gap: 18,
              alignItems: "center",
              flexWrap: "wrap",
            }}
          >
            <span className="muted">
              This part is not in your shop yet. Reference data stays separate
              until you import it.
            </span>
            {s.can("products.write") && (
              <button className="primary" onClick={() => setImporting(true)}>
                IMPORT TO MY PRODUCTS
              </button>
            )}
          </div>
        )}
      </Panel>

      <div className="dashboard-grid">
        <Panel title="Part">
          <KeyValues
            items={[
              ["Description", x.description],
              ["PNC", x.pnc],
              ["Group", x.partGroup],
              ["Notes", x.notes],
            ]}
          />
        </Panel>
        <Panel title="Replacements & supersessions">
          {x.relations.length === 0 && <Empty>None recorded.</Empty>}
          {x.relations.map((r) => (
            <div className="top-part" key={r.id}>
              <span>
                {titleCase(
                  r.direction === "in"
                    ? `is ${r.relation.toLowerCase().replace("superseded_by", "replaced by").replace("supersedes", "replaces")} by`
                    : r.relation,
                )}{" "}
                {r.relatedPartId ? (
                  <Link href={`/catalogue/parts/${r.relatedPartId}`}>
                    <strong>{r.relatedNumber}</strong>
                  </Link>
                ) : (
                  <strong>{r.relatedNumber}</strong>
                )}
              </span>
              {r.notes && <small className="muted">{r.notes}</small>}
            </div>
          ))}
        </Panel>
      </div>

      <Panel title={`Drawings (${x.drawings.length})`}>
        {x.drawings.length === 0 && (
          <Empty>This part is not on any imported drawing.</Empty>
        )}
        <div className="actions">
          {x.drawings.map((d) => (
            <Link
              key={d.drawingId}
              className="button"
              href={`/catalogue/drawings/${d.drawingId}?part=${x.id}`}
            >
              {d.code}{" "}
              {d.callout && <span className="muted">callout {d.callout}</span>}{" "}
              {!d.hasImage && <span className="muted">(no image)</span>}
            </Link>
          ))}
        </div>
      </Panel>

      <Panel title={`Fitment (${x.fitments.length})`}>
        <DataTable
          rowKey={(f) => f.id}
          rows={x.fitments}
          empty="No fitment data has been imported for this part."
          columns={[
            { header: "Make", cell: (f) => f.make },
            { header: "Model", cell: (f) => f.model },
            { header: "Chassis", cell: (f) => f.chassis },
            { header: "Engine", cell: (f) => f.engineText },
            {
              header: "Production",
              cell: (f) =>
                [f.productionFrom, f.productionTo].filter(Boolean).join(" → "),
            },
            { header: "Market", cell: (f) => f.market },
            {
              header: "Catalogue / section",
              cell: (f) => [f.catalogue, f.section].filter(Boolean).join(" · "),
            },
            { header: "Notes", cell: (f) => f.notes },
          ]}
        />
      </Panel>

      <Panel title="Where this information came from">
        <DataTable
          rowKey={(f) => f.id}
          rows={x.facts}
          empty="No source facts recorded."
          columns={[
            { header: "Source", cell: (f) => f.source },
            { header: "Description", cell: (f) => f.description },
            { header: "Status", cell: (f) => f.status },
            {
              header: "Reference price (info only)",
              cell: (f) =>
                [
                  f.priceUsdMinor !== null &&
                    `USD ${(f.priceUsdMinor / 100).toFixed(2)}`,
                  f.priceJpy !== null && `JPY ${f.priceJpy}`,
                ]
                  .filter(Boolean)
                  .join(" · "),
            },
            {
              header: "Notes",
              cell: (f) =>
                f.notes ? (
                  <span style={{ whiteSpace: "pre-line" }}>{f.notes}</span>
                ) : (
                  "—"
                ),
            },
            { header: "Recorded", cell: (f) => formatDate(f.observedAt) },
          ]}
        />
        <p className="muted">
          Reference prices come from the source and are not your selling prices.
        </p>
        <DataTable
          rowKey={(r) => r.id}
          rows={x.sources}
          empty=""
          columns={[
            { header: "Source record", cell: (r) => r.source },
            { header: "External ID", cell: (r) => r.externalId },
            {
              header: "Catalogue",
              cell: (r) =>
                [r.catalogueCode, r.market].filter(Boolean).join(" · "),
            },
            { header: "Imported", cell: (r) => formatDate(r.importedAt) },
            {
              header: "Link",
              cell: (r) =>
                r.sourceUrl ? (
                  <a
                    href={r.sourceUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                  >
                    Source page
                  </a>
                ) : (
                  ""
                ),
            },
          ]}
        />
        {s.can("catalogue.admin") && (
          <div className="toolbar" style={{ marginTop: 14 }}>
            <label>
              Verification{" "}
              <select
                value={x.verification}
                onChange={(e) =>
                  void verify.run(
                    () =>
                      put(`/catalogue/parts/${id}/verification`, {
                        status: e.target.value,
                      }),
                    "Verification updated",
                  )
                }
              >
                {[
                  "UNVERIFIED",
                  "SOURCE_VERIFIED",
                  "MANUALLY_VERIFIED",
                  "DISPUTED",
                ].map((v) => (
                  <option key={v} value={v}>
                    {titleCase(v)}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}
      </Panel>

      {importing && (
        <FormModal
          title={`Import ${x.oemNumber} to My Products`}
          submitLabel="IMPORT TO MY PRODUCTS"
          fields={fields}
          initial={{ sku: x.oemNumber, name: x.description, reorderLevel: 0 }}
          onClose={() => setImporting(false)}
          onSubmit={async (v) => {
            const payload = { ...v };
            if (payload.supplierId === "") delete payload.supplierId;
            if (payload.locationId === "") delete payload.locationId;
            const created = await post<{ id: string }>(
              `/catalogue/parts/${id}/import-to-products`,
              payload,
            );
            toast("Imported to My Products");
            router.push(`/products/${created.id}`);
          }}
        />
      )}
    </>
  );
}
