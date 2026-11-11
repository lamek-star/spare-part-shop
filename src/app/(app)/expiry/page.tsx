"use client";
import Link from "next/link";
import { useState } from "react";
import { post } from "../../../ui/api";
import {
  ConfirmButton,
  DataTable,
  ErrorBanner,
  Loading,
  Metrics,
  PageHead,
  Panel,
  useAction,
  useApi,
} from "../../../ui/kit";
import { useSession } from "../../../ui/session";

interface ExpiringBatch {
  id: string;
  productId: string;
  sku: string;
  name: string;
  genericName: string;
  batchNo: string;
  expiryDate: string;
  locationCode: string;
  onHand: number;
  daysLeft: number;
  expired: boolean;
}
interface LowStockRow {
  productId: string;
  sku: string;
  name: string;
  available: number;
  reorderLevel: number;
}
const WINDOWS = [30, 60, 90, 180] as const;

/** Batches that expire soon or have expired, what to reorder, and writing off expired stock. */
export default function ExpiryPage() {
  const s = useSession();
  const [days, setDays] = useState<number>(90);
  const [refresh, setRefresh] = useState(0);
  const expiring = useApi<{
    today: string;
    until: string;
    items: ExpiringBatch[];
  }>(`/inventory/expiring?days=${days}`, refresh);
  const low = useApi<LowStockRow[]>(
    s.can("reports.inventory") ? "/reports/low-stock" : null,
    refresh,
  );
  const action = useAction(() => setRefresh((n) => n + 1));
  const items = expiring.data?.items ?? [];
  const expired = items.filter((b) => b.expired);
  const soon = items.filter((b) => !b.expired);
  const canWrite = s.can("inventory.write");

  const columns = (withWriteOff: boolean) => [
    {
      header: "Medicine",
      cell: (b: ExpiringBatch) => (
        <Link href={`/products/${b.productId}`}>
          <strong>{b.name}</strong>
          {b.genericName && <div className="muted">{b.genericName}</div>}
        </Link>
      ),
    },
    { header: "Batch", cell: (b: ExpiringBatch) => b.batchNo },
    {
      header: "Expires",
      cell: (b: ExpiringBatch) => (
        <span
          className={`badge ${b.expired ? "red" : b.daysLeft <= 30 ? "amber" : "green"}`}
        >
          {b.expiryDate}
          {b.expired
            ? " · expired"
            : ` · ${b.daysLeft} day${b.daysLeft === 1 ? "" : "s"}`}
        </span>
      ),
    },
    { header: "Location", cell: (b: ExpiringBatch) => b.locationCode },
    {
      header: "Units",
      align: "right" as const,
      cell: (b: ExpiringBatch) => b.onHand,
    },
    ...(withWriteOff && canWrite
      ? [
          {
            header: "",
            cell: (b: ExpiringBatch) => (
              <ConfirmButton
                label="Write off"
                confirmLabel={`Write off ${b.onHand}?`}
                danger
                onConfirm={() =>
                  void action.run(
                    () =>
                      post("/inventory/write-off-expired", { batchId: b.id }),
                    `Batch ${b.batchNo} written off`,
                  )
                }
              />
            ),
          },
        ]
      : []),
  ];

  return (
    <>
      <PageHead
        title="Expiry & batches"
        subtitle="Medicines are sold from the batch that expires first. Expired batches are never sold: write them off here so the stock and the accounts are right."
        actions={
          <label>
            Show what expires within{" "}
            <select
              value={days}
              onChange={(e) => setDays(Number(e.target.value))}
            >
              {WINDOWS.map((d) => (
                <option key={d} value={d}>
                  {d} days
                </option>
              ))}
            </select>
          </label>
        }
      />
      <ErrorBanner message={expiring.error || action.error} />
      {expiring.loading && !expiring.data ? (
        <Loading />
      ) : (
        <>
          <Metrics
            items={[
              { label: "Expired batches", value: expired.length },
              {
                label: "Expired units",
                value: expired.reduce((n, b) => n + b.onHand, 0),
              },
              { label: `Expiring within ${days} days`, value: soon.length },
              { label: "To reorder", value: low.data ? low.data.length : "—" },
            ]}
          />
          <Panel
            title="Expired — cannot be sold"
            actions={
              canWrite && expired.length > 0 ? (
                <ConfirmButton
                  label="Write off all expired"
                  confirmLabel={`Write off ${expired.length} batches?`}
                  danger
                  onConfirm={() =>
                    void action.run(
                      () => post("/inventory/write-off-expired", {}),
                      "Expired stock written off",
                    )
                  }
                />
              ) : undefined
            }
          >
            <DataTable
              columns={columns(true)}
              rows={expired}
              rowKey={(b) => b.id}
              empty="No expired stock."
            />
          </Panel>
          <Panel title={`Expiring within ${days} days`}>
            <DataTable
              columns={columns(false)}
              rows={soon}
              rowKey={(b) => b.id}
              empty="Nothing expires in this period."
            />
          </Panel>
          {low.data && (
            <Panel title="At or below the reorder level">
              <DataTable
                columns={[
                  {
                    header: "Product",
                    cell: (r: LowStockRow) => (
                      <Link href={`/products/${r.productId}`}>{r.name}</Link>
                    ),
                  },
                  { header: "SKU / barcode", cell: (r: LowStockRow) => r.sku },
                  {
                    header: "Available",
                    align: "right",
                    cell: (r: LowStockRow) => r.available,
                  },
                  {
                    header: "Reorder level",
                    align: "right",
                    cell: (r: LowStockRow) => r.reorderLevel,
                  },
                ]}
                rows={low.data}
                rowKey={(r) => r.productId}
                empty="Nothing needs reordering."
              />
            </Panel>
          )}
        </>
      )}
    </>
  );
}
