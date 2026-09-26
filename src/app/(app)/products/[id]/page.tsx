"use client";
import Link from "next/link";
import { use, useRef, useState } from "react";
import { useSession } from "../../../../ui/session";
import {
  Badge,
  ConfirmButton,
  DataTable,
  Empty,
  ErrorBanner,
  FormModal,
  KeyValues,
  Loading,
  Metrics,
  Modal,
  Money,
  PageHead,
  Panel,
  Tabs,
  useAction,
  useApi,
  type FieldSpec,
} from "../../../../ui/kit";
import {
  api,
  del,
  formatDate,
  formatDateTime,
  patch,
  post,
  put,
  qs,
  titleCase,
} from "../../../../ui/api";
import {
  AdjustStockModal,
  ReceiveStockModal,
  TransferStockModal,
  locationOptions,
  useWarehouses,
} from "../../../../ui/stock";
import { productFields, productPayload } from "../../../../ui/productForm";
import { apiUrl } from "@/lib/basePath";

interface Product {
  id: string;
  sku: string;
  name: string;
  brand: string;
  manufacturer: string;
  category: string;
  description: string;
  condition: string;
  unit: string;
  weightGrams: number;
  origin: string;
  status: string;
  costMinor: number | null;
  priceMinor: number;
  currency: string;
  reorderLevel: number;
  minimumLevel: number;
  defaultSupplierId: string | null;
  notes: string;
  updatedAt: string;
}
interface Detail {
  product: Product;
  numbers: {
    id: string;
    display: string;
    type: string;
    brand: string;
    source: string;
    primary: boolean;
    active: boolean;
    supersededByNumber: string | null;
    notes: string;
  }[];
  suppliers: {
    id: string;
    supplierId: string;
    supplierPartNumber: string;
    costMinor: number | null;
    currency: string;
    isDefault: boolean;
  }[];
  images: {
    id: string;
    fileId: string;
    isPrimary: boolean;
    caption: string;
    url: string;
    position: number;
  }[];
  referenceLinks: {
    id: string;
    referencePartId: string;
    oemNumber: string;
    linkedAt: string;
  }[];
  stock: {
    locationId: string;
    warehouseId: string;
    warehouseName: string;
    locationCode: string;
    onHand: number;
    reserved: number;
    available: number;
  }[];
  totals: { onHand: number; reserved: number; available: number };
}
const TABS = [
  "Overview",
  "Fitment",
  "Stock",
  "Supplier",
  "OEM Reference",
  "Sales",
  "History",
];

export default function ProductPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const s = useSession();
  const d = useApi<Detail>(`/products/${id}`);
  const [tab, setTab] = useState("Overview");
  const [editing, setEditing] = useState(false);
  const suppliers = useApi<{ items: { id: string; name: string }[] }>(
    s.can("suppliers.read") ? "/suppliers?pageSize=100" : null,
  );
  if (d.loading && !d.data) return <Loading />;
  if (!d.data) return <ErrorBanner message={d.error || "Product not found."} />;
  const { product: p, totals } = d.data;
  const low = p.reorderLevel > 0 && totals.available <= p.reorderLevel;
  return (
    <>
      <PageHead
        title={p.name}
        subtitle={
          <>
            {p.sku} · <Badge value={p.status} />{" "}
            {low && <Badge value="LOW" label="Low stock" />}
          </>
        }
        back={{ href: "/products", label: "My Products" }}
        actions={
          s.can("products.write") && (
            <button onClick={() => setEditing(true)}>Edit product</button>
          )
        }
      />
      <Metrics
        items={[
          {
            label: "Available",
            value: totals.available,
            hint: `${totals.onHand} on hand · ${totals.reserved} reserved`,
          },
          {
            label: "Selling price",
            value: <Money minor={p.priceMinor} currency={p.currency} />,
          },
          ...(s.can("products.cost.read")
            ? [
                {
                  label: "Cost price",
                  value: <Money minor={p.costMinor} currency={p.currency} />,
                },
              ]
            : []),
          { label: "Reorder level", value: p.reorderLevel },
        ]}
      />
      <Tabs tabs={TABS} active={tab} onChange={setTab} />
      {tab === "Overview" && <Overview d={d.data} reload={d.reload} />}
      {tab === "Fitment" && <Fitment d={d.data} />}
      {tab === "Stock" && <StockTab d={d.data} reload={d.reload} />}
      {tab === "Supplier" && (
        <SupplierTab
          d={d.data}
          suppliers={suppliers.data?.items ?? []}
          reload={d.reload}
        />
      )}
      {tab === "OEM Reference" && <ReferenceTab d={d.data} reload={d.reload} />}
      {tab === "Sales" && <SalesTab id={id} />}
      {tab === "History" && <HistoryTab id={id} />}
      {editing && (
        <FormModal
          title="Edit product"
          fields={productFields({
            canCost: s.can("products.cost.read"),
            suppliers: suppliers.data?.items ?? [],
            creating: false,
          })}
          initial={{ ...p, defaultSupplierId: p.defaultSupplierId ?? "" }}
          onClose={() => setEditing(false)}
          onSubmit={async (v) => {
            await patch(`/products/${id}`, productPayload(v));
            d.reload();
          }}
        />
      )}
    </>
  );
}

// ------------------------------------------------------------------ overview
function Overview({ d, reload }: { d: Detail; reload: () => void }) {
  const s = useSession();
  const p = d.product;
  const act = useAction(reload);
  const file = useRef<HTMLInputElement>(null);
  const [selected, setSelected] = useState(0);
  const [label, setLabel] = useState<"code128" | "qr" | null>(null);
  const images = d.images;
  const main = images[Math.min(selected, images.length - 1)];
  const canWrite = s.can("products.write");
  async function upload(files: FileList | null) {
    if (!files?.length) return;
    for (const [i, f] of [...files].entries()) {
      const form = new FormData();
      form.set("file", f);
      if (images.length === 0 && i === 0) form.set("primary", "true");
      const ok = await act.run(
        () => api("POST", `/products/${p.id}/images`, form),
        `Uploaded ${f.name}`,
      );
      if (!ok) break;
    }
    if (file.current) file.current.value = "";
  }
  const move = (index: number, by: number) => {
    const ids = images.map((i) => i.id);
    const [x] = ids.splice(index, 1);
    ids.splice(index + by, 0, x);
    void act.run(() => put(`/products/${p.id}/images/order`, { ids }));
    setSelected(index + by);
  };
  const ref = d.referenceLinks[0];
  return (
    <>
      <ErrorBanner message={act.error} onClose={act.clear} />
      {ref && (
        <div className="notice">
          Linked to the Reference Catalogue:{" "}
          <Link href={`/catalogue/parts/${ref.referencePartId}`}>
            {ref.oemNumber}
          </Link>{" "}
          —{" "}
          <Link href={`/catalogue/parts/${ref.referencePartId}`}>
            view reference part
          </Link>
        </div>
      )}
      <div className="dashboard-grid">
        <Panel
          title="Photos"
          actions={
            canWrite && (
              <>
                <input
                  ref={file}
                  className="file-input"
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  multiple
                  onChange={(e) => void upload(e.target.files)}
                />
                <button
                  onClick={() => file.current?.click()}
                  disabled={act.busy}
                >
                  {act.busy ? "Uploading…" : "Add photos"}
                </button>
              </>
            )
          }
        >
          {main ? (
            <>
              <div
                style={{
                  background: "#f6f8fa",
                  border: "1px solid var(--line)",
                  borderRadius: 8,
                  display: "grid",
                  placeItems: "center",
                  minHeight: 280,
                }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- served by the authenticated API */}
                <img
                  src={main.url}
                  alt={main.caption || p.name}
                  style={{
                    maxWidth: "100%",
                    maxHeight: 420,
                    objectFit: "contain",
                  }}
                />
              </div>
              <p className="muted" style={{ margin: "8px 0" }}>
                {main.isPrimary ? "Primary photo" : ""} {main.caption}
              </p>
              <div className="image-thumbnails">
                {images.map((im, i) => (
                  <button
                    key={im.id}
                    onClick={() => setSelected(i)}
                    aria-label={`Photo ${i + 1}`}
                    style={{
                      padding: 2,
                      borderColor: i === selected ? "var(--teal)" : undefined,
                    }}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element -- served by the authenticated API */}
                    <img
                      src={im.url}
                      alt=""
                      width={64}
                      height={64}
                      style={{ objectFit: "cover" }}
                    />
                  </button>
                ))}
              </div>
              {canWrite && (
                <div className="actions">
                  {!main.isPrimary && (
                    <button
                      onClick={() =>
                        void act.run(
                          () =>
                            put(`/products/${p.id}/images/${main.id}/primary`),
                          "Primary photo changed",
                        )
                      }
                    >
                      Make primary
                    </button>
                  )}
                  <button
                    disabled={selected === 0}
                    onClick={() => move(selected, -1)}
                  >
                    ← Earlier
                  </button>
                  <button
                    disabled={selected >= images.length - 1}
                    onClick={() => move(selected, 1)}
                  >
                    Later →
                  </button>
                  <ConfirmButton
                    danger
                    label="Delete photo"
                    confirmLabel="Delete it"
                    onConfirm={async () => (
                      await act.run(
                        () => del(`/products/${p.id}/images/${main.id}`),
                        "Photo deleted",
                      ),
                      setSelected(0)
                    )}
                  />
                </div>
              )}
            </>
          ) : (
            <Empty>
              {canWrite
                ? "No photos yet. Add clear photos of the actual item — they are shown to your staff and on documents."
                : "No photos."}
            </Empty>
          )}
        </Panel>
        <Panel title="Details">
          <KeyValues
            items={[
              ["SKU", p.sku],
              ["Brand", p.brand],
              ["Manufacturer", p.manufacturer],
              ["Category", p.category],
              ["Condition", titleCase(p.condition)],
              ["Unit", p.unit],
              ["Weight", p.weightGrams ? `${p.weightGrams} g` : ""],
              ["Origin", p.origin],
              ["Description", p.description],
              ["Notes", p.notes],
              ["Updated", formatDateTime(p.updatedAt)],
            ]}
          />
          <div className="actions" style={{ marginTop: 16 }}>
            <button onClick={() => setLabel("code128")}>Barcode label</button>
            <button onClick={() => setLabel("qr")}>QR label</button>
          </div>
        </Panel>
      </div>
      {label && (
        <Modal
          title={label === "qr" ? "QR label" : "Barcode label"}
          onClose={() => setLabel(null)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- generated SVG from the API */}
          <img
            src={apiUrl(`/products/${p.id}/label.svg?type=${label}`)}
            alt={`${label} for ${p.sku}`}
            style={{ maxWidth: "100%", background: "#fff" }}
          />
          <p className="muted">
            Scanning this label in “Scan / Lookup” opens this product.
          </p>
          <div className="form-actions">
            <button
              onClick={() =>
                window.open(
                  apiUrl(`/products/${p.id}/label.svg?type=${label}`),
                  "_blank",
                )
              }
            >
              Open to print
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}

// ------------------------------------------------------------------ fitment
interface RefPart {
  id: string;
  oemNumber: string;
  description: string;
  fitments: {
    id: string;
    make: string;
    model: string;
    chassis: string;
    engineText: string;
    productionFrom: string | null;
    productionTo: string | null;
    market: string;
    catalogue: string;
    section: string;
  }[];
  drawings: {
    drawingId: string;
    code: string;
    callout: string;
    hasImage: boolean;
  }[];
}
function Fitment({ d }: { d: Detail }) {
  const link = d.referenceLinks[0];
  const part = useApi<RefPart>(
    link ? `/catalogue/parts/${link.referencePartId}` : null,
  );
  if (!link)
    return (
      <Panel title="Vehicle fitment">
        <Empty>
          Fitment comes from the Reference Catalogue. Link this product to a
          reference part on the <strong>OEM Reference</strong> tab to see which
          vehicles it fits.
        </Empty>
      </Panel>
    );
  return (
    <Panel
      title={`Fits (from reference ${link.oemNumber})`}
      actions={
        <Link
          className="button"
          href={`/catalogue/parts/${link.referencePartId}`}
        >
          Open reference part
        </Link>
      }
    >
      {part.loading && <Loading />}
      <ErrorBanner message={part.error} />
      {part.data && (
        <>
          <DataTable
            rowKey={(f) => f.id}
            rows={part.data.fitments}
            empty="The reference has no fitment data yet."
            columns={[
              { header: "Make", cell: (f) => f.make },
              { header: "Model", cell: (f) => f.model },
              { header: "Chassis", cell: (f) => f.chassis },
              { header: "Engine", cell: (f) => f.engineText },
              {
                header: "Production",
                cell: (f) =>
                  [f.productionFrom, f.productionTo]
                    .filter(Boolean)
                    .join(" → "),
              },
              { header: "Market", cell: (f) => f.market },
              { header: "Section", cell: (f) => f.section },
            ]}
          />
          {part.data.drawings.length > 0 && (
            <p>
              Appears in {part.data.drawings.length} drawing(s):{" "}
              {part.data.drawings.map((x) => (
                <Link
                  key={x.drawingId}
                  href={`/catalogue/drawings/${x.drawingId}?part=${part.data!.id}`}
                  style={{ marginRight: 8 }}
                >
                  {x.code}
                </Link>
              ))}
            </p>
          )}
        </>
      )}
    </Panel>
  );
}

// ------------------------------------------------------------------ stock
function StockTab({ d, reload }: { d: Detail; reload: () => void }) {
  const s = useSession();
  const wh = useWarehouses(s.can("inventory.read"));
  const [modal, setModal] = useState<"" | "receive" | "adjust" | "transfer">(
    "",
  );
  const moves = useApi<{
    items: {
      id: string;
      type: string;
      quantity: number;
      locationId: string;
      note: string;
      createdAt: string;
      referenceType: string;
    }[];
  }>(
    s.can("inventory.read")
      ? `/inventory/movements${qs({ productId: d.product.id, pageSize: 15 })}`
      : null,
    d.totals.onHand,
  );
  const props = {
    productId: d.product.id,
    productName: d.product.name,
    warehouses: wh.data,
    onClose: () => setModal(""),
    onDone: () => (reload(), moves.reload()),
  };
  const locName = (id: string) =>
    locationOptions(wh.data).find((o) => o.value === id)?.label ?? id;
  return (
    <>
      <Panel
        title="Stock by location"
        actions={
          s.can("inventory.write") && (
            <>
              <button onClick={() => setModal("receive")}>Receive</button>
              <button onClick={() => setModal("transfer")}>Transfer</button>
              <button onClick={() => setModal("adjust")}>Adjust</button>
            </>
          )
        }
      >
        <DataTable
          rowKey={(b) => b.locationId}
          rows={d.stock}
          empty="No stock recorded. Receive stock to start."
          columns={[
            { header: "Warehouse", cell: (b) => b.warehouseName },
            { header: "Location", cell: (b) => b.locationCode },
            { header: "On hand", align: "right", cell: (b) => b.onHand },
            { header: "Reserved", align: "right", cell: (b) => b.reserved },
            { header: "Available", align: "right", cell: (b) => b.available },
          ]}
        />
      </Panel>
      {moves.data && (
        <Panel title="Recent movements">
          <DataTable
            rowKey={(m) => m.id}
            rows={moves.data.items}
            columns={[
              { header: "When", cell: (m) => formatDateTime(m.createdAt) },
              { header: "Type", cell: (m) => titleCase(m.type) },
              { header: "Location", cell: (m) => locName(m.locationId) },
              {
                header: "Change",
                align: "right",
                cell: (m) => (m.quantity > 0 ? `+${m.quantity}` : m.quantity),
              },
              { header: "Note", cell: (m) => m.note },
            ]}
          />
        </Panel>
      )}
      {modal === "receive" && <ReceiveStockModal {...props} />}
      {modal === "adjust" && <AdjustStockModal {...props} />}
      {modal === "transfer" && <TransferStockModal {...props} />}
    </>
  );
}

// ------------------------------------------------------------------ supplier
function SupplierTab({
  d,
  suppliers,
  reload,
}: {
  d: Detail;
  suppliers: { id: string; name: string }[];
  reload: () => void;
}) {
  const s = useSession();
  const [editing, setEditing] = useState(false);
  const act = useAction(reload);
  const name = (id: string) => suppliers.find((x) => x.id === id)?.name ?? id;
  const fields: FieldSpec[] = [
    {
      name: "supplierId",
      label: "Supplier",
      type: "select",
      options: suppliers.map((x) => ({ value: x.id, label: x.name })),
    },
    {
      name: "supplierPartNumber",
      label: "Supplier's part number",
      optional: true,
    },
    ...(s.can("products.cost.read")
      ? ([
          {
            name: "costMinor",
            label: "Cost from this supplier",
            type: "money",
            optional: true,
          },
        ] as FieldSpec[])
      : []),
    { name: "isDefault", label: "Preferred supplier", type: "checkbox" },
  ];
  return (
    <Panel
      title="Suppliers"
      actions={
        s.can("products.write") && (
          <button onClick={() => setEditing(true)}>
            Add / update supplier
          </button>
        )
      }
    >
      <ErrorBanner message={act.error} onClose={act.clear} />
      <DataTable
        rowKey={(x) => x.id}
        rows={d.suppliers}
        empty="No supplier linked yet."
        columns={[
          {
            header: "Supplier",
            cell: (x) => (
              <Link href={`/suppliers/${x.supplierId}`}>
                {name(x.supplierId)}
              </Link>
            ),
          },
          { header: "Their part number", cell: (x) => x.supplierPartNumber },
          ...(s.can("products.cost.read")
            ? [
                {
                  header: "Cost",
                  align: "right" as const,
                  cell: (x: Detail["suppliers"][number]) => (
                    <Money minor={x.costMinor} currency={x.currency} />
                  ),
                },
              ]
            : []),
          {
            header: "Preferred",
            cell: (x) =>
              x.isDefault ? <Badge value="ACTIVE" label="Preferred" /> : "",
          },
          {
            header: "",
            cell: (x) =>
              s.can("products.write") && (
                <ConfirmButton
                  label="Remove"
                  onConfirm={() =>
                    act
                      .run(
                        () =>
                          del(`/products/${d.product.id}/suppliers/${x.id}`),
                        "Supplier removed",
                      )
                      .then(() => undefined)
                  }
                />
              ),
          },
        ]}
      />
      {editing && (
        <FormModal
          title="Supplier for this product"
          fields={fields}
          onClose={() => setEditing(false)}
          onSubmit={async (v) => (
            await put(`/products/${d.product.id}/suppliers`, v),
            reload()
          )}
        />
      )}
    </Panel>
  );
}

// ------------------------------------------------------------------ OEM reference
function ReferenceTab({ d, reload }: { d: Detail; reload: () => void }) {
  const s = useSession();
  const act = useAction(reload);
  const [adding, setAdding] = useState(false);
  const [q, setQ] = useState("");
  const results = useApi<{
    items: {
      id: string;
      oemNumber: string;
      description: string;
      manufacturer: string;
    }[];
  }>(
    q.trim().length >= 3
      ? `/catalogue/search${qs({ q: q.trim(), pageSize: 6 })}`
      : null,
  );
  const w = s.can("products.write");
  return (
    <>
      <Panel
        title="Part numbers"
        actions={
          w && <button onClick={() => setAdding(true)}>Add number</button>
        }
      >
        <ErrorBanner message={act.error} onClose={act.clear} />
        <DataTable
          rowKey={(n) => n.id}
          rows={d.numbers}
          columns={[
            { header: "Number", cell: (n) => <strong>{n.display}</strong> },
            { header: "Type", cell: (n) => titleCase(n.type) },
            { header: "Brand", cell: (n) => n.brand },
            { header: "Source", cell: (n) => n.source },
            {
              header: "Notes",
              cell: (n) =>
                n.supersededByNumber
                  ? `Superseded by ${n.supersededByNumber}`
                  : n.notes,
            },
            {
              header: "",
              cell: (n) =>
                w &&
                n.type !== "INTERNAL_SKU" && (
                  <ConfirmButton
                    label="Remove"
                    onConfirm={() =>
                      act
                        .run(
                          () =>
                            del(`/products/${d.product.id}/numbers/${n.id}`),
                          "Removed",
                        )
                        .then(() => undefined)
                    }
                  />
                ),
            },
          ]}
        />
      </Panel>
      <Panel title="Reference Catalogue links">
        <DataTable
          rowKey={(l) => l.id}
          rows={d.referenceLinks}
          empty="Not linked to any reference part."
          columns={[
            {
              header: "Reference part",
              cell: (l) => (
                <Link href={`/catalogue/parts/${l.referencePartId}`}>
                  {l.oemNumber}
                </Link>
              ),
            },
            { header: "Linked", cell: (l) => formatDate(l.linkedAt) },
            {
              header: "",
              cell: (l) =>
                w && (
                  <ConfirmButton
                    label="Unlink"
                    onConfirm={() =>
                      act
                        .run(
                          () =>
                            del(
                              `/products/${d.product.id}/reference-links/${l.id}`,
                            ),
                          "Unlinked",
                        )
                        .then(() => undefined)
                    }
                  />
                ),
            },
          ]}
        />
        {w && s.can("catalogue.read") && (
          <div style={{ marginTop: 16 }}>
            <label>
              Link to a reference part{" "}
              <input
                placeholder="Search by part number or description"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                style={{ minWidth: 320 }}
              />
            </label>
            {results.data?.items.map((r) => (
              <div className="top-part" key={r.id}>
                <span>
                  <strong>{r.oemNumber}</strong> · {r.manufacturer} —{" "}
                  {r.description}
                </span>
                <button
                  style={{ marginLeft: "auto" }}
                  disabled={d.referenceLinks.some(
                    (l) => l.referencePartId === r.id,
                  )}
                  onClick={() =>
                    void act
                      .run(
                        () =>
                          post(`/products/${d.product.id}/reference-links`, {
                            referencePartId: r.id,
                          }),
                        "Linked",
                      )
                      .then(() => setQ(""))
                  }
                >
                  {d.referenceLinks.some((l) => l.referencePartId === r.id)
                    ? "Linked"
                    : "Link"}
                </button>
              </div>
            ))}
          </div>
        )}
      </Panel>
      {adding && (
        <FormModal
          title="Add part number"
          fields={[
            { name: "display", label: "Number", required: true },
            {
              name: "type",
              label: "Type",
              type: "select",
              options: [
                "OEM_OE",
                "AFTERMARKET",
                "SUPPLIER",
                "CROSS_REFERENCE",
                "REPLACEMENT",
                "PREVIOUS",
                "INTERCHANGE",
                "OTHER",
              ].map((v) => ({ value: v, label: titleCase(v) })),
            },
            { name: "brand", label: "Brand", optional: true },
            { name: "notes", label: "Notes", optional: true },
          ]}
          onClose={() => setAdding(false)}
          onSubmit={async (v) => (
            await post(`/products/${d.product.id}/numbers`, v),
            reload()
          )}
        />
      )}
    </>
  );
}

// ------------------------------------------------------------------ sales & history
function SalesTab({ id }: { id: string }) {
  const s = useSession();
  const r = useApi<{
    quantity: number;
    totalMinor: number;
    invoices: number;
    lastSoldAt: string | null;
    recent: {
      invoiceId: string;
      number: string;
      issueDate: string;
      customerName: string;
      quantity: number;
      unitPriceMinor: number;
      totalMinor: number;
    }[];
  }>(s.can("invoices.read") ? `/products/${id}/sales` : null);
  if (!s.can("invoices.read"))
    return (
      <Panel title="Sales">
        {<Empty>Your role cannot see sales figures.</Empty>}
      </Panel>
    );
  return (
    <>
      {r.data && (
        <Metrics
          items={[
            { label: "Units sold", value: r.data.quantity },
            {
              label: "Sales value",
              value: <Money minor={r.data.totalMinor} />,
            },
            { label: "Invoices", value: r.data.invoices },
            { label: "Last sold", value: formatDate(r.data.lastSoldAt) },
          ]}
        />
      )}
      <Panel title="Recent sales">
        {r.data && (
          <DataTable
            rowKey={(x) => x.invoiceId + x.quantity + x.unitPriceMinor}
            rows={r.data.recent}
            empty="Not sold yet."
            columns={[
              {
                header: "Invoice",
                cell: (x) => (
                  <Link href={`/invoices/${x.invoiceId}`}>{x.number}</Link>
                ),
              },
              { header: "Date", cell: (x) => formatDate(x.issueDate) },
              { header: "Customer", cell: (x) => x.customerName },
              { header: "Qty", align: "right", cell: (x) => x.quantity },
              {
                header: "Unit price",
                align: "right",
                cell: (x) => <Money minor={x.unitPriceMinor} />,
              },
              {
                header: "Total",
                align: "right",
                cell: (x) => <Money minor={x.totalMinor} />,
              },
            ]}
          />
        )}
      </Panel>
    </>
  );
}
function HistoryTab({ id }: { id: string }) {
  const s = useSession();
  const audit = useApi<
    {
      id: string;
      at: string;
      actorLabel: string;
      action: string;
      summary: string;
    }[]
  >(
    s.can("audit.read")
      ? `/audit${qs({ entityType: "product", entityId: id, limit: 50 })}`
      : null,
  );
  const moves = useApi<{
    items: {
      id: string;
      type: string;
      quantity: number;
      note: string;
      createdAt: string;
    }[];
  }>(
    s.can("inventory.read")
      ? `/inventory/movements${qs({ productId: id, pageSize: 50 })}`
      : null,
  );
  return (
    <>
      {audit.data && (
        <Panel title="Changes">
          <DataTable
            rowKey={(e) => e.id}
            rows={audit.data}
            empty="No recorded changes."
            columns={[
              { header: "When", cell: (e) => formatDateTime(e.at) },
              { header: "Who", cell: (e) => e.actorLabel },
              { header: "What", cell: (e) => e.summary },
            ]}
          />
        </Panel>
      )}
      {moves.data && (
        <Panel title="Stock ledger">
          <DataTable
            rowKey={(m) => m.id}
            rows={moves.data.items}
            columns={[
              { header: "When", cell: (m) => formatDateTime(m.createdAt) },
              { header: "Type", cell: (m) => titleCase(m.type) },
              {
                header: "Change",
                align: "right",
                cell: (m) => (m.quantity > 0 ? `+${m.quantity}` : m.quantity),
              },
              { header: "Note", cell: (m) => m.note },
            ]}
          />
        </Panel>
      )}
      {!audit.data && !moves.data && (
        <Panel title="History">
          <Empty>Your role cannot see history.</Empty>
        </Panel>
      )}
    </>
  );
}
