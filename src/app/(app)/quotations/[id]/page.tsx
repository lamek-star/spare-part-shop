"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { use, useState } from "react";
import { useSession } from "../../../../ui/session";
import {
  Badge,
  ConfirmButton,
  ErrorBanner,
  FieldBox,
  KeyValues,
  Loading,
  Modal,
  PageHead,
  Panel,
  useAction,
  useApi,
} from "../../../../ui/kit";
import { formatDate, patch, post } from "../../../../ui/api";
import { DocLines, TotalsBox, type DocLine } from "../../../../ui/doc";
import {
  LineEditor,
  linesFromDocument,
  linesPayload,
  type EditLine,
} from "../../../../ui/lines";
import { apiUrl } from "@/lib/basePath";

interface Quotation {
  id: string;
  number: string;
  status: string;
  enquiryId: string | null;
  customerId: string;
  currency: string;
  taxBp: number;
  validUntil: string | null;
  notes: string;
  terms: string;
  subtotalMinor: number;
  taxMinor: number;
  totalMinor: number;
  lines: DocLine[];
  issuedAt: string | null;
  updatedAt: string;
}
export default function QuotationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const s = useSession();
  const router = useRouter();
  const q = useApi<Quotation>(`/quotations/${id}`);
  const customer = useApi<{ name: string }>(
    q.data ? `/customers/${q.data.customerId}` : null,
  );
  const act = useAction(q.reload);
  const [editing, setEditing] = useState<EditLine[] | null>(null);
  const [editError, setEditError] = useState("");
  const [ordering, setOrdering] = useState(false);
  const [shortfall, setShortfall] = useState("reject");
  if (q.loading && !q.data) return <Loading />;
  if (!q.data)
    return <ErrorBanner message={q.error || "Quotation not found."} />;
  const x = q.data;
  const w = s.can("quotations.write");
  const step = (path: string, msg: string) =>
    act.run(() => post(`/quotations/${id}/${path}`), msg);
  async function saveEdit() {
    setEditError("");
    let lines;
    try {
      lines = linesPayload(editing!, "sales");
    } catch (e) {
      return setEditError((e as Error).message);
    }
    const ok = await act.run(
      () =>
        patch(`/quotations/${id}`, { lines, expectedUpdatedAt: x.updatedAt }),
      "Quotation saved",
    );
    if (ok) setEditing(null);
  }
  async function toOrder() {
    const o = await act.run(
      () => post<{ id: string }>(`/quotations/${id}/order`, { shortfall }),
      "Order created",
    );
    if (o) router.push(`/orders/${o.id}`);
  }
  return (
    <>
      <PageHead
        title={x.number}
        subtitle={
          <>
            <Badge value={x.status} /> · valid until {formatDate(x.validUntil)}
          </>
        }
        back={{ href: "/quotations", label: "Quotations" }}
        actions={
          <>
            <a
              className="button"
              href={apiUrl(`/quotations/${id}/pdf`)}
              target="_blank"
              rel="noreferrer"
            >
              Download PDF
            </a>
            {w && x.status === "DRAFT" && (
              <button onClick={() => setEditing(linesFromDocument(x.lines))}>
                Edit lines
              </button>
            )}
            {w && x.status === "DRAFT" && (
              <button
                className="primary"
                onClick={() => void step("issue", "Quotation issued")}
              >
                Issue to customer
              </button>
            )}
            {w && x.status === "ISSUED" && (
              <>
                <button
                  className="primary"
                  onClick={() => void step("accept", "Marked as accepted")}
                >
                  Customer accepted
                </button>
                <button
                  onClick={() => void step("reject", "Marked as rejected")}
                >
                  Customer rejected
                </button>
              </>
            )}
            {s.can("orders.write") && x.status === "ACCEPTED" && (
              <button className="primary" onClick={() => setOrdering(true)}>
                Create order
              </button>
            )}
            {w && ["DRAFT", "ISSUED"].includes(x.status) && (
              <ConfirmButton
                danger
                label="Cancel"
                confirmLabel="Yes, cancel"
                onConfirm={() =>
                  step("cancel", "Quotation cancelled").then(() => undefined)
                }
              />
            )}
          </>
        }
      />
      <ErrorBanner message={act.error} onClose={act.clear} />
      <Panel title="Customer">
        <KeyValues
          items={[
            [
              "Customer",
              customer.data ? (
                <Link key="c" href={`/customers/${x.customerId}`}>
                  {customer.data.name}
                </Link>
              ) : (
                ""
              ),
            ],
            [
              "From enquiry",
              x.enquiryId ? (
                <Link key="e" href={`/enquiries/${x.enquiryId}`}>
                  Open enquiry
                </Link>
              ) : (
                ""
              ),
            ],
            ["Issued", formatDate(x.issuedAt)],
          ]}
        />
      </Panel>
      <Panel title="Items">
        {x.lines.some((l) => l.unitPriceMinor === 0) &&
          x.status === "DRAFT" && (
            <div className="notice">
              Some lines have no price yet. Edit the lines to price them before
              issuing.
            </div>
          )}
        <DocLines lines={x.lines} currency={x.currency} />
        <TotalsBox
          subtotalMinor={x.subtotalMinor}
          taxMinor={x.taxMinor}
          totalMinor={x.totalMinor}
          taxBp={x.taxBp}
          currency={x.currency}
        />
      </Panel>
      {(x.notes || x.terms) && (
        <Panel title="Notes & terms">
          <KeyValues
            items={[
              ["Notes", x.notes],
              ["Terms", x.terms],
            ]}
          />
        </Panel>
      )}
      {editing && (
        <Modal title={`Edit ${x.number}`} onClose={() => setEditing(null)} wide>
          <ErrorBanner message={editError || act.error} />
          <LineEditor kind="sales" lines={editing} onChange={setEditing} />
          <div className="form-actions">
            <button onClick={() => setEditing(null)}>Cancel</button>
            <button
              className="primary"
              disabled={act.busy}
              onClick={() => void saveEdit()}
            >
              Save
            </button>
          </div>
        </Modal>
      )}
      {ordering && (
        <Modal title="Create order" onClose={() => setOrdering(false)}>
          <p>Stock is reserved for the customer when the order is created.</p>
          <FieldBox label="If there is not enough stock">
            <select
              value={shortfall}
              onChange={(e) => setShortfall(e.target.value)}
            >
              <option value="reject">Do not create the order</option>
              <option value="backorder">
                Create it and back-order the shortfall
              </option>
            </select>
          </FieldBox>
          <ErrorBanner message={act.error} />
          <div className="form-actions">
            <button
              className="primary"
              disabled={act.busy}
              onClick={() => void toOrder()}
            >
              Create order
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
