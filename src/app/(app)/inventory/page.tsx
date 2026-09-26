"use client";
import Link from "next/link";
import { useState } from "react";
import { useSession } from "../../../ui/session";
import { ListPage } from "../../../ui/ListPage";
import { Badge, ConfirmButton, DataTable, ErrorBanner, FormModal, Pager, Panel, Tabs, PageHead, useAction, useApi } from "../../../ui/kit";
import { formatDateTime, patch, post, qs, titleCase } from "../../../ui/api";
import { locationOptions, useWarehouses } from "../../../ui/stock";

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
  const [tab, setTab] = useState("Stock");
  const s = useSession();
  return (
    <>
      <PageHead title="Stock & locations" subtitle="Every quantity here is the sum of recorded stock movements." />
      <Tabs tabs={["Stock", "Warehouses & locations", "Movements", ...(s.can("inventory.write") ? ["Integrity check"] : [])]} active={tab} onChange={setTab} />
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
    <ListPageNoHead warehouseId={warehouseId} setWarehouseId={setWarehouseId} warehouses={wh.data?.warehouses ?? []} />
  );
}
function ListPageNoHead({ warehouseId, setWarehouseId, warehouses }: { warehouseId: string; setWarehouseId: (v: string) => void; warehouses: { id: string; name: string }[] }) {
  return (
    <>
      <div className="toolbar">
        <select aria-label="Warehouse" value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
          <option value="">All warehouses</option>
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
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const r = useApi<{ items: Level[]; total: number }>(`/inventory/stock${qs({ q, warehouseId, page, pageSize: 25 })}`);
  return (
    <Panel
      title="Stock on hand"
      actions={<input aria-label="Search stock" placeholder="Search product, SKU or location" value={q} onChange={(e) => (setQ(e.target.value), setPage(1))} style={{ minWidth: 260 }} />}
    >
      <ErrorBanner message={r.error} />
      {r.data && (
        <>
          <DataTable
            rowKey={(l) => l.productId + l.locationId}
            rows={r.data.items}
            empty="No stock recorded yet. Receive stock from a product page or a purchase order."
            columns={[
              { header: "Product", cell: (l) => <Link href={`/products/${l.productId}`}>{l.name}</Link> },
              { header: "SKU", cell: (l) => l.sku },
              { header: "Warehouse", cell: (l) => l.warehouse },
              { header: "Location", cell: (l) => l.location },
              { header: "On hand", align: "right", cell: (l) => l.onHand },
              { header: "Reserved", align: "right", cell: (l) => l.reserved },
              { header: "Available", align: "right", cell: (l) => l.available },
            ]}
          />
          <Pager page={page} pageSize={25} total={r.data.total} onPage={setPage} />
        </>
      )}
    </Panel>
  );
}

function Warehouses() {
  const s = useSession();
  const w = useWarehouses();
  const [modal, setModal] = useState<{ kind: "warehouse" | "location" | "edit"; id?: string } | null>(null);
  const act = useAction(w.reload);
  const can = s.can("warehouses.write");
  return (
    <>
      <Panel title="Warehouses" actions={can && <button className="primary" onClick={() => setModal({ kind: "warehouse" })}>New warehouse</button>}>
        <ErrorBanner message={act.error || w.error} onClose={act.clear} />
        {w.data?.warehouses.length === 0 && <div className="notice">Create your first warehouse to start recording stock.</div>}
        {w.data?.warehouses.map((x) => {
          const locs = w.data!.locations.filter((l) => l.warehouseId === x.id);
          return (
            <div key={x.id} style={{ marginBottom: 22 }}>
              <div className="panel-head">
                <h3 style={{ margin: 0 }}>
                  {x.name} <small className="muted">{x.code}</small> <Badge value={x.status} />
                </h3>
                {can && (
                  <div className="actions">
                    <button onClick={() => setModal({ kind: "location", id: x.id })}>Add rack / shelf / bin</button>
                    <button onClick={() => setModal({ kind: "edit", id: x.id })}>Edit</button>
                  </div>
                )}
              </div>
              <DataTable
                rowKey={(l) => l.id}
                rows={locs}
                columns={[
                  { header: "Location code", cell: (l) => <strong>{l.code}</strong> },
                  { header: "Rack", cell: (l) => l.rack },
                  { header: "Shelf", cell: (l) => l.shelf },
                  { header: "Bin", cell: (l) => l.bin },
                  { header: "Description", cell: (l) => l.description },
                ]}
              />
            </div>
          );
        })}
      </Panel>
      {modal?.kind === "warehouse" && (
        <FormModal title="New warehouse" fields={[{ name: "name", label: "Name", required: true }, { name: "address", label: "Address", type: "textarea", optional: true }]} onClose={() => setModal(null)} onSubmit={async (v) => (await post("/warehouses", v), w.reload())} />
      )}
      {modal?.kind === "edit" && (
        <FormModal
          title="Edit warehouse"
          initial={w.data?.warehouses.find((x) => x.id === modal.id)}
          fields={[{ name: "name", label: "Name", required: true }, { name: "address", label: "Address", type: "textarea", optional: true }, { name: "status", label: "Status", type: "select", options: [{ value: "ACTIVE", label: "Active" }, { value: "INACTIVE", label: "Inactive" }] }]}
          onClose={() => setModal(null)}
          onSubmit={async (v) => (await patch(`/warehouses/${modal.id}`, v), w.reload())}
        />
      )}
      {modal?.kind === "location" && (
        <FormModal
          title="Add rack / shelf / bin"
          fields={[
            { name: "rack", label: "Rack", optional: true },
            { name: "shelf", label: "Shelf", optional: true },
            { name: "bin", label: "Bin", optional: true },
            { name: "description", label: "Description", optional: true },
          ]}
          onClose={() => setModal(null)}
          onSubmit={async (v) => (await post(`/warehouses/${modal.id}/locations`, v), w.reload())}
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
  const w = useWarehouses();
  const opts = locationOptions(w.data);
  return (
    <ListPage<Move>
      title="Stock movements"
      endpoint="/inventory/movements"
      noSearch
      pageSize={30}
      rowKey={(m) => m.id}
      columns={[
        { header: "When", cell: (m) => formatDateTime(m.createdAt) },
        { header: "Product", cell: (m) => <Link href={`/products/${m.productId}`}>Open product</Link> },
        { header: "Type", cell: (m) => titleCase(m.type) },
        { header: "Location", cell: (m) => opts.find((o) => o.value === m.locationId)?.label ?? "" },
        { header: "Change", align: "right", cell: (m) => (m.quantity > 0 ? `+${m.quantity}` : m.quantity) },
        { header: "Note", cell: (m) => m.note },
      ]}
    />
  );
}
function Integrity() {
  const r = useApi<{ productId: string; locationId: string; message?: string }[]>("/inventory/integrity");
  return (
    <Panel title="Stock integrity check" actions={<ConfirmButton label="Run again" onConfirm={() => r.reload()} />}>
      {r.data && r.data.length === 0 && <div className="notice">Every stock balance matches its recorded movements and reservations.</div>}
      {r.data && r.data.length > 0 && <ErrorBanner message={`${r.data.length} balance(s) disagree with the movement ledger: ${JSON.stringify(r.data.slice(0, 5))}`} />}
      <ErrorBanner message={r.error} />
    </Panel>
  );
}
