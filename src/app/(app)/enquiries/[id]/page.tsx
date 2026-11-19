"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { use, useState } from "react";
import { useSession } from "../../../../ui/session";
import {
  Badge,
  ConfirmButton,
  DataTable,
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
import { formatDateTime, post } from "../../../../ui/api";
import { useT } from "../../../../ui/i18n";

interface Enquiry {
  id: string;
  number: string;
  status: string;
  customerId: string | null;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  vin: string;
  notes: string;
  submittedAt: string | null;
  items: {
    id: string;
    oemNumber: string;
    partName: string;
    vehicleDescription: string;
    quantity: number;
    referencePartId: string | null;
  }[];
}
export default function EnquiryPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const t = useT();
  const { id } = use(params);
  const s = useSession();
  const router = useRouter();
  const e = useApi<Enquiry>(`/enquiries/${id}`);
  const customers = useApi<{ items: { id: string; name: string }[] }>(
    s.can("customers.read") ? "/customers?pageSize=100&status=ACTIVE" : null,
  );
  const act = useAction(e.reload);
  const [quoting, setQuoting] = useState(false);
  const [customerId, setCustomerId] = useState("");
  if (e.loading && !e.data) return <Loading />;
  if (!e.data) return <ErrorBanner message={e.error || t("enq.notFound")} />;
  const x = e.data;
  const open = ["SUBMITTED", "QUOTED"].includes(x.status);
  const createQuotation = async () => {
    const q = await act.run(
      () =>
        post<{ id: string }>(`/enquiries/${id}/quotation`, {
          customerId: customerId || x.customerId || undefined,
        }),
      t("quotations.created"),
    );
    if (q) router.push(`/quotations/${q.id}`);
  };
  return (
    <>
      <PageHead
        title={x.number}
        subtitle={<Badge value={x.status} />}
        back={{ href: "/enquiries", label: t("nav.enquiries") }}
        actions={
          <>
            {open && s.can("quotations.write") && (
              <button
                className="primary"
                onClick={() =>
                  x.customerId ? void createQuotation() : setQuoting(true)
                }
              >
                {t("enq.createQuotation")}
              </button>
            )}
            {open && s.can("enquiries.write") && (
              <ConfirmButton
                danger
                label={t("enq.cancelEnquiry")}
                confirmLabel={t("enq.yesCancelIt")}
                onConfirm={() =>
                  act
                    .run(
                      () => post(`/enquiries/${id}/cancel`),
                      t("enq.cancelled"),
                    )
                    .then(() => undefined)
                }
              />
            )}
          </>
        }
      />
      <ErrorBanner message={act.error} onClose={act.clear} />
      <Panel title={t("dash.contact")}>
        <KeyValues
          items={[
            ["Name", x.contactName],
            ["Email", x.contactEmail],
            ["Phone", x.contactPhone],
            ["VIN / chassis", x.vin],
            ["Submitted", formatDateTime(x.submittedAt)],
            ["Notes", x.notes],
          ]}
        />
      </Panel>
      <Panel title={`Requested parts (${x.items.length})`}>
        <DataTable
          rowKey={(i) => i.id}
          rows={x.items}
          columns={[
            {
              header: t("enq.partNumber"),
              cell: (i) =>
                i.referencePartId ? (
                  <Link href={`/catalogue/parts/${i.referencePartId}`}>
                    {i.oemNumber}
                  </Link>
                ) : (
                  i.oemNumber
                ),
            },
            { header: t("lines.description"), cell: (i) => i.partName },
            { header: t("enq.vehicle"), cell: (i) => i.vehicleDescription },
            { header: t("doc.qty"), align: "right", cell: (i) => i.quantity },
          ]}
        />
        <p className="muted">{t("enq.quotationLinesArePricedAutomatically")}</p>
      </Panel>
      {quoting && (
        <Modal
          title={t("enq.createQuotation")}
          onClose={() => setQuoting(false)}
        >
          <FieldBox label={t("docs.customer")}>
            <select
              value={customerId}
              onChange={(ev) => setCustomerId(ev.target.value)}
            >
              <option value="">{t("quotations.chooseCustomerOption")}</option>
              {customers.data?.items.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </FieldBox>
          <p className="muted">
            Not listed? <Link href="/customers">{t("enq.addTheCustomer")}</Link>{" "}
            first.
          </p>
          <div className="form-actions">
            <button
              className="primary"
              disabled={!customerId || act.busy}
              onClick={() => void createQuotation()}
            >
              {t("enq.createQuotation")}
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
