"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ListPage } from "../../../ui/ListPage";
import { Badge, Money } from "../../../ui/kit";
import { formatDate } from "../../../ui/api";
import { useSession } from "../../../ui/session";
import { useT } from "../../../ui/i18n";

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
  const t = useT();
  const router = useRouter();
  const s = useSession();
  return (
    <ListPage<PO>
      title={t("suppliers.purchaseOrders")}
      subtitle={t("purch.goodsOrderedFromSuppliersReceiving")}
      endpoint="/purchase-orders"
      statuses={[
        "DRAFT",
        "CONFIRMED",
        "PARTIALLY_RECEIVED",
        "RECEIVED",
        "CLOSED",
        "CANCELLED",
      ]}
      searchPlaceholder={t("purch.searchPoNumber")}
      actions={
        s.can("purchasing.write") && (
          <Link className="button primary" href="/purchasing/new">
            {t("purch.newPurchaseOrder")}
          </Link>
        )
      }
      rowKey={(p) => p.id}
      onRow={(p) => router.push(`/purchasing/${p.id}`)}
      columns={[
        {
          header: t("docs.number"),
          cell: (p) => <Link href={`/purchasing/${p.id}`}>{p.number}</Link>,
        },
        { header: t("docs.created"), cell: (p) => formatDate(p.createdAt) },
        {
          header: t("purch.expected"),
          cell: (p) => formatDate(p.expectedDate),
        },
        { header: t("common.status"), cell: (p) => <Badge value={p.status} /> },
        {
          header: t("doc.total"),
          align: "right",
          cell: (p) => <Money minor={p.totalMinor} currency={p.currency} />,
        },
      ]}
    />
  );
}
