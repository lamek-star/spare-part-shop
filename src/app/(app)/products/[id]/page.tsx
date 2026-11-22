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
  Money,
  PageHead,
  Panel,
  Tabs,
  useAction,
  useApi,
  useStatusLabel,
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
import {
  belowCostWarning,
  mainPartNumber,
  productFields,
  productPayload,
  useUnitLabel,
} from "../../../../ui/productForm";
import { LabelDialog } from "../../../../ui/labelDialog";
import { useT } from "../../../../ui/i18n";
import { needsOrdering } from "../../../../ui/stockStatus";

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
  genericName: string;
  strength: string;
  dosageForm: string;
  prescriptionOnly: boolean;
  trackBatches: boolean;
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
  const t = useT();
  const { id } = use(params);
  const s = useSession();
  const d = useApi<Detail>(`/products/${id}`);
  const [tab, setTab] = useState("Overview");
  const [editing, setEditing] = useState(false);
  const suppliers = useApi<{ items: { id: string; name: string }[] }>(
    s.can("suppliers.read") ? "/suppliers?pageSize=100" : null,
  );
  if (d.loading && !d.data) return <Loading />;
  if (!d.data) return <ErrorBanner message={d.error || t("prod.notFound")} />;
  const { product: p, totals } = d.data;
  const level = needsOrdering({ ...p, available: totals.available });
  const partNo = mainPartNumber(d.data.numbers);
  return (
    <>
      <PageHead
        title={p.name}
        subtitle={
          <>
            {p.sku}
            {partNo && (
              <>
                {" · "}
                <span className="part-no" title={t("prod.partNumber")}>
                  {partNo}
                </span>
              </>
            )}{" "}
            · <Badge value={p.status} />{" "}
            {level && (
              <Badge
                value={level === "RED" ? "OUT" : "LOW"}
                label={t(level === "RED" ? "dash.levelRED" : "dash.levelAMBER")}
              />
            )}
          </>
        }
        back={{ href: "/products", label: t("nav.products") }}
        actions={
          s.can("products.write") && (
            <button onClick={() => setEditing(true)}>
              {t("prod.editProduct")}
            </button>
          )
        }
      />
      <Metrics
        items={[
          {
            label: t("prod.available"),
            value: totals.available,
            hint: t("prod.onHandReserved", {
              onHand: totals.onHand,
              reserved: totals.reserved,
            }),
          },
          {
            label: t("prod.sellingPrice"),
            value: <Money minor={p.priceMinor} currency={p.currency} />,
          },
          ...(s.can("products.cost.read")
            ? [
                {
                  label: t("prod.costPrice"),
                  value: <Money minor={p.costMinor} currency={p.currency} />,
                },
              ]
            : []),
          {
            label: t("prod.reorderLevel"),
            value: p.reorderLevel,
            hint: `${t("prod.minimumLevel")}: ${p.minimumLevel}`,
          },
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
          title={t("prod.editProduct")}
          fields={productFields({
            t,
            canCost: s.can("products.cost.read"),
            suppliers: suppliers.data?.items ?? [],
            creating: false,
            pharmacy: s.edition === "pharmacy",
          })}
          initial={{ ...p, defaultSupplierId: p.defaultSupplierId ?? "" }}
          warnBeforeSave={(v) => belowCostWarning(v, t)}
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
  const t = useT();
  const statusLabel = useStatusLabel();
  const unitLabel = useUnitLabel();
  const s = useSession();
  const p = d.product;
  const act = useAction(reload);
  const file = useRef<HTMLInputElement>(null);
  const [selected, setSelected] = useState(0);
  const [label, setLabel] = useState(false);
  const images = d.images;
  const main = images[Math.min(selected, images.length - 1)];
  const canWrite = s.can("products.write");
  async function upload(files: FileList | null) {
    if (!files?.length) return;
    for (const f of [...files]) {
      // The server makes a product's first photo primary (it knows what is saved; this page may not yet).
      const form = new FormData();
      form.set("file", f);
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
            {t("prod.viewReferencePart")}
          </Link>
        </div>
      )}
      <div className="dashboard-grid">
        <Panel
          title={t("prod.photos")}
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
                  {act.busy ? t("prod.uploading") : t("prod.addPhotos")}
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
                {main.isPrimary ? t("prod.primaryPhoto") : ""} {main.caption}
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
                          t("prod.primaryChanged"),
                        )
                      }
                    >
                      {t("prod.makePrimary")}
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
                    {t("prod.later")}
                  </button>
                  <ConfirmButton
                    danger
                    label={t("prod.deletePhoto")}
                    confirmLabel={t("prod.deleteIt")}
                    onConfirm={async () => (
                      await act.run(
                        () => del(`/products/${p.id}/images/${main.id}`),
                        t("prod.photoDeleted"),
                      ),
                      setSelected(0)
                    )}
                  />
                </div>
              )}
            </>
          ) : (
            <Empty>
              {canWrite ? t("prod.noPhotosYet") : t("prod.noPhotos")}
            </Empty>
          )}
        </Panel>
        <Panel title={t("customers.details")}>
          <KeyValues
            items={[
              ["SKU", p.sku],
              ...(p.genericName || p.strength || p.dosageForm
                ? ([
                    [t("prod.genericName"), p.genericName],
                    [t("prod.strength"), p.strength],
                    [t("prod.dosageForm"), p.dosageForm],
                  ] as [string, string][])
                : []),
              ...(p.prescriptionOnly
                ? ([[t("prod.prescription"), t("prod.prescriptionOnly")]] as [
                    string,
                    string,
                  ][])
                : []),
              ...(p.trackBatches
                ? ([[t("tab.stock"), t("prod.keptInBatches")]] as [
                    string,
                    string,
                  ][])
                : []),
              [t("prod.partNumber"), mainPartNumber(d.numbers)],
              [t("prod.brand"), p.brand],
              [t("prod.manufacturer"), p.manufacturer],
              [t("prod.category"), p.category],
              [t("prod.condition"), statusLabel(p.condition)],
              [t("prod.unit"), unitLabel(p.unit)],
              [t("prod.weight"), p.weightGrams ? `${p.weightGrams} g` : ""],
              [t("prod.origin"), p.origin],
              [t("lines.description"), p.description],
              [t("prod.notes"), p.notes],
              [t("prod.updated"), formatDateTime(p.updatedAt)],
            ]}
          />
          <div className="actions" style={{ marginTop: 16 }}>
            <button onClick={() => setLabel(true)}>
              {t("prod.printLabel")}
            </button>
          </div>
        </Panel>
      </div>
      {label && (
        <LabelDialog
          productId={p.id}
          sku={p.sku}
          onClose={() => setLabel(false)}
        />
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
  const t = useT();
  const link = d.referenceLinks[0];
  const part = useApi<RefPart>(
    link ? `/catalogue/parts/${link.referencePartId}` : null,
  );
  if (!link)
    return (
      <Panel title={t("prod.vehicleFitment")}>
        <Empty>
          {t("prod.fitmentHelp1")} <strong>{t("prod.oemReference")}</strong>{" "}
          {t("prod.fitmentHelp2")}
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
          {t("prod.openReferencePart")}
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
            empty={t("prod.theReferenceHasNoFitment")}
            columns={[
              { header: t("prod.make"), cell: (f) => f.make },
              { header: t("prod.model"), cell: (f) => f.model },
              { header: t("prod.chassis"), cell: (f) => f.chassis },
              { header: t("prod.engine"), cell: (f) => f.engineText },
              {
                header: t("prod.production"),
                cell: (f) =>
                  [f.productionFrom, f.productionTo]
                    .filter(Boolean)
                    .join(" → "),
              },
              { header: t("prod.market"), cell: (f) => f.market },
              { header: t("prod.section"), cell: (f) => f.section },
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
  const t = useT();
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
  const batches = useApi<
    {
      id: string;
      batchNo: string;
      expiryDate: string;
      locationId: string;
      onHand: number;
    }[]
  >(
    d.product.trackBatches && s.can("inventory.read")
      ? `/products/${d.product.id}/batches`
      : null,
    d.stock,
  );
  const props = {
    productId: d.product.id,
    productName: d.product.name,
    trackBatches: d.product.trackBatches,
    warehouses: wh.data,
    onClose: () => setModal(""),
    onDone: () => (reload(), moves.reload()),
  };
  const locName = (id: string) =>
    locationOptions(wh.data).find((o) => o.value === id)?.label ?? id;
  return (
    <>
      <Panel
        title={t("prod.stockByLocation")}
        actions={
          s.can("inventory.write") && (
            <>
              <button onClick={() => setModal("receive")}>
                {t("prod.receive")}
              </button>
              <button onClick={() => setModal("transfer")}>
                {t("prod.transfer")}
              </button>
              <button onClick={() => setModal("adjust")}>
                {t("prod.adjust")}
              </button>
            </>
          )
        }
      >
        <DataTable
          rowKey={(b) => b.locationId}
          rows={d.stock}
          empty={t("prod.noStockRecordedReceiveStock")}
          columns={[
            { header: t("prod.warehouse"), cell: (b) => b.warehouseName },
            { header: t("prod.location"), cell: (b) => b.locationCode },
            { header: t("prod.onHand"), align: "right", cell: (b) => b.onHand },
            {
              header: t("prod.reserved"),
              align: "right",
              cell: (b) => b.reserved,
            },
            {
              header: t("prod.available"),
              align: "right",
              cell: (b) => b.available,
            },
          ]}
        />
      </Panel>
      {d.product.trackBatches && batches.data && (
        <Panel title={t("prod.batchesSoldEarliestExpiryFirst")}>
          <DataTable
            rowKey={(b) => b.id}
            rows={batches.data}
            empty={t("prod.noBatchesInStock")}
            columns={[
              { header: t("prod.batch"), cell: (b) => b.batchNo },
              {
                header: t("prod.expires"),
                cell: (b) => (
                  <span
                    className={`badge ${b.expiryDate < new Date().toISOString().slice(0, 10) ? "red" : "green"}`}
                  >
                    {b.expiryDate}
                  </span>
                ),
              },
              {
                header: t("prod.location"),
                cell: (b) => locName(b.locationId),
              },
              {
                header: t("prod.units"),
                align: "right",
                cell: (b) => b.onHand,
              },
            ]}
          />
        </Panel>
      )}
      {moves.data && (
        <Panel title={t("prod.recentMovements")}>
          <DataTable
            rowKey={(m) => m.id}
            rows={moves.data.items}
            columns={[
              {
                header: t("audit.when"),
                cell: (m) => formatDateTime(m.createdAt),
              },
              { header: t("audit.type"), cell: (m) => titleCase(m.type) },
              {
                header: t("prod.location"),
                cell: (m) => locName(m.locationId),
              },
              {
                header: t("prod.change"),
                align: "right",
                cell: (m) => (m.quantity > 0 ? `+${m.quantity}` : m.quantity),
              },
              { header: t("prod.note"), cell: (m) => m.note },
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
  const t = useT();
  const s = useSession();
  const [editing, setEditing] = useState(false);
  const act = useAction(reload);
  const name = (id: string) => suppliers.find((x) => x.id === id)?.name ?? id;
  const fields: FieldSpec[] = [
    {
      name: "supplierId",
      label: t("prod.supplier"),
      type: "select",
      options: suppliers.map((x) => ({ value: x.id, label: x.name })),
    },
    {
      name: "supplierPartNumber",
      label: t("prod.supplierSPartNumber"),
      optional: true,
    },
    ...(s.can("products.cost.read")
      ? ([
          {
            name: "costMinor",
            label: t("prod.costFromThisSupplier"),
            type: "money",
            optional: true,
          },
        ] as FieldSpec[])
      : []),
    { name: "isDefault", label: t("prod.preferredSupplier"), type: "checkbox" },
  ];
  return (
    <Panel
      title={t("nav.suppliers")}
      actions={
        s.can("products.write") && (
          <button onClick={() => setEditing(true)}>
            {t("prod.addUpdateSupplier")}
          </button>
        )
      }
    >
      <ErrorBanner message={act.error} onClose={act.clear} />
      <DataTable
        rowKey={(x) => x.id}
        rows={d.suppliers}
        empty={t("prod.noSupplierLinkedYet")}
        columns={[
          {
            header: t("prod.supplier"),
            cell: (x) => (
              <Link href={`/suppliers/${x.supplierId}`}>
                {name(x.supplierId)}
              </Link>
            ),
          },
          {
            header: t("prod.theirPartNumber"),
            cell: (x) => x.supplierPartNumber,
          },
          ...(s.can("products.cost.read")
            ? [
                {
                  header: t("prod.cost"),
                  align: "right" as const,
                  cell: (x: Detail["suppliers"][number]) => (
                    <Money minor={x.costMinor} currency={x.currency} />
                  ),
                },
              ]
            : []),
          {
            header: t("prod.preferred"),
            cell: (x) =>
              x.isDefault ? (
                <Badge value="ACTIVE" label={t("prod.preferred")} />
              ) : (
                ""
              ),
          },
          {
            header: "",
            cell: (x) =>
              s.can("products.write") && (
                <ConfirmButton
                  label={t("prod.remove")}
                  onConfirm={() =>
                    act
                      .run(
                        () =>
                          del(`/products/${d.product.id}/suppliers/${x.id}`),
                        t("prod.supplierRemoved"),
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
          title={t("prod.supplierForThisProduct")}
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
  const t = useT();
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
        title={t("prod.partNumbers")}
        actions={
          w && (
            <button onClick={() => setAdding(true)}>
              {t("prod.addNumber")}
            </button>
          )
        }
      >
        <ErrorBanner message={act.error} onClose={act.clear} />
        <DataTable
          rowKey={(n) => n.id}
          rows={d.numbers}
          columns={[
            {
              header: t("docs.number"),
              cell: (n) => <strong>{n.display}</strong>,
            },
            { header: t("audit.type"), cell: (n) => titleCase(n.type) },
            { header: t("prod.brand"), cell: (n) => n.brand },
            { header: t("prod.source"), cell: (n) => n.source },
            {
              header: t("docs.notes"),
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
                    label={t("prod.remove")}
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
      <Panel title={t("prod.referenceCatalogueLinks")}>
        <DataTable
          rowKey={(l) => l.id}
          rows={d.referenceLinks}
          empty={t("prod.notLinkedToAnyReference")}
          columns={[
            {
              header: t("prod.referencePart"),
              cell: (l) => (
                <Link href={`/catalogue/parts/${l.referencePartId}`}>
                  {l.oemNumber}
                </Link>
              ),
            },
            { header: t("prod.linked"), cell: (l) => formatDate(l.linkedAt) },
            {
              header: "",
              cell: (l) =>
                w && (
                  <ConfirmButton
                    label={t("prod.unlink")}
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
                placeholder={t("prod.searchByPartNumberOr")}
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
          title={t("prod.addPartNumber")}
          fields={[
            { name: "display", label: t("docs.number"), required: true },
            {
              name: "type",
              label: t("audit.type"),
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
            { name: "brand", label: t("prod.brand"), optional: true },
            { name: "notes", label: t("docs.notes"), optional: true },
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
  const t = useT();
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
      <Panel title={t("nav.group.sales")}>
        {<Empty>{t("prod.yourRoleCannotSeeSales")}</Empty>}
      </Panel>
    );
  return (
    <>
      {r.data && (
        <Metrics
          items={[
            { label: t("prod.unitsSold"), value: r.data.quantity },
            {
              label: t("prod.salesValue"),
              value: <Money minor={r.data.totalMinor} />,
            },
            { label: t("dash.invoices"), value: r.data.invoices },
            { label: t("prod.lastSold"), value: formatDate(r.data.lastSoldAt) },
          ]}
        />
      )}
      <Panel title={t("prod.recentSales")}>
        {r.data && (
          <DataTable
            rowKey={(x) => x.invoiceId + x.quantity + x.unitPriceMinor}
            rows={r.data.recent}
            empty={t("prod.notSoldYet")}
            columns={[
              {
                header: t("invoices.invoice"),
                cell: (x) => (
                  <Link href={`/invoices/${x.invoiceId}`}>{x.number}</Link>
                ),
              },
              {
                header: t("invoices.date"),
                cell: (x) => formatDate(x.issueDate),
              },
              { header: t("docs.customer"), cell: (x) => x.customerName },
              { header: t("doc.qty"), align: "right", cell: (x) => x.quantity },
              {
                header: t("doc.unitPrice"),
                align: "right",
                cell: (x) => <Money minor={x.unitPriceMinor} />,
              },
              {
                header: t("doc.total"),
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
  const t = useT();
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
        <Panel title={t("prod.changes")}>
          <DataTable
            rowKey={(e) => e.id}
            rows={audit.data}
            empty={t("prod.noRecordedChanges")}
            columns={[
              { header: t("audit.when"), cell: (e) => formatDateTime(e.at) },
              { header: t("audit.who"), cell: (e) => e.actorLabel },
              { header: t("audit.what"), cell: (e) => e.summary },
            ]}
          />
        </Panel>
      )}
      {moves.data && (
        <Panel title={t("prod.stockLedger")}>
          <DataTable
            rowKey={(m) => m.id}
            rows={moves.data.items}
            columns={[
              {
                header: t("audit.when"),
                cell: (m) => formatDateTime(m.createdAt),
              },
              { header: t("audit.type"), cell: (m) => titleCase(m.type) },
              {
                header: t("prod.change"),
                align: "right",
                cell: (m) => (m.quantity > 0 ? `+${m.quantity}` : m.quantity),
              },
              { header: t("prod.note"), cell: (m) => m.note },
            ]}
          />
        </Panel>
      )}
      {!audit.data && !moves.data && (
        <Panel title={t("prod.history")}>
          <Empty>{t("prod.yourRoleCannotSeeHistory")}</Empty>
        </Panel>
      )}
    </>
  );
}
