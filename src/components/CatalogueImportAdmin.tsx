"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { CatalogueClient } from "../catalogue/client";
import { isCatalogueAdmin } from "../catalogue/models";
import { parseCsv } from "../catalogue/providers";
import {
  ImportLine,
  importLinesFromCsv,
  parseImportLines,
  DEFAULT_BATCH_SIZE,
  DEFAULT_DELAY_MS,
  MAX_IMPORT_ITEMS,
} from "../catalogue/importParsing";
import type { ImportJob } from "../catalogue/importStore";
import { Field, Table } from "./ui";

const tabs = [
  "Import / Warm Up",
  "Import History",
  "Offline Readiness",
] as const;
type Tab = (typeof tabs)[number];

const activeStatuses = new Set(["PENDING", "RUNNING"]);
const failureResults = new Set(["PROVIDER_ERROR", "NOT_FOUND", "RESTRICTED"]);

function resultTone(result: string) {
  if (result === "IMPORTED" || result === "ALREADY_AVAILABLE") return "green";
  if (result === "NOT_FOUND" || result === "RESTRICTED") return "amber";
  return "red"; // PROVIDER_ERROR, INVALID_INPUT
}

/**
 * Admin catalogue warm-up/import — resolves an explicit, operator-supplied
 * list of OEM part numbers (single / pasted / CSV) through the existing
 * IntraForge-first search → Toyota EPC cache-miss path, one at a time,
 * with rate limiting. See docs/CATALOGUE_IMPORT.md.
 */
export default function CatalogueImportAdmin({ role }: { role: string }) {
  const client = useMemo(() => new CatalogueClient(role), [role]);
  const [tab, setTab] = useState<Tab>("Import / Warm Up");

  const [single, setSingle] = useState("");
  const [pasted, setPasted] = useState("");
  const [csvLines, setCsvLines] = useState<ImportLine[]>([]);
  const [csvName, setCsvName] = useState("");
  const [useProvider, setUseProvider] = useState(true);
  const [batchSize, setBatchSize] = useState(DEFAULT_BATCH_SIZE);
  const [delayMs, setDelayMs] = useState(DEFAULT_DELAY_MS);
  const [error, setError] = useState("");
  const [starting, setStarting] = useState(false);

  const [jobs, setJobs] = useState<ImportJob[]>([]);
  const [activeJob, setActiveJob] = useState<ImportJob>();
  const [overview, setOverview] =
    useState<Awaited<ReturnType<CatalogueClient["importOverview"]>>>();
  const pollRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  const refreshJobs = () =>
    client
      .importJobs()
      .then(setJobs)
      .catch((e) => setError(e.message));
  const refreshOverview = () =>
    client
      .importOverview()
      .then(setOverview)
      .catch((e) => setError(e.message));

  useEffect(() => {
    if (!isCatalogueAdmin(role)) return;
    refreshJobs();
    refreshOverview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, role]);

  // Poll the job currently being watched (and the list, so counts stay
  // live) while it's still PENDING/RUNNING. Stops itself once finished.
  useEffect(() => {
    if (!activeJob || !activeStatuses.has(activeJob.status)) {
      clearInterval(pollRef.current);
      return;
    }
    pollRef.current = setInterval(async () => {
      try {
        const job = await client.importJob(activeJob.job_id);
        setActiveJob(job);
        if (!activeStatuses.has(job.status)) {
          refreshJobs();
          refreshOverview();
        }
      } catch (e) {
        setError((e as Error).message);
      }
    }, 1000);
    return () => clearInterval(pollRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeJob?.job_id, activeJob?.status]);

  if (!isCatalogueAdmin(role))
    return (
      <section className="panel">
        <h2>Permission denied</h2>
        <p>
          Catalogue import / warm-up is available to the Owner and Administrator
          demo personas.
        </p>
      </section>
    );

  const linesFromCsv = csvLines;
  const previewCount =
    (single.trim() ? 1 : 0) +
    parseImportLines(pasted).length +
    linesFromCsv.length;

  async function start() {
    setError("");
    const lines: ImportLine[] = [
      ...(single.trim() ? [{ part_number: single.trim() }] : []),
      ...parseImportLines(pasted),
      ...linesFromCsv,
    ];
    if (lines.length === 0) {
      setError("Enter a part number, paste a list, or upload a CSV first.");
      return;
    }
    if (lines.length > MAX_IMPORT_ITEMS) {
      setError(
        `${lines.length} part numbers exceeds the ${MAX_IMPORT_ITEMS}-item controlled-import limit. Split into smaller batches.`,
      );
      return;
    }
    setStarting(true);
    try {
      const job = await client.startImport(
        lines,
        useProvider,
        batchSize,
        delayMs,
      );
      setActiveJob(job);
      setTab("Import History");
      setSingle("");
      setPasted("");
      setCsvLines([]);
      setCsvName("");
      refreshJobs();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setStarting(false);
    }
  }

  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h3>Catalogue Import / Warm Up</h3>
          <small className="muted">
            Resolve a controlled, explicit list of OEM part numbers while online
            so they search correctly offline afterward. Never a bulk scrape —
            see docs/CATALOGUE_IMPORT.md.
          </small>
        </div>
      </div>
      <div className="tabs">
        {tabs.map((t) => (
          <button
            key={t}
            className={tab === t ? "selected" : ""}
            onClick={() => setTab(t)}
          >
            {t}
          </button>
        ))}
      </div>
      {error && (
        <p role="alert" className="notice error">
          {error}
        </p>
      )}

      {tab === "Import / Warm Up" && (
        <>
          <Field label="Single OEM part number">
            <input
              value={single}
              onChange={(e) => setSingle(e.target.value)}
              placeholder="e.g. 15690-65010"
            />
          </Field>
          <Field label="Pasted list (one part number per line)">
            <textarea
              rows={6}
              value={pasted}
              onChange={(e) => setPasted(e.target.value)}
              placeholder={"90915-10009\n90915-10003\n90915-CA003\n15690-65010"}
            />
          </Field>
          <Field label="CSV upload (part_number, optional manufacturer/notes/internal_sku)">
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                try {
                  if (f.size > 2_000_000) throw new Error("CSV exceeds 2 MB.");
                  const text = await f.text();
                  const parsed = parseCsv(text);
                  setCsvLines(importLinesFromCsv(parsed));
                  setCsvName(f.name);
                  setError("");
                } catch (e) {
                  setError((e as Error).message);
                  setCsvLines([]);
                  setCsvName("");
                }
              }}
            />
          </Field>
          {csvName && (
            <p className="muted">
              {csvName}: {linesFromCsv.length} part number
              {linesFromCsv.length === 1 ? "" : "s"} parsed.
            </p>
          )}

          <label className="permission-option">
            <input
              type="checkbox"
              checked={useProvider}
              onChange={(e) => setUseProvider(e.target.checked)}
            />
            Resolve cache misses via the Toyota EPC provider (unchecked =
            cache-only check, no external request even if the provider is
            enabled).
          </label>

          <div className="form-grid">
            <Field label="Batch size (cooldown every N items)">
              <input
                type="number"
                min={1}
                max={25}
                value={batchSize}
                onChange={(e) =>
                  setBatchSize(Number(e.target.value) || DEFAULT_BATCH_SIZE)
                }
              />
            </Field>
            <Field label="Delay between requests (ms)">
              <input
                type="number"
                min={200}
                max={10000}
                step={50}
                value={delayMs}
                onChange={(e) =>
                  setDelayMs(Number(e.target.value) || DEFAULT_DELAY_MS)
                }
              />
            </Field>
          </div>

          <p className="muted">
            {previewCount} part number{previewCount === 1 ? "" : "s"} queued.
            Processed strictly one at a time, never in parallel — see
            docs/CATALOGUE_IMPORT.md "Batch control".
          </p>

          <div className="actions">
            <button
              className="primary"
              disabled={starting || previewCount === 0}
              onClick={start}
            >
              {starting ? "Starting…" : "Start import"}
            </button>
          </div>
        </>
      )}

      {tab === "Import History" && (
        <>
          {activeJob && (
            <JobPanel
              job={activeJob}
              client={client}
              onCancelled={refreshJobs}
              onRetried={(j) => {
                setActiveJob(j);
                refreshJobs();
              }}
            />
          )}
          <h3>Recent import jobs</h3>
          <Table
            headers={[
              "Started",
              "Status",
              "Input",
              "Imported",
              "Already available",
              "Not found",
              "Errors/restricted/invalid",
              "By",
              "",
            ]}
            rows={jobs.map((j) => [
              new Date(j.started_at).toLocaleString(),
              j.status,
              j.input_count,
              j.imported_count,
              j.already_available_count,
              j.not_found_count,
              j.error_count,
              j.created_by,
              <button key="view" onClick={() => setActiveJob(j)}>
                View
              </button>,
            ])}
          />
        </>
      )}

      {tab === "Offline Readiness" && overview && (
        <div className="metrics">
          <div className="metric">
            <span>Cached OEM parts</span>
            <strong>{overview.cachedParts}</strong>
          </div>
          <div className="metric">
            <span>Cached diagrams</span>
            <strong>{overview.cachedDiagrams}</strong>
          </div>
          <div className="metric">
            <span>Cached callouts</span>
            <strong>{overview.cachedCallouts}</strong>
          </div>
          <div className="metric">
            <span>Parts with hotspot data</span>
            <strong>{overview.partsWithHotspot}</strong>
          </div>
          <div className="metric">
            <span>Last import</span>
            <strong>
              {overview.lastImportAt
                ? new Date(overview.lastImportAt).toLocaleString()
                : "never"}
            </strong>
          </div>
          <div className="metric">
            <span>Provider currently enabled</span>
            <strong>{overview.providerEnabled ? "yes" : "no"}</strong>
          </div>
          <div className="metric">
            <span>Offline-ready cached records</span>
            <strong>{overview.offlineReadyRecords}</strong>
          </div>
        </div>
      )}
    </section>
  );
}

function JobPanel({
  job,
  client,
  onCancelled,
  onRetried,
}: {
  job: ImportJob;
  client: CatalogueClient;
  onCancelled: () => void;
  onRetried: (job: ImportJob) => void;
}) {
  const [busy, setBusy] = useState(false);
  const hasRetryable = job.items.some((i) => failureResults.has(i.result));
  return (
    <div className="batch-review">
      <h3>Job {job.job_id.slice(0, 8)}</h3>
      <p>
        {job.status} · {job.imported_count} imported ·{" "}
        {job.already_available_count} already available · {job.not_found_count}{" "}
        not found · {job.error_count} errors/restricted/invalid · started{" "}
        {new Date(job.started_at).toLocaleString()}
        {job.finished_at
          ? ` · finished ${new Date(job.finished_at).toLocaleString()}`
          : ""}
      </p>
      <div className="actions">
        {activeStatuses.has(job.status) && (
          <button
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await client.cancelImport(job.job_id);
                onCancelled();
              } finally {
                setBusy(false);
              }
            }}
          >
            Cancel import
          </button>
        )}
        {!activeStatuses.has(job.status) && hasRetryable && (
          <button
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                onRetried(await client.retryImport(job.job_id));
              } catch (e) {
                alert((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            Retry failed items
          </button>
        )}
      </div>
      <Table
        headers={["Part number", "Result", "Provider", "Message", "At"]}
        rows={job.items
          .slice()
          .reverse()
          .map((i) => [
            i.part_number,
            <span key="r" className={`badge ${resultTone(i.result)}`}>
              {i.result.replace(/_/g, " ")}
            </span>,
            i.provider || "—",
            i.message,
            new Date(i.created_at).toLocaleTimeString(),
          ])}
      />
    </div>
  );
}
