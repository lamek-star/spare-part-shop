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
import { useT } from "../../../../ui/i18n";
import { apiUrl } from "@/lib/basePath";

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
  const t = useT();
  const { id } = use(params);
  const s = useSession();
  const po = useApi<PO>(`/purchase-orders/${id}`);
  const supplier = useApi<{ name: string }>(
    po.data ? `/suppliers/${po.data.supplierId}` : null,
  );
  const products = useApi<{
    items: { id: string; sku: string; name: string; trackBatches?: boolean }[];
  }>(po.data ? `/products?pageSize=100` : null);
  // Medicines: the batch number and expiry date printed on the delivered packs, per order line.
  const [batches, setBatches] = useState<
    Record<string, { batchNo: string; expiryDate: string }>
  >({});
  const act = useAction(po.reload);
  const [receiving, setReceiving] = useState<Record<string, string> | null>(
    null,
  );
  if (po.loading && !po.data) return <Loading />;
  if (!po.data)
    return <ErrorBanner message={po.error || t("purch.notFound")} />;
  const x = po.data;
  const w = s.can("purchasing.write");
  const name = (pid: string) => products.data?.items.find((p) => p.id === pid);
  const step = (path: string, msg: string) =>
    act.run(() => post(`/purchase-orders/${id}/${path}`), msg);
  async function receive() {
    const lines = Object.entries(receiving ?? {}).map(([lineId, v]) => ({
      lineId,
      quantity: Number(v || 0),
      ...(batches[lineId] ?? {}),
    }));
    const ok = await act.run(
      () => post(`/purchase-orders/${id}/receive`, { lines }),
      t("purch.received"),
    );
    if (ok) {
      setReceiving(null);
      setBatches({});
    }
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
        back={{ href: "/purchasing", label: t("suppliers.purchaseOrders") }}
        actions={
          <>
            <a
              className="button"
              href={apiUrl(`/purchase-orders/${id}/pdf`)}
              target="_blank"
              rel="noreferrer"
            >
              {t("docs.downloadPdf")}
            </a>
            {w && (
            <>
              {x.status === "DRAFT" && (
                <button
                  className="primary"
                  onClick={() => void step("confirm", t("purch.confirmed"))}
                >
                  {t("common.confirm")}
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
                    {t("purch.receiveGoods")}
                  </button>
                )}
              {x.status === "PARTIALLY_RECEIVED" && (
                <ConfirmButton
                  label={t("purch.closeAcceptShortfall")}
                  onConfirm={() =>
                    step("close", t("purch.closed")).then(() => undefined)
                  }
                />
              )}
              {["DRAFT", "CONFIRMED"].includes(x.status) && (
                <ConfirmButton
                  danger
                  label={t("common.cancel")}
                  confirmLabel={t("common.yesCancel")}
                  onConfirm={() =>
                    step("cancel", t("purch.cancelled")).then(() => undefined)
                  }
                />
              )}
            </>
            )}
          </>
        }
      />
      <ErrorBanner message={act.error} onClose={act.clear} />
      <Panel title={t("orders.order")}>
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
      <Panel title={t("docs.items")}>
        <DataTable
          rowKey={(l) => l.id}
          rows={x.lines}
          columns={[
            {
              header: t("purch.product"),
              cell: (l) => (
                <Link href={`/products/${l.productId}`}>
                  {name(l.productId)?.name ?? l.productId}
                </Link>
              ),
            },
            {
              header: t("purch.ordered"),
              align: "right",
              cell: (l) => l.quantity,
            },
            {
              header: t("status.RECEIVED"),
              align: "right",
              cell: (l) => l.quantityReceived,
            },
            {
              header: t("lines.unitCost"),
              align: "right",
              cell: (l) => (
                <Money minor={l.unitCostMinor} currency={x.currency} />
              ),
            },
            {
              header: t("doc.total"),
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
        <Modal
          title={t("purch.receiveGoods")}
          onClose={() => setReceiving(null)}
        >
          <p className="muted">{t("purch.enterWhatActuallyArrivedStock")}</p>
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
                {name(l.productId)?.trackBatches && (
                  <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
                    <input
                      aria-label={t("purch.batchNumber")}
                      placeholder={t("purch.batchNumber")}
                      value={batches[l.id]?.batchNo ?? ""}
                      onChange={(e) =>
                        setBatches({
                          ...batches,
                          [l.id]: {
                            expiryDate: batches[l.id]?.expiryDate ?? "",
                            batchNo: e.target.value,
                          },
                        })
                      }
                    />
                    <input
                      type="date"
                      aria-label={t("purch.expiryDate")}
                      value={batches[l.id]?.expiryDate ?? ""}
                      onChange={(e) =>
                        setBatches({
                          ...batches,
                          [l.id]: {
                            batchNo: batches[l.id]?.batchNo ?? "",
                            expiryDate: e.target.value,
                          },
                        })
                      }
                    />
                  </div>
                )}
              </FieldBox>
            ))}
          <ErrorBanner message={act.error} />
          <div className="form-actions">
            <button
              className="primary"
              disabled={act.busy}
              onClick={() => void receive()}
            >
              {t("purch.receiveIntoStock")}
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
