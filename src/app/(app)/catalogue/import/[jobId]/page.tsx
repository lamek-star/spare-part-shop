"use client";
import { use, useEffect, useState } from "react";
import { Badge, ConfirmButton, DataTable, ErrorBanner, KeyValues, Loading, Metrics, PageHead, Pager, Panel, useAction, useApi } from "../../../../../ui/kit";
import { formatDateTime, patch, post, qs } from "../../../../../ui/api";

interface Job {
  id: string;
  kind: string;
  providerKey: string;
  sourceLabel: string;
  status: string;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  discovered: number;
  valid: number;
  invalid: number;
  duplicates: number;
  processed: number;
  created: number;
  updated: number;
  unchanged: number;
  skipped: number;
  warnings: number;
  errors: number;
  message: string;
  cancelRequested: boolean;
  manifest: { issues?: { level: string; where: string; message: string }[]; summary?: Record<string, { created: number; updated: number; unchanged: number; skipped: number }> } | null;
}
interface Row {
  id: string;
  rowNumber: number;
  status: string;
  action: string;
  identity: string;
  errors: string[];
  warnings: string[];
}
const STATUSES = ["VALID", "INVALID", "DUPLICATE", "CONFLICT", "EXCLUDED", "IMPORTED", "UPDATED", "UNCHANGED"];

export default function ImportJobPage({ params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = use(params);
  const job = useApi<Job>(`/catalogue/import/jobs/${jobId}`);
  const [filter, setFilter] = useState("");
  const [page, setPage] = useState(1);
  const [rowTick, setRowTick] = useState(0);
  const rows = useApi<{ items: Row[]; total: number }>(job.data?.kind === "CSV" ? `/catalogue/import/jobs/${jobId}/rows${qs({ status: filter, page, pageSize: 25 })}` : null, rowTick);
  const act = useAction(() => (job.reload(), setRowTick((t) => t + 1)));
  const running = job.data?.status === "RUNNING";
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => (job.reload(), setRowTick((x) => x + 1)), 1500);
    return () => clearInterval(t);
  }, [running, job]);
  if (job.loading && !job.data) return <Loading />;
  if (!job.data) return <ErrorBanner message={job.error || "Import not found."} />;
  const j = job.data;
  const review = j.status === "REVIEW_REQUIRED";
  const canResume = running || j.status === "FAILED";
  const issues = j.manifest?.issues ?? [];
  return (
    <>
      <PageHead
        title={j.sourceLabel}
        subtitle={
          <>
            <Badge value={j.status} /> · {j.kind === "CSV" ? "CSV import" : "Package import"} · started {formatDateTime(j.createdAt)}
          </>
        }
        back={{ href: "/catalogue/import", label: "Import" }}
        actions={
          <>
            {(review || (j.kind === "CSV" && canResume)) && (
              <button className="primary" disabled={act.busy || (review && j.valid === 0)} onClick={() => void act.run(() => post(`/catalogue/import/jobs/${jobId}/commit`), "Import started")}>
                {review ? `Import ${j.valid.toLocaleString("en-US")} valid row(s)` : "Resume import"}
              </button>
            )}
            {(review || running) && <ConfirmButton danger label="Cancel import" confirmLabel="Yes, cancel" onConfirm={() => act.run(() => post(`/catalogue/import/jobs/${jobId}/cancel`), "Import cancelled").then(() => undefined)} />}
          </>
        }
      />
      <ErrorBanner message={act.error} onClose={act.clear} />
      {j.message && <div className="notice">{j.message}</div>}
      <Metrics
        items={[
          { label: "Rows detected", value: j.discovered.toLocaleString("en-US") },
          { label: "Valid", value: j.valid.toLocaleString("en-US"), hint: `${j.invalid} invalid · ${j.duplicates} duplicate` },
          { label: "Processed", value: `${j.processed.toLocaleString("en-US")} / ${j.discovered.toLocaleString("en-US")}` },
          { label: "Warnings / errors", value: `${j.warnings} / ${j.errors}` },
        ]}
      />
      {(j.created + j.updated + j.unchanged + j.skipped > 0 || j.status === "COMPLETED" || j.status === "COMPLETED_WITH_WARNINGS") && (
        <Metrics
          items={[
            { label: "New", value: j.created.toLocaleString("en-US") },
            { label: "Updated", value: j.updated.toLocaleString("en-US") },
            { label: "Already present", value: j.unchanged.toLocaleString("en-US") },
            { label: "Skipped", value: j.skipped.toLocaleString("en-US") },
          ]}
        />
      )}
      {j.manifest?.summary && (
        <Panel title="By table">
          <DataTable
            rowKey={(r) => r[0]}
            rows={Object.entries(j.manifest.summary)}
            columns={[
              { header: "Table", cell: (r) => r[0] },
              { header: "New", align: "right", cell: (r) => r[1].created },
              { header: "Updated", align: "right", cell: (r) => r[1].updated },
              { header: "Unchanged", align: "right", cell: (r) => r[1].unchanged },
              { header: "Skipped", align: "right", cell: (r) => r[1].skipped },
            ]}
          />
        </Panel>
      )}
      {issues.length > 0 && (
        <Panel title={`Findings (${issues.length})`}>
          <DataTable
            rowKey={(i) => i.where + i.message}
            rows={issues.slice(0, 200)}
            columns={[
              { header: "Level", cell: (i) => <Badge value={i.level === "error" ? "FAILED" : "PENDING"} label={i.level} /> },
              { header: "Where", cell: (i) => i.where },
              { header: "Message", cell: (i) => i.message },
            ]}
          />
        </Panel>
      )}
      {j.kind === "CSV" && (
        <Panel
          title="Rows"
          actions={
            <select aria-label="Filter rows" value={filter} onChange={(e) => (setFilter(e.target.value), setPage(1))}>
              <option value="">All rows</option>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s.toLowerCase()}
                </option>
              ))}
            </select>
          }
        >
          {rows.data && (
            <>
              <DataTable
                rowKey={(r) => r.id}
                rows={rows.data.items}
                empty="No rows in this view."
                columns={[
                  { header: "Line", align: "right", cell: (r) => r.rowNumber },
                  { header: "Part", cell: (r) => r.identity },
                  { header: "Status", cell: (r) => <Badge value={r.status} /> },
                  { header: "Will", cell: (r) => (r.action === "NONE" ? "nothing" : r.action.toLowerCase()) },
                  { header: "Problems", cell: (r) => [...r.errors, ...r.warnings].join(" · ") },
                  {
                    header: "",
                    cell: (r) =>
                      review && ["VALID", "DUPLICATE", "EXCLUDED"].includes(r.status) ? (
                        <button onClick={() => void act.run(() => patch(`/catalogue/import/jobs/${jobId}/rows/${r.id}`, { excluded: r.status !== "EXCLUDED" }))}>{r.status === "EXCLUDED" ? "Include" : "Exclude"}</button>
                      ) : null,
                  },
                ]}
              />
              <Pager page={page} pageSize={25} total={rows.data.total} onPage={setPage} />
            </>
          )}
        </Panel>
      )}
      <Panel title="Details">
        <KeyValues items={[["Provider key", j.providerKey], ["Started", formatDateTime(j.startedAt)], ["Finished", formatDateTime(j.finishedAt)]]} />
      </Panel>
    </>
  );
}
