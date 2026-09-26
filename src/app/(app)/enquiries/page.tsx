"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ListPage } from "../../../ui/ListPage";
import { Badge } from "../../../ui/kit";
import { formatDate } from "../../../ui/api";
import { useSession } from "../../../ui/session";

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
  const router = useRouter();
  const s = useSession();
  return (
    <ListPage<Enquiry>
      title="Enquiries"
      subtitle="Part requests waiting for a quotation. Add items from the Reference Catalogue."
      endpoint="/enquiries"
      statuses={["SUBMITTED", "QUOTED", "CLOSED", "CANCELLED"]}
      searchPlaceholder="Search number, contact, part number"
      actions={s.can("enquiries.write") && <Link className="button primary" href="/enquiries/cart">Open enquiry cart</Link>}
      rowKey={(e) => e.id}
      onRow={(e) => router.push(`/enquiries/${e.id}`)}
      columns={[
        { header: "Number", cell: (e) => <Link href={`/enquiries/${e.id}`}>{e.number}</Link> },
        { header: "Contact", cell: (e) => e.contactName },
        { header: "Email", cell: (e) => e.contactEmail },
        { header: "Items", align: "right", cell: (e) => e.items.length },
        { header: "Submitted", cell: (e) => formatDate(e.submittedAt) },
        { header: "Status", cell: (e) => <Badge value={e.status} /> },
      ]}
    />
  );
}
