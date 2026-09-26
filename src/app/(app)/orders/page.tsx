"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ListPage } from "../../../ui/ListPage";
import { Badge, Money } from "../../../ui/kit";
import { formatDate } from "../../../ui/api";

interface Order {
  id: string;
  number: string;
  status: string;
  totalMinor: number;
  currency: string;
  createdAt: string;
}
export default function Orders() {
  const router = useRouter();
  return (
    <ListPage<Order>
      title="Sales orders"
      subtitle="Orders are created from accepted quotations. Stock is reserved when an order is created and deducted when goods are delivered."
      endpoint="/orders"
      statuses={[
        "CONFIRMED",
        "PARTIALLY_FULFILLED",
        "FULFILLED",
        "INVOICED",
        "CANCELLED",
      ]}
      searchPlaceholder="Search order number"
      rowKey={(o) => o.id}
      onRow={(o) => router.push(`/orders/${o.id}`)}
      columns={[
        {
          header: "Number",
          cell: (o) => <Link href={`/orders/${o.id}`}>{o.number}</Link>,
        },
        { header: "Created", cell: (o) => formatDate(o.createdAt) },
        { header: "Status", cell: (o) => <Badge value={o.status} /> },
        {
          header: "Total",
          align: "right",
          cell: (o) => <Money minor={o.totalMinor} currency={o.currency} />,
        },
      ]}
    />
  );
}
