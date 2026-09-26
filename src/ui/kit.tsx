"use client";
import Link from "next/link";
import { cloneElement, createContext, isValidElement, useCallback, useContext, useEffect, useId, useMemo, useRef, useState, type ReactElement, type ReactNode } from "react";
import { ApiError, get, minorToInput, parseMinor, titleCase } from "./api";

// ---------- data loading ----------
export function useApi<T>(path: string | null, refreshKey: unknown = 0) {
  const [state, setState] = useState<{ data: T | null; error: string; loading: boolean }>({ data: null, error: "", loading: Boolean(path) });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!path) {
      setState({ data: null, error: "", loading: false });
      return;
    }
    let live = true;
    setState((s) => ({ ...s, loading: true, error: "" }));
    get<T>(path).then(
      (data) => live && setState({ data, error: "", loading: false }),
      (e: unknown) => live && setState((s) => ({ data: s.data, error: e instanceof Error ? e.message : "Something went wrong.", loading: false })),
    );
    return () => {
      live = false;
    };
  }, [path, refreshKey, tick]);
  return { ...state, reload: useCallback(() => setTick((t) => t + 1), []) };
}
export const errorText = (e: unknown) => (e instanceof ApiError ? e.message : e instanceof Error ? e.message : "Something went wrong.");

// ---------- toasts ----------
const ToastCtx = createContext<(message: string) => void>(() => undefined);
export const useToast = () => useContext(ToastCtx);
export function ToastProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const show = useCallback((m: string) => {
    setMessage(m);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setMessage(""), 3500);
  }, []);
  return (
    <ToastCtx.Provider value={show}>
      {children}
      {message && (
        <div className="toast" role="status">
          {message}
        </div>
      )}
    </ToastCtx.Provider>
  );
}

// ---------- layout pieces ----------
export function PageHead({ title, subtitle, actions, back }: { title: string; subtitle?: ReactNode; actions?: ReactNode; back?: { href: string; label: string } }) {
  return (
    <div className="page-head no-print">
      <div>
        {back && (
          <Link className="back" href={back.href}>
            ← {back.label}
          </Link>
        )}
        <h1>{title}</h1>
        {subtitle && <p className="muted">{subtitle}</p>}
      </div>
      {actions && <div className="actions">{actions}</div>}
    </div>
  );
}
export function Panel({ title, actions, children, id }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; id?: string }) {
  return (
    <section className="panel" id={id}>
      {(title || actions) && (
        <div className="panel-head">
          <h2>{title}</h2>
          {actions && <div className="actions">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}
export function Metrics({ items }: { items: { label: string; value: ReactNode; hint?: ReactNode }[] }) {
  return (
    <div className="metrics" style={{ gridTemplateColumns: `repeat(${Math.min(items.length, 4)}, 1fr)` }}>
      {items.map((m) => (
        <div className="metric" key={m.label}>
          <small>{m.label}</small>
          <strong>{m.value}</strong>
          {m.hint && <span className="muted">{m.hint}</span>}
        </div>
      ))}
    </div>
  );
}
const GREEN = /^(ACTIVE|PAID|RECEIVED|FULFILLED|COMPLETED|ACCEPTED|IMPORTED|CLOSED|IN_STOCK|OK|AVAILABLE|SOURCE_VERIFIED|MANUALLY_VERIFIED|QUOTED|SUBMITTED)$/;
const AMBER = /^(DRAFT|ISSUED|PARTIALLY_PAID|PARTIALLY_FULFILLED|PARTIALLY_RECEIVED|CONFIRMED|PENDING|REVIEW_REQUIRED|RUNNING|LOW|UNVERIFIED|COMPLETED_WITH_WARNINGS|SUPERSEDED|OPEN|INVOICED)$/;
const RED = /^(CANCELLED|VOID|FAILED|REJECTED|EXPIRED|INACTIVE|DISABLED|OUT|ENDED|DISPUTED|INVALID|DISCONTINUED)$/;
export function Badge({ value, label }: { value: string; label?: string }) {
  const cls = GREEN.test(value) ? "green" : AMBER.test(value) ? "amber" : RED.test(value) ? "red" : "";
  return <span className={`badge ${cls}`}>{label ?? titleCase(value)}</span>;
}
export const ErrorBanner = ({ message, onClose }: { message: string; onClose?: () => void }) =>
  message ? (
    <div className="error" role="alert">
      <span>{message}</span>
      {onClose && (
        <button aria-label="Dismiss" onClick={onClose}>
          ×
        </button>
      )}
    </div>
  ) : null;
export const Loading = ({ what = "Loading" }: { what?: string }) => (
  <p className="muted" role="status">
    {what}…
  </p>
);
export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}
export function Tabs({ tabs, active, onChange }: { tabs: string[]; active: string; onChange: (t: string) => void }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((t) => (
        <button key={t} role="tab" aria-selected={active === t} className={active === t ? "selected" : ""} onClick={() => onChange(t)}>
          {t}
        </button>
      ))}
    </div>
  );
}

// ---------- tables ----------
export interface Column<T> {
  header: string;
  cell: (row: T) => ReactNode;
  align?: "right";
}
export function DataTable<T>({ columns, rows, onRow, empty = "Nothing here yet.", rowKey }: { columns: Column<T>[]; rows: T[]; onRow?: (row: T) => void; empty?: string; rowKey: (row: T) => string }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.header} style={c.align ? { textAlign: c.align } : undefined}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={rowKey(r)} onClick={onRow ? () => onRow(r) : undefined} style={onRow ? { cursor: "pointer" } : undefined}>
              {columns.map((c) => (
                <td key={c.header} style={c.align ? { textAlign: c.align } : undefined}>
                  {c.cell(r)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {!rows.length && <Empty>{empty}</Empty>}
    </div>
  );
}
export function Pager({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total <= pageSize) return total ? <p className="muted">{total} record{total === 1 ? "" : "s"}</p> : null;
  return (
    <div className="pagination">
      <span className="muted">
        {(page - 1) * pageSize + 1}–{Math.min(total, page * pageSize)} of {total}
      </span>
      <button disabled={page <= 1} onClick={() => onPage(page - 1)}>
        Previous
      </button>
      <button disabled={page >= pages} onClick={() => onPage(page + 1)}>
        Next
      </button>
    </div>
  );
}

// ---------- dialogs & forms ----------
export function Modal({ title, children, onClose, wide }: { title: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  const titleId = useId();
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog ref={ref} onCancel={onClose} aria-labelledby={titleId} style={wide ? { width: "min(920px, 96vw)" } : undefined}>
      <div className="modal-head">
        <h2 id={titleId}>{title}</h2>
        <button aria-label="Close dialog" onClick={onClose}>
          ×
        </button>
      </div>
      {children}
    </dialog>
  );
}
export function FieldBox({ label, help, children }: { label: string; help?: string; children: ReactNode }) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {isValidElement(children) ? cloneElement(children as ReactElement<{ id?: string }>, { id }) : children}
      {help && <small className="muted">{help}</small>}
    </div>
  );
}

export interface FieldSpec {
  name: string;
  label: string;
  type?: "text" | "textarea" | "number" | "money" | "select" | "checkbox" | "email" | "password" | "date";
  options?: { value: string; label: string }[];
  required?: boolean;
  help?: string;
  placeholder?: string;
  wide?: boolean;
  min?: number;
  /** Omit the field from the payload when left empty. */
  optional?: boolean;
}
type Values = Record<string, string | boolean>;
export function FormModal({ title, fields, initial = {}, submitLabel = "Save", onSubmit, onClose }: { title: string; fields: FieldSpec[]; initial?: Record<string, unknown>; submitLabel?: string; onSubmit: (values: Record<string, unknown>) => Promise<void>; onClose: () => void }) {
  const defaultFor = (f: FieldSpec): string | boolean => {
    const v = initial[f.name];
    if (f.type === "checkbox") return Boolean(v);
    if (f.type === "money") return typeof v === "number" ? minorToInput(v) : "";
    return v === undefined || v === null ? (f.type === "select" && f.options?.[0] ? f.options[0].value : "") : String(v);
  };
  // Fields can appear after the form opens (options load later), so anything not yet touched falls back to its default.
  const [edited, setValues] = useState<Values>({});
  const values: Values = Object.fromEntries(fields.map((f) => [f.name, f.name in edited ? edited[f.name] : defaultFor(f)]));
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const out: Record<string, unknown> = {};
    for (const f of fields) {
      const raw = values[f.name];
      if (f.type === "checkbox") out[f.name] = Boolean(raw);
      else if (f.type === "money") {
        const t = String(raw).trim();
        if (!t) {
          if (f.required) return setError(`${f.label} is required.`);
          if (!f.optional) out[f.name] = 0;
          continue;
        }
        const minor = parseMinor(t);
        if (minor === null) return setError(`${f.label} must be an amount such as 12.50.`);
        out[f.name] = minor;
      } else if (f.type === "number") {
        const t = String(raw).trim();
        if (!t) {
          if (f.required) return setError(`${f.label} is required.`);
          continue;
        }
        if (!/^-?\d+$/.test(t)) return setError(`${f.label} must be a whole number.`);
        out[f.name] = Number(t);
      } else {
        const t = String(raw).trim();
        if (!t && f.optional) continue;
        out[f.name] = t;
      }
    }
    setBusy(true);
    setError("");
    try {
      await onSubmit(out);
      onClose();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title={title} onClose={onClose}>
      <form onSubmit={submit}>
        <ErrorBanner message={error} />
        <div className="form-grid">
          {fields.map((f) => {
            const set = (v: string | boolean) => setValues((s) => ({ ...s, [f.name]: v }));
            const common = { name: f.name, required: f.required && f.type !== "money", placeholder: f.placeholder };
            let input: ReactNode;
            if (f.type === "textarea") input = <textarea {...common} rows={3} value={String(values[f.name])} onChange={(e) => set(e.target.value)} />;
            else if (f.type === "select")
              input = (
                <select {...common} value={String(values[f.name])} onChange={(e) => set(e.target.value)}>
                  {f.options?.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              );
            else if (f.type === "checkbox") input = <input type="checkbox" name={f.name} checked={Boolean(values[f.name])} onChange={(e) => set(e.target.checked)} />;
            else input = <input {...common} type={f.type === "money" || f.type === "number" ? "text" : (f.type ?? "text")} inputMode={f.type === "money" ? "decimal" : f.type === "number" ? "numeric" : undefined} autoComplete={f.type === "password" ? "new-password" : "off"} value={String(values[f.name])} onChange={(e) => set(e.target.value)} />;
            return (
              <div key={f.name} style={f.wide || f.type === "textarea" ? { gridColumn: "1 / -1" } : undefined}>
                <FieldBox label={f.label} help={f.help}>
                  {input}
                </FieldBox>
              </div>
            );
          })}
        </div>
        <div className="form-actions">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="primary" disabled={busy}>
            {busy ? "Saving…" : submitLabel}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/** A button that asks a second time before doing something irreversible. */
export function ConfirmButton({ label, confirmLabel = "Confirm", onConfirm, danger }: { label: string; confirmLabel?: string; onConfirm: () => Promise<void> | void; danger?: boolean }) {
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 5000);
    return () => clearTimeout(t);
  }, [armed]);
  return (
    <button
      className={danger ? "danger" : undefined}
      disabled={busy}
      onClick={async () => {
        if (!armed) return setArmed(true);
        setBusy(true);
        try {
          await onConfirm();
        } finally {
          setBusy(false);
          setArmed(false);
        }
      }}
    >
      {armed ? confirmLabel : label}
    </button>
  );
}

/** Runs an action, toasts the outcome, and shows failures in place. */
export function useAction(onDone?: () => void) {
  const toast = useToast();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const run = useCallback(
    async <T,>(fn: () => Promise<T>, success?: string): Promise<T | undefined> => {
      setBusy(true);
      setError("");
      try {
        const r = await fn();
        if (success) toast(success);
        onDone?.();
        return r;
      } catch (e) {
        setError(errorText(e));
        return undefined;
      } finally {
        setBusy(false);
      }
    },
    [onDone, toast],
  );
  return useMemo(() => ({ run, error, busy, clear: () => setError("") }), [run, error, busy]);
}

export function Money({ minor, currency = "AED" }: { minor: number | null | undefined; currency?: string }) {
  if (minor === null || minor === undefined) return <span className="muted">—</span>;
  const sign = minor < 0 ? "-" : "";
  const abs = Math.abs(minor);
  return (
    <span>
      {sign}
      {currency} {Math.trunc(abs / 100).toLocaleString("en-US")}.{String(abs % 100).padStart(2, "0")}
    </span>
  );
}
export function KeyValues({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl style={{ display: "grid", gridTemplateColumns: "max-content 1fr", gap: "6px 22px", margin: 0 }}>
      {items.map(([k, v]) => (
        <div key={k} style={{ display: "contents" }}>
          <dt className="muted">{k}</dt>
          <dd style={{ margin: 0 }}>{v || <span className="muted">—</span>}</dd>
        </div>
      ))}
    </dl>
  );
}
