"use client";
import Link from "next/link";
import { useState } from "react";
import { useSession } from "../../../ui/session";
import { ListPage } from "../../../ui/ListPage";
import {
  Badge,
  ConfirmButton,
  DataTable,
  ErrorBanner,
  FormModal,
  Pager,
  Panel,
  Tabs,
  PageHead,
  useAction,
  useApi,
} from "../../../ui/kit";
import { formatDateTime, patch, post, qs, titleCase } from "../../../ui/api";
import { locationOptions, useWarehouses } from "../../../ui/stock";
import { useT } from "../../../ui/i18n";

interface Level {
  productId: string;
  sku: string;
  name: string;
  warehouseId: string;
  warehouse: string;
  locationId: string;
  location: string;
  onHand: number;
  reserved: number;
  available: number;
}
export default function Inventory() {
  const t = useT();
  const [tab, setTab] = useState("Stock");
  const s = useSession();
  return (
    <>
      <PageHead
        title={t("stock.stockLocations")}
        subtitle={t("stock.everyQuantityHereIsThe")}
      />
      <Tabs
        tabs={[
          "Stock",
          "Warehouses & locations",
          "Movements",
          ...(s.can("inventory.write") ? ["Integrity check"] : []),
        ]}
        active={tab}
        onChange={setTab}
      />
      {tab === "Stock" && <StockList />}
      {tab === "Warehouses & locations" && <Warehouses />}
      {tab === "Movements" && <Movements />}
      {tab === "Integrity check" && <Integrity />}
    </>
  );
}

function StockList() {
  const wh = useWarehouses();
  const [warehouseId, setWarehouseId] = useState("");
  return (
    <ListPageNoHead
      warehouseId={warehouseId}
      setWarehouseId={setWarehouseId}
      warehouses={wh.data?.warehouses ?? []}
    />
  );
}
function ListPageNoHead({
  warehouseId,
  setWarehouseId,
  warehouses,
}: {
  warehouseId: string;
  setWarehouseId: (v: string) => void;
  warehouses: { id: string; name: string }[];
}) {
  const t = useT();
  return (
    <>
      <div className="toolbar">
        <select
          aria-label={t("stock.warehouse")}
          value={warehouseId}
          onChange={(e) => setWarehouseId(e.target.value)}
        >
          <option value="">{t("stock.allWarehouses")}</option>
          {warehouses.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
            </option>
          ))}
        </select>
      </div>
      <Levels warehouseId={warehouseId} />
    </>
  );
}
function Levels({ warehouseId }: { warehouseId: string }) {
  const t = useT();
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const r = useApi<{ items: Level[]; total: number }>(
    `/inventory/stock${qs({ q, warehouseId, page, pageSize: 25 })}`,
  );
  return (
    <Panel
      title={t("stock.stockOnHand")}
      actions={
        <input
          aria-label={t("stock.searchStock")}
          placeholder={t("stock.searchProductSkuOrLocation")}
          value={q}
          onChange={(e) => (setQ(e.target.value), setPage(1))}
          style={{ minWidth: 260 }}
        />
      }
    >
      <ErrorBanner message={r.error} />
      {r.data && (
        <>
          <DataTable
            rowKey={(l) => l.productId + l.locationId}
            rows={r.data.items}
            empty={t("stock.noStockRecordedYetReceive")}
            columns={[
              {
                header: t("stock.product"),
                cell: (l) => (
                  <Link href={`/products/${l.productId}`}>{l.name}</Link>
                ),
              },
              { header: "SKU", cell: (l) => l.sku },
              { header: t("stock.warehouse"), cell: (l) => l.warehouse },
              { header: t("stock.location"), cell: (l) => l.location },
              {
                header: t("stock.onHand"),
                align: "right",
                cell: (l) => l.onHand,
              },
              {
                header: t("stock.reserved"),
                align: "right",
                cell: (l) => l.reserved,
              },
              {
                header: t("stock.available"),
                align: "right",
                cell: (l) => l.available,
              },
            ]}
          />
          <Pager
            page={page}
            pageSize={25}
            total={r.data.total}
            onPage={setPage}
          />
        </>
      )}
    </Panel>
  );
}

function Warehouses() {
  const t = useT();
  const s = useSession();
  const w = useWarehouses();
  const [modal, setModal] = useState<{
    kind: "warehouse" | "location" | "edit";
    id?: string;
  } | null>(null);
  const act = useAction(w.reload);
  const can = s.can("warehouses.write");
  return (
    <>
      <Panel
        title={t("stock.warehouses")}
        actions={
          can && (
            <button
              className="primary"
              onClick={() => setModal({ kind: "warehouse" })}
            >
              {t("stock.newWarehouse")}
            </button>
          )
        }
      >
        <ErrorBanner message={act.error || w.error} onClose={act.clear} />
        {w.data?.warehouses.length === 0 && (
          <div className="notice">{t("stock.createYourFirstWarehouseTo")}</div>
        )}
        {w.data?.warehouses.map((x) => {
          const locs = w.data!.locations.filter((l) => l.warehouseId === x.id);
          return (
            <div key={x.id} style={{ marginBottom: 22 }}>
              <div className="panel-head">
                <h3 style={{ margin: 0 }}>
                  {x.name} <small className="muted">{x.code}</small>{" "}
                  <Badge value={x.status} />
                </h3>
                {can && (
                  <div className="actions">
                    <button
                      onClick={() => setModal({ kind: "location", id: x.id })}
                    >
                      {t("stock.addRackShelfBin")}
                    </button>
                    <button
                      onClick={() => setModal({ kind: "edit", id: x.id })}
                    >
                      {t("users.edit")}
                    </button>
                  </div>
                )}
              </div>
              <DataTable
                rowKey={(l) => l.id}
                rows={locs}
                columns={[
                  {
                    header: t("stock.locationCode"),
                    cell: (l) => <strong>{l.code}</strong>,
                  },
                  { header: t("stock.rack"), cell: (l) => l.rack },
                  { header: t("stock.shelf"), cell: (l) => l.shelf },
                  { header: t("stock.bin"), cell: (l) => l.bin },
                  {
                    header: t("lines.description"),
                    cell: (l) => l.description,
                  },
                ]}
              />
            </div>
          );
        })}
      </Panel>
      {modal?.kind === "warehouse" && (
        <FormModal
          title={t("stock.newWarehouse")}
          fields={[
            { name: "name", label: t("users.name"), required: true },
            {
              name: "address",
              label: t("settings.address"),
              type: "textarea",
              optional: true,
            },
          ]}
          onClose={() => setModal(null)}
          onSubmit={async (v) => (await post("/warehouses", v), w.reload())}
        />
      )}
      {modal?.kind === "edit" && (
        <FormModal
          title={t("stock.editWarehouse")}
          initial={w.data?.warehouses.find((x) => x.id === modal.id)}
          fields={[
            { name: "name", label: t("users.name"), required: true },
            {
              name: "address",
              label: t("settings.address"),
              type: "textarea",
              optional: true,
            },
            {
              name: "status",
              label: t("common.status"),
              type: "select",
              options: [
                { value: "ACTIVE", label: t("status.ACTIVE") },
                { value: "INACTIVE", label: t("status.INACTIVE") },
              ],
            },
          ]}
          onClose={() => setModal(null)}
          onSubmit={async (v) => (
            await patch(`/warehouses/${modal.id}`, v),
            w.reload()
          )}
        />
      )}
      {modal?.kind === "location" && (
        <FormModal
          title={t("stock.addRackShelfBin")}
          fields={[
            { name: "rack", label: t("stock.rack"), optional: true },
            { name: "shelf", label: t("stock.shelf"), optional: true },
            { name: "bin", label: t("stock.bin"), optional: true },
            {
              name: "description",
              label: t("lines.description"),
              optional: true,
            },
          ]}
          onClose={() => setModal(null)}
          onSubmit={async (v) => (
            await post(`/warehouses/${modal.id}/locations`, v),
            w.reload()
          )}
        />
      )}
    </>
  );
}

interface Move {
  id: string;
  productId: string;
  locationId: string;
  type: string;
  quantity: number;
  note: string;
  createdAt: string;
}
function Movements() {
  const t = useT();
  const w = useWarehouses();
  const opts = locationOptions(w.data);
  return (
    <ListPage<Move>
      title={t("stock.stockMovements")}
      endpoint="/inventory/movements"
      noSearch
      pageSize={30}
      rowKey={(m) => m.id}
      columns={[
        { header: t("audit.when"), cell: (m) => formatDateTime(m.createdAt) },
        {
          header: t("stock.product"),
          cell: (m) => (
            <Link href={`/products/${m.productId}`}>
              {t("stock.openProduct")}
            </Link>
          ),
        },
        { header: t("audit.type"), cell: (m) => titleCase(m.type) },
        {
          header: t("stock.location"),
          cell: (m) => opts.find((o) => o.value === m.locationId)?.label ?? "",
        },
        {
          header: t("stock.change"),
          align: "right",
          cell: (m) => (m.quantity > 0 ? `+${m.quantity}` : m.quantity),
        },
        { header: t("stock.note"), cell: (m) => m.note },
      ]}
    />
  );
}
function Integrity() {
  const t = useT();
  const r = useApi<
    { productId: string; locationId: string; message?: string }[]
  >("/inventory/integrity");
  return (
    <Panel
      title={t("stock.stockIntegrityCheck")}
      actions={
        <ConfirmButton
          label={t("stock.runAgain")}
          onConfirm={() => r.reload()}
        />
      }
    >
      {r.data && r.data.length === 0 && (
        <div className="notice">{t("stock.everyStockBalanceMatchesIts")}</div>
      )}
      {r.data && r.data.length > 0 && (
        <ErrorBanner
          message={`${r.data.length} balance(s) disagree with the movement ledger: ${JSON.stringify(r.data.slice(0, 5))}`}
        />
      )}
      <ErrorBanner message={r.error} />
    </Panel>
  );
}
