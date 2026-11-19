"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ListPage } from "../../../ui/ListPage";
import { Badge } from "../../../ui/kit";
import { formatDate } from "../../../ui/api";
import { useSession } from "../../../ui/session";
import { useT } from "../../../ui/i18n";

interface Enquiry {
  id: string;
  number: string;
  status: string;
  contactName: string;
  contactEmail: string;
  submittedAt: string | null;
  items: unknown[];
}
export default function Enquiries() {
  const t = useT();
  const router = useRouter();
  const s = useSession();
  return (
    <ListPage<Enquiry>
      title={t("nav.enquiries")}
      subtitle={t("enq.partRequestsWaitingForA")}
      endpoint="/enquiries"
      statuses={["SUBMITTED", "QUOTED", "CLOSED", "CANCELLED"]}
      searchPlaceholder={t("enq.searchNumberContactPartNumber")}
      actions={
        s.can("enquiries.write") && (
          <Link className="button primary" href="/enquiries/cart">
            {t("enq.openEnquiryCart")}
          </Link>
        )
      }
      rowKey={(e) => e.id}
      onRow={(e) => router.push(`/enquiries/${e.id}`)}
      columns={[
        {
          header: t("docs.number"),
          cell: (e) => <Link href={`/enquiries/${e.id}`}>{e.number}</Link>,
        },
        { header: t("dash.contact"), cell: (e) => e.contactName },
        { header: t("auth.email"), cell: (e) => e.contactEmail },
        {
          header: t("docs.items"),
          align: "right",
          cell: (e) => e.items.length,
        },
        {
          header: t("status.SUBMITTED"),
          cell: (e) => formatDate(e.submittedAt),
        },
        { header: t("common.status"), cell: (e) => <Badge value={e.status} /> },
      ]}
    />
  );
}
