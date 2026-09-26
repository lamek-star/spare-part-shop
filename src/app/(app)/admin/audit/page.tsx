"use client";
import { useState } from "react";
import {
  DataTable,
  ErrorBanner,
  PageHead,
  Panel,
  useApi,
} from "../../../../ui/kit";
import { formatDateTime, qs } from "../../../../ui/api";

interface Event {
  id: string;
  at: string;
  actorLabel: string;
  action: string;
  entityType: string;
  entityId: string | null;
  summary: string;
}
export default function AuditLog() {
  const [entityType, setEntityType] = useState("");
  const [before, setBefore] = useState<string[]>([]);
  const cursor = before[before.length - 1];
  const r = useApi<Event[]>(
    `/audit${qs({ entityType, limit: 50, before: cursor })}`,
  );
  return (
    <>
      <PageHead
        title="Audit log"
        subtitle="A permanent record of who changed what. Passwords and secrets are never recorded."
      />
      <div className="toolbar">
        <select
          aria-label="Type"
          value={entityType}
          onChange={(e) => (setEntityType(e.target.value), setBefore([]))}
        >
          <option value="">Everything</option>
          {[
            "product",
            "customer",
            "supplier",
            "quotation",
            "order",
            "invoice",
            "purchase_order",
            "user",
            "import_job",
            "catalogue_source",
            "settings",
          ].map((t) => (
            <option key={t}>{t}</option>
          ))}
        </select>
      </div>
      <ErrorBanner message={r.error} />
      <Panel>
        {r.data && (
          <>
            <DataTable
              rowKey={(e) => e.id}
              rows={r.data}
              empty="No events."
              columns={[
                { header: "When", cell: (e) => formatDateTime(e.at) },
                { header: "Who", cell: (e) => e.actorLabel },
                { header: "Action", cell: (e) => e.action },
                { header: "What", cell: (e) => e.summary },
              ]}
            />
            <div className="pagination">
              <button
                disabled={before.length === 0}
                onClick={() => setBefore(before.slice(0, -1))}
              >
                Newer
              </button>
              <button
                disabled={r.data.length < 50}
                onClick={() =>
                  setBefore([...before, r.data![r.data!.length - 1].at])
                }
              >
                Older
              </button>
            </div>
          </>
        )}
      </Panel>
    </>
  );
}
