"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ListPage } from "../../../ui/ListPage";
import { Badge, Money } from "../../../ui/kit";
import { formatDate } from "../../../ui/api";
import { useSession } from "../../../ui/session";

interface PO {
  id: string;
  number: string;
  status: string;
  totalMinor: number;
  currency: string;
  expectedDate: string | null;
  createdAt: string;
}
export default function Purchasing() {
  const router = useRouter();
  const s = useSession();
  return (
    <ListPage<PO>
      title="Purchase orders"
      subtitle="Goods ordered from suppliers. Receiving a purchase order adds the goods to stock."
      endpoint="/purchase-orders"
      statuses={["DRAFT", "CONFIRMED", "PARTIALLY_RECEIVED", "RECEIVED", "CLOSED", "CANCELLED"]}
      searchPlaceholder="Search PO number"
      actions={s.can("purchasing.write") && <Link className="button primary" href="/purchasing/new">New purchase order</Link>}
      rowKey={(p) => p.id}
      onRow={(p) => router.push(`/purchasing/${p.id}`)}
      columns={[
        { header: "Number", cell: (p) => <Link href={`/purchasing/${p.id}`}>{p.number}</Link> },
        { header: "Created", cell: (p) => formatDate(p.createdAt) },
        { header: "Expected", cell: (p) => formatDate(p.expectedDate) },
        { header: "Status", cell: (p) => <Badge value={p.status} /> },
        { header: "Total", align: "right", cell: (p) => <Money minor={p.totalMinor} currency={p.currency} /> },
      ]}
    />
  );
}
