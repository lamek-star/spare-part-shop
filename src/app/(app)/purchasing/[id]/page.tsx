"use client";
import Link from "next/link";
import { use, useState } from "react";
import { useSession } from "../../../../ui/session";
import {
  Badge,
  ConfirmButton,
  DataTable,
  ErrorBanner,
  FieldBox,
  KeyValues,
  Loading,
  Modal,
  Money,
  PageHead,
  Panel,
  useAction,
  useApi,
} from "../../../../ui/kit";
import { formatDate, post } from "../../../../ui/api";
import { TotalsBox } from "../../../../ui/doc";

interface Line {
  id: string;
  productId: string;
  quantity: number;
  quantityReceived: number;
  unitCostMinor: number;
  discountBp: number;
  lineTotalMinor: number;
}
interface PO {
  id: string;
  number: string;
  status: string;
  supplierId: string;
  locationId: string;
  currency: string;
  taxBp: number;
  expectedDate: string | null;
  notes: string;
  subtotalMinor: number;
  taxMinor: number;
  totalMinor: number;
  lines: Line[];
}
export default function PurchaseOrderPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const s = useSession();
  const po = useApi<PO>(`/purchase-orders/${id}`);
  const supplier = useApi<{ name: string }>(
    po.data ? `/suppliers/${po.data.supplierId}` : null,
  );
  const products = useApi<{
    items: { id: string; sku: string; name: string }[];
  }>(po.data ? `/products?pageSize=100` : null);
  const act = useAction(po.reload);
  const [receiving, setReceiving] = useState<Record<string, string> | null>(
    null,
  );
  if (po.loading && !po.data) return <Loading />;
  if (!po.data)
    return <ErrorBanner message={po.error || "Purchase order not found."} />;
  const x = po.data;
  const w = s.can("purchasing.write");
  const name = (pid: string) => products.data?.items.find((p) => p.id === pid);
  const step = (path: string, msg: string) =>
    act.run(() => post(`/purchase-orders/${id}/${path}`), msg);
  async function receive() {
    const lines = Object.entries(receiving ?? {}).map(([lineId, v]) => ({
      lineId,
      quantity: Number(v || 0),
    }));
    const ok = await act.run(
      () => post(`/purchase-orders/${id}/receive`, { lines }),
      "Goods received into stock",
    );
    if (ok) setReceiving(null);
  }
  return (
    <>
      <PageHead
        title={x.number}
        subtitle={
          <>
            <Badge value={x.status} /> · expected {formatDate(x.expectedDate)}
          </>
        }
        back={{ href: "/purchasing", label: "Purchase orders" }}
        actions={
          w && (
            <>
              {x.status === "DRAFT" && (
                <button
                  className="primary"
                  onClick={() =>
                    void step("confirm", "Purchase order confirmed")
                  }
                >
                  Confirm
                </button>
              )}
              {["CONFIRMED", "PARTIALLY_RECEIVED"].includes(x.status) &&
                s.can("inventory.write") && (
                  <button
                    className="primary"
                    onClick={() =>
                      setReceiving(
                        Object.fromEntries(
                          x.lines.map((l) => [
                            l.id,
                            String(l.quantity - l.quantityReceived),
                          ]),
                        ),
                      )
                    }
                  >
                    Receive goods
                  </button>
                )}
              {x.status === "PARTIALLY_RECEIVED" && (
                <ConfirmButton
                  label="Close (accept shortfall)"
                  onConfirm={() =>
                    step("close", "Purchase order closed").then(() => undefined)
                  }
                />
              )}
              {["DRAFT", "CONFIRMED"].includes(x.status) && (
                <ConfirmButton
                  danger
                  label="Cancel"
                  confirmLabel="Yes, cancel"
                  onConfirm={() =>
                    step("cancel", "Purchase order cancelled").then(
                      () => undefined,
                    )
                  }
                />
              )}
            </>
          )
        }
      />
      <ErrorBanner message={act.error} onClose={act.clear} />
      <Panel title="Order">
        <KeyValues
          items={[
            [
              "Supplier",
              supplier.data ? (
                <Link key="s" href={`/suppliers/${x.supplierId}`}>
                  {supplier.data.name}
                </Link>
              ) : (
                ""
              ),
            ],
            ["Notes", x.notes],
          ]}
        />
      </Panel>
      <Panel title="Items">
        <DataTable
          rowKey={(l) => l.id}
          rows={x.lines}
          columns={[
            {
              header: "Product",
              cell: (l) => (
                <Link href={`/products/${l.productId}`}>
                  {name(l.productId)?.name ?? l.productId}
                </Link>
              ),
            },
            { header: "Ordered", align: "right", cell: (l) => l.quantity },
            {
              header: "Received",
              align: "right",
              cell: (l) => l.quantityReceived,
            },
            {
              header: "Unit cost",
              align: "right",
              cell: (l) => (
                <Money minor={l.unitCostMinor} currency={x.currency} />
              ),
            },
            {
              header: "Total",
              align: "right",
              cell: (l) => (
                <Money minor={l.lineTotalMinor} currency={x.currency} />
              ),
            },
          ]}
        />
        <TotalsBox
          subtotalMinor={x.subtotalMinor}
          taxMinor={x.taxMinor}
          totalMinor={x.totalMinor}
          taxBp={x.taxBp}
          currency={x.currency}
        />
      </Panel>
      {receiving && (
        <Modal title="Receive goods" onClose={() => setReceiving(null)}>
          <p className="muted">
            Enter what actually arrived. Stock increases when you save.
          </p>
          {x.lines
            .filter((l) => l.quantity > l.quantityReceived)
            .map((l) => (
              <FieldBox
                key={l.id}
                label={`${name(l.productId)?.name ?? "Product"} (still expected ${l.quantity - l.quantityReceived})`}
              >
                <input
                  inputMode="numeric"
                  value={receiving[l.id] ?? ""}
                  onChange={(e) =>
                    setReceiving({ ...receiving, [l.id]: e.target.value })
                  }
                />
              </FieldBox>
            ))}
          <ErrorBanner message={act.error} />
          <div className="form-actions">
            <button
              className="primary"
              disabled={act.busy}
              onClick={() => void receive()}
            >
              Receive into stock
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
