"use client";
import { useEffect, useState, type ReactNode } from "react";
import { Search } from "lucide-react";
import { qs } from "./api";
import { DataTable, ErrorBanner, Loading, PageHead, Pager, Panel, useApi, type Column } from "./kit";

export interface ListPageProps<T> {
  title: string;
  subtitle?: string;
  endpoint: string;
  columns: Column<T>[];
  rowKey: (row: T) => string;
  onRow?: (row: T) => void;
  actions?: ReactNode;
  searchPlaceholder?: string;
  statuses?: string[];
  extraFilters?: Record<string, string | number | boolean | undefined>;
  pageSize?: number;
  empty?: string;
  refreshKey?: unknown;
  noSearch?: boolean;
}
/** Search + status filter + paging over any `{ items, total }` endpoint. */
export function ListPage<T>({ title, subtitle, endpoint, columns, rowKey, onRow, actions, searchPlaceholder = "Search…", statuses, extraFilters, pageSize = 25, empty, refreshKey, noSearch }: ListPageProps<T>) {
  const [q, setQ] = useState("");
  const [term, setTerm] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  useEffect(() => {
    const t = setTimeout(() => {
      setTerm(q.trim());
      setPage(1);
    }, 250);
    return () => clearTimeout(t);
  }, [q]);
  const filters = JSON.stringify(extraFilters ?? {});
  const r = useApi<{ items: T[]; total: number }>(`${endpoint}${qs({ q: term, status, page, pageSize, ...(extraFilters ?? {}) })}`, `${refreshKey}|${filters}`);
  return (
    <>
      <PageHead title={title} subtitle={subtitle} actions={actions} />
      <div className="toolbar">
        {!noSearch && (
          <div className="search-box">
            <Search size={16} />
            <input aria-label="Search" placeholder={searchPlaceholder} value={q} onChange={(e) => setQ(e.target.value)} style={{ border: 0, flex: 1, outline: "none" }} />
          </div>
        )}
        {statuses && (
          <select aria-label="Status" value={status} onChange={(e) => (setStatus(e.target.value), setPage(1))}>
            <option value="">All statuses</option>
            {statuses.map((s) => (
              <option key={s} value={s}>
                {s.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase())}
              </option>
            ))}
          </select>
        )}
      </div>
      <ErrorBanner message={r.error} />
      <Panel>
        {r.loading && !r.data && <Loading />}
        {r.data && <DataTable columns={columns} rows={r.data.items} rowKey={rowKey} onRow={onRow} empty={empty ?? (term || status ? "No records match your search." : "Nothing here yet.")} />}
        {r.data && <Pager page={page} pageSize={pageSize} total={r.data.total} onPage={setPage} />}
      </Panel>
    </>
  );
}
