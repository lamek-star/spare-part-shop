"use client";
import { use, useEffect, useState } from "react";
import {
  Badge,
  ConfirmButton,
  DataTable,
  ErrorBanner,
  KeyValues,
  Loading,
  Metrics,
  PageHead,
  Pager,
  Panel,
  useAction,
  useApi,
} from "../../../../../ui/kit";
import { formatDateTime, patch, post, qs } from "../../../../../ui/api";
import { useT } from "../../../../../ui/i18n";

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
  manifest: {
    issues?: { level: string; where: string; message: string }[];
    summary?: Record<
      string,
      { created: number; updated: number; unchanged: number; skipped: number }
    >;
  } | null;
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
const STATUSES = [
  "VALID",
  "INVALID",
  "DUPLICATE",
  "CONFLICT",
  "EXCLUDED",
  "IMPORTED",
  "UPDATED",
  "UNCHANGED",
];

export default function ImportJobPage({
  params,
}: {
  params: Promise<{ jobId: string }>;
}) {
  const t = useT();
  const { jobId } = use(params);
  const job = useApi<Job>(`/catalogue/import/jobs/${jobId}`);
  const [filter, setFilter] = useState("");
  const [page, setPage] = useState(1);
  const [rowTick, setRowTick] = useState(0);
  const rows = useApi<{ items: Row[]; total: number }>(
    job.data?.kind === "CSV"
      ? `/catalogue/import/jobs/${jobId}/rows${qs({ status: filter, page, pageSize: 25 })}`
      : null,
    rowTick,
  );
  const act = useAction(() => (job.reload(), setRowTick((t) => t + 1)));
  const running = job.data?.status === "RUNNING";
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => (job.reload(), setRowTick((x) => x + 1)), 1500);
    return () => clearInterval(t);
  }, [running, job]);
  if (job.loading && !job.data) return <Loading />;
  if (!job.data)
    return <ErrorBanner message={job.error || t("imp.notFound")} />;
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
            <Badge value={j.status} /> ·{" "}
            {j.kind === "CSV" ? "CSV import" : "Package import"} · started{" "}
            {formatDateTime(j.createdAt)}
          </>
        }
        back={{ href: "/catalogue/import", label: t("nav.import") }}
        actions={
          <>
            {(review || (j.kind === "CSV" && canResume)) && (
              <button
                className="primary"
                disabled={act.busy || (review && j.valid === 0)}
                onClick={() =>
                  void act.run(
                    () => post(`/catalogue/import/jobs/${jobId}/commit`),
                    t("imp.started"),
                  )
                }
              >
                {review
                  ? `Import ${j.valid.toLocaleString("en-US")} valid row(s)`
                  : "Resume import"}
              </button>
            )}
            {(review || running) && (
              <ConfirmButton
                danger
                label={t("cat.cancelImport")}
                confirmLabel={t("common.yesCancel")}
                onConfirm={() =>
                  act
                    .run(
                      () => post(`/catalogue/import/jobs/${jobId}/cancel`),
                      t("imp.cancelled"),
                    )
                    .then(() => undefined)
                }
              />
            )}
          </>
        }
      />
      <ErrorBanner message={act.error} onClose={act.clear} />
      {j.message && <div className="notice">{j.message}</div>}
      <Metrics
        items={[
          {
            label: t("cat.rowsDetected"),
            value: j.discovered.toLocaleString("en-US"),
          },
          {
            label: t("cat.valid"),
            value: j.valid.toLocaleString("en-US"),
            hint: `${j.invalid} invalid · ${j.duplicates} duplicate`,
          },
          {
            label: t("cat.processed"),
            value: `${j.processed.toLocaleString("en-US")} / ${j.discovered.toLocaleString("en-US")}`,
          },
          {
            label: t("cat.warningsErrors"),
            value: `${j.warnings} / ${j.errors}`,
          },
        ]}
      />
      {(j.created + j.updated + j.unchanged + j.skipped > 0 ||
        j.status === "COMPLETED" ||
        j.status === "COMPLETED_WITH_WARNINGS") && (
        <Metrics
          items={[
            {
              label: t("status.NEW"),
              value: j.created.toLocaleString("en-US"),
            },
            {
              label: t("cat.updated"),
              value: j.updated.toLocaleString("en-US"),
            },
            {
              label: t("cat.alreadyPresent"),
              value: j.unchanged.toLocaleString("en-US"),
            },
            {
              label: t("cat.skipped"),
              value: j.skipped.toLocaleString("en-US"),
            },
          ]}
        />
      )}
      {j.manifest?.summary && (
        <Panel title={t("cat.byTable")}>
          <DataTable
            rowKey={(r) => r[0]}
            rows={Object.entries(j.manifest.summary)}
            columns={[
              { header: t("cat.table"), cell: (r) => r[0] },
              {
                header: t("status.NEW"),
                align: "right",
                cell: (r) => r[1].created,
              },
              {
                header: t("cat.updated"),
                align: "right",
                cell: (r) => r[1].updated,
              },
              {
                header: t("cat.unchanged"),
                align: "right",
                cell: (r) => r[1].unchanged,
              },
              {
                header: t("cat.skipped"),
                align: "right",
                cell: (r) => r[1].skipped,
              },
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
              {
                header: t("cat.level"),
                cell: (i) => (
                  <Badge
                    value={i.level === "error" ? "FAILED" : "PENDING"}
                    label={i.level}
                  />
                ),
              },
              { header: t("cat.where"), cell: (i) => i.where },
              { header: t("cat.message"), cell: (i) => i.message },
            ]}
          />
        </Panel>
      )}
      {j.kind === "CSV" && (
        <Panel
          title={t("cat.rows")}
          actions={
            <select
              aria-label={t("cat.filterRows")}
              value={filter}
              onChange={(e) => (setFilter(e.target.value), setPage(1))}
            >
              <option value="">{t("cat.allRows")}</option>
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
                empty={t("cat.noRowsInThisView")}
                columns={[
                  {
                    header: t("cat.line"),
                    align: "right",
                    cell: (r) => r.rowNumber,
                  },
                  { header: t("cat.part"), cell: (r) => r.identity },
                  {
                    header: t("common.status"),
                    cell: (r) => <Badge value={r.status} />,
                  },
                  {
                    header: t("cat.will"),
                    cell: (r) =>
                      r.action === "NONE" ? "nothing" : r.action.toLowerCase(),
                  },
                  {
                    header: t("cat.problems"),
                    cell: (r) => [...r.errors, ...r.warnings].join(" · "),
                  },
                  {
                    header: "",
                    cell: (r) =>
                      review &&
                      ["VALID", "DUPLICATE", "EXCLUDED"].includes(r.status) ? (
                        <button
                          onClick={() =>
                            void act.run(() =>
                              patch(
                                `/catalogue/import/jobs/${jobId}/rows/${r.id}`,
                                { excluded: r.status !== "EXCLUDED" },
                              ),
                            )
                          }
                        >
                          {r.status === "EXCLUDED" ? "Include" : "Exclude"}
                        </button>
                      ) : null,
                  },
                ]}
              />
              <Pager
                page={page}
                pageSize={25}
                total={rows.data.total}
                onPage={setPage}
              />
            </>
          )}
        </Panel>
      )}
      <Panel title={t("customers.details")}>
        <KeyValues
          items={[
            ["Provider key", j.providerKey],
            ["Started", formatDateTime(j.startedAt)],
            ["Finished", formatDateTime(j.finishedAt)],
          ]}
        />
      </Panel>
    </>
  );
}
