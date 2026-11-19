"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ListPage } from "../../../ui/ListPage";
import { Badge, Money } from "../../../ui/kit";
import { formatDate } from "../../../ui/api";
import { useT } from "../../../ui/i18n";

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
  const t = useT();
  return (
    <ListPage<Order>
      title={t("orders.title")}
      subtitle={t("orders.subtitle")}
      endpoint="/orders"
      statuses={[
        "CONFIRMED",
        "PARTIALLY_FULFILLED",
        "FULFILLED",
        "INVOICED",
        "CANCELLED",
      ]}
      searchPlaceholder={t("orders.search")}
      rowKey={(o) => o.id}
      onRow={(o) => router.push(`/orders/${o.id}`)}
      columns={[
        {
          header: t("docs.number"),
          cell: (o) => <Link href={`/orders/${o.id}`}>{o.number}</Link>,
        },
        { header: t("docs.created"), cell: (o) => formatDate(o.createdAt) },
        { header: t("common.status"), cell: (o) => <Badge value={o.status} /> },
        {
          header: t("doc.total"),
          align: "right",
          cell: (o) => <Money minor={o.totalMinor} currency={o.currency} />,
        },
      ]}
    />
  );
}
