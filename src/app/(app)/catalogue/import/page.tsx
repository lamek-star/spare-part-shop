"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import {
  Badge,
  DataTable,
  ErrorBanner,
  FieldBox,
  Metrics,
  PageHead,
  Panel,
  Tabs,
  useAction,
  useApi,
} from "../../../../ui/kit";
import { api, formatDateTime, titleCase } from "../../../../ui/api";

const FIELD_LABELS: Record<string, string> = {
  oem_number: "Part number (OEM) *",
  manufacturer: "Manufacturer *",
  description: "Description",
  pnc: "PNC / part group code",
  status: "Status",
  vehicle_make: "Vehicle make",
  vehicle: "Vehicle model",
  generation: "Generation",
  chassis: "Chassis / frame",
  frame: "Frame",
  body: "Body",
  engine: "Engine",
  transmission: "Transmission",
  production_from: "Production from",
  production_to: "Production to",
  market: "Market",
  category: "Category / section",
  catalogue: "Catalogue code",
  figures: "Figure / drawing codes",
  callout: "Callout number",
  supersedes: "Supersedes",
  superseded_by: "Superseded by",
  price_usd: "Reference price (USD)",
  price_jpy: "Reference price (JPY)",
  source: "Source name",
  source_url: "Source URL",
  source_record_id: "Source record id",
  notes: "Notes",
};
interface Detected {
  headers: string[];
  suggestedMapping: Record<string, string>;
  sample: string[][];
  rowCount: number;
  unmappedRequired: string[];
}
interface Job {
  id: string;
  kind: string;
  sourceLabel: string;
  status: string;
  createdAt: string;
  discovered: number;
  created: number;
  updated: number;
  errors: number;
  message: string;
}

export default function ImportPage() {
  const [tab, setTab] = useState("CSV import");
  return (
    <>
      <PageHead
        title="Import reference catalogue"
        subtitle="Bring manufacturer data into the Reference Catalogue. Nothing here touches your own products or stock."
        back={{ href: "/catalogue", label: "Reference Catalogue" }}
      />
      <Tabs
        tabs={["CSV import", "Offline package", "History"]}
        active={tab}
        onChange={setTab}
      />
      {tab === "CSV import" && <CsvWizard />}
      {tab === "Offline package" && <PackageImport />}
      {tab === "History" && <History />}
    </>
  );
}

function CsvWizard() {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [det, setDet] = useState<Detected | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [defaults, setDefaults] = useState({
    defaultManufacturer: "",
    defaultSource: "",
    defaultMarket: "",
  });
  const [attested, setAttested] = useState(false);
  const act = useAction();

  async function choose(f: File | null) {
    setFile(f);
    setDet(null);
    if (!f) return;
    const form = new FormData();
    form.set("file", f);
    const d = await act.run(() =>
      api<Detected>("POST", "/catalogue/import/detect", form),
    );
    if (d) {
      setDet(d);
      setMapping(d.suggestedMapping);
    }
  }
  async function stage() {
    const form = new FormData();
    form.set("file", file!);
    form.set(
      "mapping",
      JSON.stringify(
        Object.fromEntries(Object.entries(mapping).filter(([, v]) => v)),
      ),
    );
    form.set("attested", attested ? "true" : "false");
    for (const [k, v] of Object.entries(defaults))
      if (v.trim()) form.set(k, v.trim());
    const job = await act.run(() =>
      api<{ id: string }>("POST", "/catalogue/import/jobs", form),
    );
    if (job) router.push(`/catalogue/import/${job.id}`);
  }
  const needManufacturer =
    !mapping.manufacturer && !defaults.defaultManufacturer.trim();
  const ready = det && mapping.oem_number && !needManufacturer && attested;
  return (
    <>
      <ErrorBanner message={act.error} onClose={act.clear} />
      <Panel title="1. Choose a CSV file">
        <input
          ref={input}
          className="file-input"
          type="file"
          accept=".csv,text/csv"
          onChange={(e) => void choose(e.target.files?.[0] ?? null)}
        />
        <div className="actions">
          <button onClick={() => input.current?.click()}>
            {file ? "Choose a different file" : "Choose CSV file"}
          </button>
          {file && (
            <span>
              {file.name} · {(file.size / 1024).toFixed(0)} KB
            </span>
          )}
        </div>
        <p className="muted">
          UTF-8 CSV with a header row. Quoted fields, commas and line breaks
          inside quotes, and a byte-order mark are all handled. Column names do
          not need to match ours — you map them next.
        </p>
      </Panel>
      {det && (
        <>
          <Panel title="2. Match your columns">
            <p className="muted">
              {det.rowCount.toLocaleString("en-US")} data row(s) found. We
              suggested a match for each column we recognised — check them, and
              change anything that is wrong.
            </p>
            <div className="form-grid">
              {Object.keys(FIELD_LABELS).map((f) => (
                <FieldBox key={f} label={FIELD_LABELS[f]}>
                  <select
                    value={mapping[f] ?? ""}
                    onChange={(e) =>
                      setMapping((m) => ({ ...m, [f]: e.target.value }))
                    }
                  >
                    <option value="">— not in my file —</option>
                    {det.headers.map((h) => (
                      <option key={h} value={h}>
                        {h}
                      </option>
                    ))}
                  </select>
                </FieldBox>
              ))}
            </div>
            <div className="form-grid">
              <FieldBox
                label="Default manufacturer"
                help="Used for rows where the manufacturer column is empty or not mapped."
              >
                <input
                  value={defaults.defaultManufacturer}
                  onChange={(e) =>
                    setDefaults({
                      ...defaults,
                      defaultManufacturer: e.target.value,
                    })
                  }
                />
              </FieldBox>
              <FieldBox
                label="Default source name"
                help="Recorded as the origin of these rows."
              >
                <input
                  value={defaults.defaultSource}
                  onChange={(e) =>
                    setDefaults({ ...defaults, defaultSource: e.target.value })
                  }
                />
              </FieldBox>
              <FieldBox label="Default market">
                <input
                  value={defaults.defaultMarket}
                  onChange={(e) =>
                    setDefaults({ ...defaults, defaultMarket: e.target.value })
                  }
                />
              </FieldBox>
            </div>
            <h3>Sample of your file</h3>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    {det.headers.map((h) => (
                      <th key={h}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {det.sample.map((row, i) => (
                    <tr key={i}>
                      {row.map((c, j) => (
                        <td key={j}>{c}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
          <Panel title="3. Check and continue">
            {!mapping.oem_number && (
              <div className="error">
                Choose the column that holds the part number.
              </div>
            )}
            {mapping.oem_number && needManufacturer && (
              <div className="error">
                Choose the manufacturer column, or type a default manufacturer.
              </div>
            )}
            <label>
              <input
                type="checkbox"
                checked={attested}
                onChange={(e) => setAttested(e.target.checked)}
              />{" "}
              I confirm that my organisation is allowed to use this data.
            </label>
            <p className="muted">
              Next you will see every row checked — new, already present,
              changed, duplicated, or invalid — before anything is saved.
            </p>
            <div className="form-actions">
              <button
                className="primary"
                disabled={!ready || act.busy}
                onClick={() => void stage()}
              >
                {act.busy ? "Checking…" : "Validate and preview"}
              </button>
            </div>
          </Panel>
        </>
      )}
    </>
  );
}

interface PackageReport {
  manifest: {
    package_id: string;
    provider: string;
    manufacturer?: string;
    market?: string;
    catalogue?: string;
    created_at?: string;
  } | null;
  ok: boolean;
  tables: Record<string, { rows: number; valid: number; invalid: number }>;
  assets: { declared: number; found: number; storable: number };
  issues: { level: string; where: string; message: string }[];
}
function PackageImport() {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [report, setReport] = useState<PackageReport | null>(null);
  const [images, setImages] = useState(false);
  const act = useAction();
  async function choose(f: File | null) {
    setFile(f);
    setReport(null);
    if (!f) return;
    const form = new FormData();
    form.set("file", f);
    const r = await act.run(() =>
      api<PackageReport>("POST", "/catalogue/import/package/preview", form),
    );
    if (r) setReport(r);
  }
  async function run() {
    const form = new FormData();
    form.set("file", file!);
    form.set("imagesLicenseConfirmed", images ? "true" : "false");
    const job = await act.run(() =>
      api<{ id: string }>("POST", "/catalogue/import/package", form),
    );
    if (job) router.push(`/catalogue/import/${job.id}`);
  }
  return (
    <>
      <ErrorBanner message={act.error} onClose={act.clear} />
      <Panel title="Offline catalogue package">
        <p>
          A package is a single <code>.ifcatalog</code> or <code>.zip</code>{" "}
          file with <code>manifest.json</code>, CSV tables (parts, fitments,
          drawings, callouts, supersessions…) and drawing images. It is checked
          (checksums, sizes, safe file names) before anything is read, and
          everything is copied into this system — the file can be removed
          afterwards and the catalogue keeps working offline.
        </p>
        <input
          ref={input}
          className="file-input"
          type="file"
          accept=".ifcatalog,.zip,application/zip"
          onChange={(e) => void choose(e.target.files?.[0] ?? null)}
        />
        <button onClick={() => input.current?.click()}>
          {file ? "Choose a different package" : "Choose package file"}
        </button>{" "}
        {file && <span>{file.name}</span>}
      </Panel>
      {report && (
        <Panel title="Package check">
          {report.manifest && (
            <Metrics
              items={[
                { label: "Package", value: report.manifest.package_id },
                { label: "Provider", value: report.manifest.provider },
                {
                  label: "Images found",
                  value: `${report.assets.found}/${report.assets.declared}`,
                },
                { label: "Result", value: report.ok ? "Ready" : "Rejected" },
              ]}
            />
          )}
          <DataTable
            rowKey={(r) => r[0]}
            rows={Object.entries(report.tables)}
            columns={[
              { header: "Table", cell: (r) => titleCase(r[0]) },
              { header: "Rows", align: "right", cell: (r) => r[1].rows },
              { header: "Valid", align: "right", cell: (r) => r[1].valid },
              { header: "Invalid", align: "right", cell: (r) => r[1].invalid },
            ]}
          />
          {report.issues.length > 0 && (
            <>
              <h3>Findings</h3>
              <DataTable
                rowKey={(i) => i.where + i.message}
                rows={report.issues.slice(0, 100)}
                columns={[
                  {
                    header: "Level",
                    cell: (i) => (
                      <Badge
                        value={i.level === "error" ? "FAILED" : "PENDING"}
                        label={i.level}
                      />
                    ),
                  },
                  { header: "Where", cell: (i) => i.where },
                  { header: "Message", cell: (i) => i.message },
                ]}
              />
            </>
          )}
          {report.ok && (
            <>
              {report.assets.storable > 0 && (
                <label>
                  <input
                    type="checkbox"
                    checked={images}
                    onChange={(e) => setImages(e.target.checked)}
                  />{" "}
                  I confirm we are licensed to store and display the{" "}
                  {report.assets.storable} image(s) in this package. Without
                  this, images are skipped and only their source links are kept.
                </label>
              )}
              <div className="form-actions">
                <button
                  className="primary"
                  disabled={act.busy}
                  onClick={() => void run()}
                >
                  {act.busy ? "Importing…" : "Import package"}
                </button>
              </div>
            </>
          )}
        </Panel>
      )}
    </>
  );
}

function History() {
  const jobs = useApi<Job[]>("/catalogue/import/jobs?limit=50");
  return (
    <Panel title="Import history">
      <ErrorBanner message={jobs.error} />
      {jobs.data && (
        <DataTable
          rowKey={(j) => j.id}
          rows={jobs.data}
          empty="No imports yet."
          columns={[
            { header: "When", cell: (j) => formatDateTime(j.createdAt) },
            { header: "Type", cell: (j) => titleCase(j.kind) },
            {
              header: "Source",
              cell: (j) => (
                <Link href={`/catalogue/import/${j.id}`}>{j.sourceLabel}</Link>
              ),
            },
            { header: "Status", cell: (j) => <Badge value={j.status} /> },
            { header: "Rows", align: "right", cell: (j) => j.discovered },
            { header: "New", align: "right", cell: (j) => j.created },
            { header: "Updated", align: "right", cell: (j) => j.updated },
            { header: "Errors", align: "right", cell: (j) => j.errors },
          ]}
        />
      )}
    </Panel>
  );
}
