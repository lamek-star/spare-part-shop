"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ListPage } from "../../../ui/ListPage";
import { Badge, Money } from "../../../ui/kit";
import { formatDate } from "../../../ui/api";
import { useSession } from "../../../ui/session";
import { useT } from "../../../ui/i18n";

interface Quotation {
  id: string;
  number: string;
  status: string;
  customerId: string;
  totalMinor: number;
  currency: string;
  validUntil: string | null;
  createdAt: string;
}
export default function Quotations() {
  const router = useRouter();
  const s = useSession();
  const t = useT();
  return (
    <ListPage<Quotation>
      title={t("nav.quotations")}
      endpoint="/quotations"
      statuses={[
        "DRAFT",
        "ISSUED",
        "ACCEPTED",
        "REJECTED",
        "EXPIRED",
        "CANCELLED",
      ]}
      searchPlaceholder={t("quotations.search")}
      actions={
        s.can("quotations.write") && (
          <Link className="button primary" href="/quotations/new">
            {t("quotations.new")}
          </Link>
        )
      }
      rowKey={(q) => q.id}
      onRow={(q) => router.push(`/quotations/${q.id}`)}
      columns={[
        {
          header: t("docs.number"),
          cell: (q) => <Link href={`/quotations/${q.id}`}>{q.number}</Link>,
        },
        { header: t("docs.created"), cell: (q) => formatDate(q.createdAt) },
        { header: t("docs.validUntil"), cell: (q) => formatDate(q.validUntil) },
        { header: t("common.status"), cell: (q) => <Badge value={q.status} /> },
        {
          header: t("doc.total"),
          align: "right",
          cell: (q) => <Money minor={q.totalMinor} currency={q.currency} />,
        },
      ]}
    />
  );
}
