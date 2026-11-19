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
import { useT } from "../../../ui/i18n";

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
  const t = useT();
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
      header: t("pharm.medicine"),
      cell: (b: ExpiringBatch) => (
        <Link href={`/products/${b.productId}`}>
          <strong>{b.name}</strong>
          {b.genericName && <div className="muted">{b.genericName}</div>}
        </Link>
      ),
    },
    { header: t("prod.batch"), cell: (b: ExpiringBatch) => b.batchNo },
    {
      header: t("prod.expires"),
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
    { header: t("prod.location"), cell: (b: ExpiringBatch) => b.locationCode },
    {
      header: t("prod.units"),
      align: "right" as const,
      cell: (b: ExpiringBatch) => b.onHand,
    },
    ...(withWriteOff && canWrite
      ? [
          {
            header: "",
            cell: (b: ExpiringBatch) => (
              <ConfirmButton
                label={t("pharm.writeOff")}
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
        title={t("pharm.expiryBatches")}
        subtitle={t("pharm.medicinesAreSoldFromThe")}
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
              { label: t("pharm.expiredBatches"), value: expired.length },
              {
                label: t("pharm.expiredUnits"),
                value: expired.reduce((n, b) => n + b.onHand, 0),
              },
              { label: `Expiring within ${days} days`, value: soon.length },
              {
                label: t("pharm.toReorder"),
                value: low.data ? low.data.length : "—",
              },
            ]}
          />
          <Panel
            title={t("pharm.expiredCannotBeSold")}
            actions={
              canWrite && expired.length > 0 ? (
                <ConfirmButton
                  label={t("pharm.writeOffAllExpired")}
                  confirmLabel={`Write off ${expired.length} batches?`}
                  danger
                  onConfirm={() =>
                    void action.run(
                      () => post("/inventory/write-off-expired", {}),
                      t("pharm.writtenOff"),
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
              empty={t("pharm.noExpiredStock")}
            />
          </Panel>
          <Panel title={`Expiring within ${days} days`}>
            <DataTable
              columns={columns(false)}
              rows={soon}
              rowKey={(b) => b.id}
              empty={t("pharm.nothingExpiresInThisPeriod")}
            />
          </Panel>
          {low.data && (
            <Panel title={t("pharm.atOrBelowTheReorder")}>
              <DataTable
                columns={[
                  {
                    header: t("prod.product"),
                    cell: (r: LowStockRow) => (
                      <Link href={`/products/${r.productId}`}>{r.name}</Link>
                    ),
                  },
                  {
                    header: t("pharm.skuBarcode"),
                    cell: (r: LowStockRow) => r.sku,
                  },
                  {
                    header: t("prod.available"),
                    align: "right",
                    cell: (r: LowStockRow) => r.available,
                  },
                  {
                    header: t("prod.reorderLevel"),
                    align: "right",
                    cell: (r: LowStockRow) => r.reorderLevel,
                  },
                ]}
                rows={low.data}
                rowKey={(r) => r.productId}
                empty={t("pharm.nothingNeedsReordering")}
              />
            </Panel>
          )}
        </>
      )}
    </>
  );
}
