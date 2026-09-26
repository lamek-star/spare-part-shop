"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ListPage } from "../../../ui/ListPage";
import { Badge, Money } from "../../../ui/kit";
import { formatDate } from "../../../ui/api";
import { useSession } from "../../../ui/session";

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
  return (
    <ListPage<Quotation>
      title="Quotations"
      endpoint="/quotations"
      statuses={[
        "DRAFT",
        "ISSUED",
        "ACCEPTED",
        "REJECTED",
        "EXPIRED",
        "CANCELLED",
      ]}
      searchPlaceholder="Search quotation number"
      actions={
        s.can("quotations.write") && (
          <Link className="button primary" href="/quotations/new">
            New quotation
          </Link>
        )
      }
      rowKey={(q) => q.id}
      onRow={(q) => router.push(`/quotations/${q.id}`)}
      columns={[
        {
          header: "Number",
          cell: (q) => <Link href={`/quotations/${q.id}`}>{q.number}</Link>,
        },
        { header: "Created", cell: (q) => formatDate(q.createdAt) },
        { header: "Valid until", cell: (q) => formatDate(q.validUntil) },
        { header: "Status", cell: (q) => <Badge value={q.status} /> },
        {
          header: "Total",
          align: "right",
          cell: (q) => <Money minor={q.totalMinor} currency={q.currency} />,
        },
      ]}
    />
  );
}
