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
import { useT } from "../../../../ui/i18n";

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
  const t = useT();
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
    return <ErrorBanner message={q.error || t("quotations.notFound")} />;
  const x = q.data;
  const w = s.can("quotations.write");
  const step = (path: string, msg: string) =>
    act.run(() => post(`/quotations/${id}/${path}`), msg);
  async function saveEdit() {
    setEditError("");
    let lines;
    try {
      lines = linesPayload(editing!, "sales", t);
    } catch (e) {
      return setEditError((e as Error).message);
    }
    const ok = await act.run(
      () =>
        patch(`/quotations/${id}`, { lines, expectedUpdatedAt: x.updatedAt }),
      t("quotations.saved"),
    );
    if (ok) setEditing(null);
  }
  async function toOrder() {
    const o = await act.run(
      () => post<{ id: string }>(`/quotations/${id}/order`, { shortfall }),
      t("orders.created"),
    );
    if (o) router.push(`/orders/${o.id}`);
  }
  return (
    <>
      <PageHead
        title={x.number}
        subtitle={
          <>
            <Badge value={x.status} /> ·{" "}
            {t("quotations.validUntil", { date: formatDate(x.validUntil) })}
          </>
        }
        back={{ href: "/quotations", label: t("nav.quotations") }}
        actions={
          <>
            <Link className="button" href={`/quotations/${id}/print`}>
              {t("docs.print")}
            </Link>
            <a
              className="button"
              href={apiUrl(`/quotations/${id}/pdf`)}
              target="_blank"
              rel="noreferrer"
            >
              {t("docs.downloadPdf")}
            </a>
            {w && x.status === "DRAFT" && (
              <button onClick={() => setEditing(linesFromDocument(x.lines))}>
                {t("quotations.editLines")}
              </button>
            )}
            {w && x.status === "DRAFT" && (
              <button
                className="primary"
                onClick={() => void step("issue", t("quotations.issued"))}
              >
                {t("quotations.issue")}
              </button>
            )}
            {w && x.status === "ISSUED" && (
              <>
                <button
                  className="primary"
                  onClick={() =>
                    void step("accept", t("quotations.markedAccepted"))
                  }
                >
                  {t("quotations.customerAccepted")}
                </button>
                <button
                  onClick={() =>
                    void step("reject", t("quotations.markedRejected"))
                  }
                >
                  {t("quotations.customerRejected")}
                </button>
              </>
            )}
            {s.can("orders.write") && x.status === "ACCEPTED" && (
              <button className="primary" onClick={() => setOrdering(true)}>
                {t("quotations.createOrder")}
              </button>
            )}
            {w && ["DRAFT", "ISSUED"].includes(x.status) && (
              <ConfirmButton
                danger
                label={t("common.cancel")}
                confirmLabel={t("common.yesCancel")}
                onConfirm={() =>
                  step("cancel", t("quotations.cancelled")).then(
                    () => undefined,
                  )
                }
              />
            )}
          </>
        }
      />
      <ErrorBanner message={act.error} onClose={act.clear} />
      <Panel title={t("docs.customer")}>
        <KeyValues
          items={[
            [
              t("docs.customer"),
              customer.data ? (
                <Link key="c" href={`/customers/${x.customerId}`}>
                  {customer.data.name}
                </Link>
              ) : (
                ""
              ),
            ],
            [
              t("quotations.fromEnquiry"),
              x.enquiryId ? (
                <Link key="e" href={`/enquiries/${x.enquiryId}`}>
                  {t("quotations.openEnquiry")}
                </Link>
              ) : (
                ""
              ),
            ],
            [t("docs.issued"), formatDate(x.issuedAt)],
          ]}
        />
      </Panel>
      <Panel title={t("docs.items")}>
        {x.lines.some((l) => l.unitPriceMinor === 0) &&
          x.status === "DRAFT" && (
            <div className="notice">{t("quotations.unpriced")}</div>
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
        <Panel title={t("docs.notesTerms")}>
          <KeyValues
            items={[
              [t("docs.notes"), x.notes],
              [t("docs.terms"), x.terms],
            ]}
          />
        </Panel>
      )}
      {editing && (
        <Modal
          title={t("quotations.editTitle", { number: x.number })}
          onClose={() => setEditing(null)}
          wide
        >
          <ErrorBanner message={editError || act.error} />
          <LineEditor kind="sales" lines={editing} onChange={setEditing} />
          <div className="form-actions">
            <button onClick={() => setEditing(null)}>
              {t("common.cancel")}
            </button>
            <button
              className="primary"
              disabled={act.busy}
              onClick={() => void saveEdit()}
            >
              {t("common.save")}
            </button>
          </div>
        </Modal>
      )}
      {ordering && (
        <Modal
          title={t("quotations.createOrder")}
          onClose={() => setOrdering(false)}
        >
          <p>{t("quotations.reserveHelp")}</p>
          <FieldBox label={t("quotations.shortfall")}>
            <select
              value={shortfall}
              onChange={(e) => setShortfall(e.target.value)}
            >
              <option value="reject">{t("quotations.shortfallReject")}</option>
              <option value="backorder">
                {t("quotations.shortfallBackorder")}
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
              {t("quotations.createOrder")}
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
