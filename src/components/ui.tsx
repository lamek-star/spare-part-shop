"use client";
import {
  useEffect,
  useRef,
  useId,
  cloneElement,
  isValidElement,
  ReactElement,
  ReactNode,
} from "react";
export function Badge({ children }: { children: ReactNode }) {
  const text = String(children);
  return (
    <span
      className={`badge ${/Active|Paid|Received|Fulfilled|In stock|Closed/.test(text) ? "green" : /Low|Unpaid|Pending|Confirmed|Demo|Quotation/.test(text) ? "amber" : /Out|Inactive|Cancelled/.test(text) ? "red" : ""}`}
    >
      {children}
    </span>
  );
}
export function Table({
  headers,
  rows,
  selectedRow,
  onRowClick,
}: {
  headers: string[];
  rows: ReactNode[][];
  selectedRow?: number;
  onRowClick?: (index: number) => void;
}) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {headers.map((h) => (
              <th key={h}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr
              key={i}
              className={selectedRow === i ? "selected-table-row" : undefined}
              onClick={onRowClick ? () => onRowClick(i) : undefined}
            >
              {r.map((c, j) => (
                <td key={j}>{c}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {!rows.length && (
        <div className="empty">
          No matching records. Adjust your filters or create a new record.
        </div>
      )}
    </div>
  );
}
export function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const titleId = useId();
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog ref={ref} onCancel={onClose} aria-labelledby={titleId}>
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
export function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {isValidElement(children)
        ? cloneElement(children as ReactElement<{ id: string }>, { id })
        : children}
    </div>
  );
}
