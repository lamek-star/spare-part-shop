"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ListPage } from "../../../ui/ListPage";
import { Badge, Money } from "../../../ui/kit";
import { formatDate } from "../../../ui/api";
import { useT } from "../../../ui/i18n";

interface Invoice {
  id: string;
  number: string;
  status: string;
  issueDate: string;
  dueDate: string | null;
  totalMinor: number;
  balanceMinor: number;
  currency: string;
}
export default function Invoices() {
  const router = useRouter();
  const t = useT();
  const [unpaid, setUnpaid] = useState(false);
  return (
    <ListPage<Invoice>
      title={t("invoices.title")}
      endpoint="/invoices"
      statuses={["ISSUED", "PARTIALLY_PAID", "PAID", "VOID"]}
      searchPlaceholder={t("invoices.search")}
      extraFilters={{ unpaidOnly: unpaid || undefined }}
      actions={
        <label>
          <input
            type="checkbox"
            checked={unpaid}
            onChange={(e) => setUnpaid(e.target.checked)}
          />{" "}
          {t("invoices.unpaidOnly")}
        </label>
      }
      rowKey={(i) => i.id}
      onRow={(i) => router.push(`/invoices/${i.id}`)}
      columns={[
        {
          header: t("docs.number"),
          cell: (i) => <Link href={`/invoices/${i.id}`}>{i.number}</Link>,
        },
        { header: t("docs.issued"), cell: (i) => formatDate(i.issueDate) },
        { header: t("docs.due"), cell: (i) => formatDate(i.dueDate) },
        { header: t("common.status"), cell: (i) => <Badge value={i.status} /> },
        {
          header: t("doc.total"),
          align: "right",
          cell: (i) => <Money minor={i.totalMinor} currency={i.currency} />,
        },
        {
          header: t("docs.balance"),
          align: "right",
          cell: (i) => <Money minor={i.balanceMinor} currency={i.currency} />,
        },
      ]}
    />
  );
}
