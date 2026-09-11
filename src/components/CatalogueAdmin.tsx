"use client";
import { useState, useEffect, useMemo } from "react";
import { CatalogueClient, BatchView } from "../catalogue/client";
import {
  AdminOverview,
  ColumnMapping,
  csvFields,
  isCatalogueAdmin,
  ImageRights,
  Page,
  ReferenceHit,
} from "../catalogue/models";
import { parseCsv } from "../catalogue/providers";
import { Field, Table, Badge } from "./ui";
const tabs = [
  "Catalogue Sources",
  "Import Batches",
  "Staged Records",
  "Import Errors",
  "Duplicates",
  "Verification Queue",
  "Image Rights",
  "Catalogue Statistics",
];
export default function CatalogueAdmin({ role }: { role: string }) {
  const client = useMemo(() => new CatalogueClient(role), [role]);
  const [tab, setTab] = useState(tabs[0]);
  const [overview, setOverview] = useState<AdminOverview>();
  const [batch, setBatch] = useState<BatchView>();
  const [csv, setCsv] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [mapping, setMapping] = useState<ColumnMapping>({});
  const [attested, setAttested] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [queue, setQueue] = useState<Page<ReferenceHit>>();
  const [queuePage, setQueuePage] = useState(1);
  const [reviewImage, setReviewImage] = useState("");
  const [evidence, setEvidence] = useState("");
  const [rights, setRights] = useState<ImageRights>("LICENSE_UNKNOWN");
  const refresh = async () => {
    setOverview(await client.admin());
  };
  useEffect(() => {
    if (isCatalogueAdmin(role)) {
      client
        .admin()
        .then(setOverview)
        .catch((e) => setError(e.message));
    }
  }, [client, role]);
  useEffect(() => {
    if (tab === "Verification Queue")
      client
        .searchParts("", queuePage)
        .then(setQueue)
        .catch((e) => setError(e.message));
  }, [tab, queuePage, client]);
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
      await refresh();
      setError("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  if (!isCatalogueAdmin(role))
    return (
      <section className="panel">
        <h2>Permission denied</h2>
        <p>
          Catalogue administration is available to the Owner and Administrator
          demo personas. Sales and store operations remain separate.
        </p>
      </section>
    );
  return (
    <section className="panel">
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
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {busy && <p role="status">Saving catalogue changes…</p>}
      {tab === "Catalogue Sources" ? (
        <Table
          headers={[
            "Provider",
            "Type",
            "License / redistribution",
            "Images",
            "Feed",
            "Enabled",
            "Review",
          ]}
          rows={(overview?.sources ?? []).map((s) => [
            s.name,
            s.type,
            `${s.licenseStatus} / ${s.redistributionStatus}`,
            s.imageUsageStatus,
            s.feedAvailability,
            s.active ? "Yes" : "No",
            <>
              {s.lastChecked}
              <small>{s.notes}</small>
            </>,
          ])}
        />
      ) : tab === "Catalogue Statistics" ? (
        <div className="metrics">
          {Object.entries(overview?.statistics ?? {}).map(([k, v]) => (
            <div className="metric" key={k}>
              <span>{k}</span>
              <strong>{v}</strong>
            </div>
          ))}
        </div>
      ) : tab === "Image Rights" ? (
        <>
          <Table
            headers={["Image", "Rights", "Attribution", ""]}
            rows={(overview?.images ?? []).map((i) => [
              i.id,
              i.rights,
              i.attribution,
              <button
                onClick={() => {
                  setReviewImage(i.id);
                  setRights(i.rights);
                  setEvidence("");
                }}
              >
                Review rights
              </button>,
            ])}
          />
          {reviewImage && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void run(async () => {
                  await client.command({
                    action: "rights",
                    id: reviewImage,
                    rights,
                    evidence,
                  });
                  setReviewImage("");
                });
              }}
            >
              <Field label="Image rights">
                <select
                  value={rights}
                  onChange={(e) => setRights(e.target.value as ImageRights)}
                >
                  {[
                    "EXTERNAL_REFERENCE",
                    "LICENSE_UNKNOWN",
                    "LICENSED_FOR_INTERNAL_USE",
                    "LICENSED_FOR_DISPLAY",
                    "COMPANY_OWNED",
                    "MANUFACTURER_AUTHORIZED",
                    "DO_NOT_REPUBLISH",
                  ].map((r) => (
                    <option key={r}>{r}</option>
                  ))}
                </select>
              </Field>
              <Field label="Rights evidence or reason">
                <textarea
                  value={evidence}
                  minLength={12}
                  required
                  onChange={(e) => setEvidence(e.target.value)}
                />
              </Field>
              <button className="primary" disabled={busy}>
                Save rights review
              </button>
            </form>
          )}
        </>
      ) : tab === "Verification Queue" ? (
        <>
          <Table
            headers={["Part", "Verification", "Source", "Review"]}
            rows={(queue?.items ?? []).map((h) => [
              h.part.description,
              h.part.provenance.verification,
              h.part.provenance.sourceProvider,
              <div className="actions">
                <button
                  onClick={() =>
                    run(async () => {
                      await client.command({
                        action: "verify",
                        id: h.part.id,
                        status: "MANUALLY_VERIFIED",
                      });
                      setQueue(await client.searchParts("", queuePage));
                    })
                  }
                >
                  Mark manually verified
                </button>
                <button
                  onClick={() =>
                    run(async () => {
                      await client.command({
                        action: "verify",
                        id: h.part.id,
                        status: "DISPUTED",
                      });
                      setQueue(await client.searchParts("", queuePage));
                    })
                  }
                >
                  Dispute
                </button>
              </div>,
            ])}
          />
          <div className="pagination">
            <button
              disabled={queuePage === 1}
              onClick={() => setQueuePage(queuePage - 1)}
            >
              Previous
            </button>
            <span>{queuePage}</span>
            <button
              disabled={!queue || queuePage * 20 >= queue.total}
              onClick={() => setQueuePage(queuePage + 1)}
            >
              Next
            </button>
          </div>
        </>
      ) : (
        <>
          {tab === "Import Batches" && (
            <>
              <h3>Import a CSV catalogue</h3>
              <p className="muted">
                Upload → map columns → validate in staging → review → publish.
                Maximum 2 MB / 1,000 rows. Reference imports never modify
                company inventory or pricing.
              </p>
              <a className="text-link" href="/catalogue-example.csv" download>
                Download original demo CSV
              </a>
              <Field label="Upload CSV">
                <input
                  type="file"
                  accept=".csv,text/csv"
                  onChange={async (e) => {
                    const f = e.target.files?.[0];
                    if (!f) return;
                    try {
                      if (f.size > 2_000_000)
                        throw new Error("CSV exceeds 2 MB.");
                      const text = await f.text();
                      const parsed = parseCsv(text);
                      setCsv(text);
                      setHeaders(parsed.headers);
                      setMapping(
                        Object.fromEntries(
                          csvFields
                            .filter((k) => parsed.headers.includes(k))
                            .map((k) => [k, k]),
                        ),
                      );
                      setError("");
                      setAttested(false);
                    } catch (e) {
                      setError((e as Error).message);
                    }
                  }}
                />
              </Field>
              {headers.length > 0 && (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void run(async () => {
                      const b = await client.command<BatchView>({
                        action: "stage",
                        csv,
                        mapping,
                        attested,
                      });
                      setBatch(b);
                      setTab("Staged Records");
                    });
                  }}
                >
                  <h3>Column mapping</h3>
                  <div className="form-grid">
                    {csvFields.map((field) => (
                      <Field key={field} label={field}>
                        <select
                          value={mapping[field] ?? ""}
                          onChange={(e) =>
                            setMapping({ ...mapping, [field]: e.target.value })
                          }
                        >
                          <option value="">Not mapped</option>
                          {headers.map((h) => (
                            <option key={h}>{h}</option>
                          ))}
                        </select>
                      </Field>
                    ))}
                  </div>
                  <label className="permission-option">
                    <input
                      type="checkbox"
                      checked={attested}
                      onChange={(e) => setAttested(e.target.checked)}
                      required
                    />
                    My organization may use this data internally.
                  </label>
                  <button className="primary" disabled={busy || !attested}>
                    Validate and stage
                  </button>
                </form>
              )}
            </>
          )}
          <h3>Import batches</h3>
          <Table
            headers={[
              "Started",
              "Status",
              "Discovered / valid",
              "Rejected / duplicates",
              "Created / updated",
              "Actions",
            ]}
            rows={(overview?.batches ?? []).map((b) => [
              new Date(b.startedAt).toLocaleString(),
              <Badge>{b.status}</Badge>,
              `${b.discovered} / ${b.valid}`,
              `${b.rejected} / ${b.duplicates}`,
              `${b.created} / ${b.updated}`,
              <button
                onClick={() =>
                  run(async () => {
                    setBatch(await client.batch(b.id));
                    if (tab === "Import Batches") setTab("Staged Records");
                  })
                }
              >
                Review batch
              </button>,
            ])}
          />
          {batch && (
            <div className="batch-review">
              <h3>Batch {batch.batch.id.slice(0, 8)}</h3>
              <p>
                {batch.batch.status} · Attempt {batch.batch.attempts}
              </p>
              {batch.batch.errors.map((e, i) => (
                <p key={i} className="error">
                  {e}
                </p>
              ))}
              <p className="notice">
                {batch.batch.warnings.join(" ")} Valid rows publish only after
                review. Errors and excluded rows are not published; conflicts
                must be explicitly excluded.
              </p>
              <Table
                headers={[
                  "CSV row",
                  "Number / description",
                  "Source / fitment",
                  "Review status",
                  "Errors / warnings",
                  "",
                ]}
                rows={batch.records.items
                  .filter((r) =>
                    tab === "Import Errors"
                      ? r.errors.length
                      : tab === "Duplicates"
                        ? r.duplicate !== "NONE"
                        : true,
                  )
                  .map((r) => [
                    r.row,
                    <>
                      {r.record.number}
                      <small>{r.record.description}</small>
                    </>,
                    <>
                      {r.record.manufacturer} · {r.record.catalogue}
                      <small>
                        {r.record.make} {r.record.model} / {r.record.chassis} /{" "}
                        {r.record.yearFrom}–{r.record.yearTo}
                      </small>
                      <small>{r.record.sourceUrl || "No source URL"}</small>
                    </>,
                    `${r.duplicate}${r.excluded ? " / EXCLUDED" : ""}`,
                    r.errors.join(" ") || r.warnings.join(" "),
                    batch.batch.status === "REVIEW_REQUIRED" ? (
                      <button
                        onClick={() =>
                          run(async () =>
                            setBatch(
                              await client.command({
                                action: "exclude",
                                id: batch.batch.id,
                                rowId: r.id,
                              }),
                            ),
                          )
                        }
                      >
                        {r.excluded ? "Include row" : "Exclude row"}
                      </button>
                    ) : (
                      "—"
                    ),
                  ])}
              />
              <div className="pagination">
                <button
                  disabled={batch.records.page <= 1}
                  onClick={() =>
                    run(async () =>
                      setBatch(
                        await client.batch(
                          batch.batch.id,
                          batch.records.page - 1,
                        ),
                      ),
                    )
                  }
                >
                  Previous rows
                </button>
                <span>Page {batch.records.page}</span>
                <button
                  disabled={batch.records.page * 25 >= batch.records.total}
                  onClick={() =>
                    run(async () =>
                      setBatch(
                        await client.batch(
                          batch.batch.id,
                          batch.records.page + 1,
                        ),
                      ),
                    )
                  }
                >
                  Next rows
                </button>
              </div>
              <div className="actions">
                {batch.batch.status === "REVIEW_REQUIRED" && (
                  <button
                    className="primary"
                    disabled={busy}
                    onClick={() =>
                      run(async () =>
                        setBatch(
                          await client.command({
                            action: "publish",
                            id: batch.batch.id,
                          }),
                        ),
                      )
                    }
                  >
                    Approve import — publish valid rows
                  </button>
                )}
                {["FAILED", "REVIEW_REQUIRED"].includes(batch.batch.status) && (
                  <>
                    <button
                      disabled={busy}
                      onClick={() =>
                        run(async () =>
                          setBatch(
                            await client.command({
                              action: "retry",
                              id: batch.batch.id,
                            }),
                          ),
                        )
                      }
                    >
                      Retry validation
                    </button>
                    <button
                      disabled={busy}
                      onClick={() =>
                        run(async () => {
                          await client.command({
                            action: "cancel",
                            id: batch.batch.id,
                          });
                          setBatch(await client.batch(batch.batch.id));
                        })
                      }
                    >
                      Reject batch
                    </button>
                  </>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}
