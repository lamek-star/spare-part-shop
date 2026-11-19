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
import { useT } from "../../../../ui/i18n";

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
  const t = useT();
  const [entityType, setEntityType] = useState("");
  const [before, setBefore] = useState<string[]>([]);
  const cursor = before[before.length - 1];
  const r = useApi<Event[]>(
    `/audit${qs({ entityType, limit: 50, before: cursor })}`,
  );
  return (
    <>
      <PageHead
        title={t("nav.audit")}
        subtitle={t("audit.aPermanentRecordOfWho")}
      />
      <div className="toolbar">
        <select
          aria-label={t("audit.type")}
          value={entityType}
          onChange={(e) => (setEntityType(e.target.value), setBefore([]))}
        >
          <option value="">{t("audit.everything")}</option>
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
              empty={t("audit.noEvents")}
              columns={[
                { header: t("audit.when"), cell: (e) => formatDateTime(e.at) },
                { header: t("audit.who"), cell: (e) => e.actorLabel },
                { header: t("audit.action"), cell: (e) => e.action },
                { header: t("audit.what"), cell: (e) => e.summary },
              ]}
            />
            <div className="pagination">
              <button
                disabled={before.length === 0}
                onClick={() => setBefore(before.slice(0, -1))}
              >
                {t("audit.newer")}
              </button>
              <button
                disabled={r.data.length < 50}
                onClick={() =>
                  setBefore([...before, r.data![r.data!.length - 1].at])
                }
              >
                {t("audit.older")}
              </button>
            </div>
          </>
        )}
      </Panel>
    </>
  );
}
