"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ListPage } from "../../../ui/ListPage";
import { Badge, Money } from "../../../ui/kit";
import { formatDate } from "../../../ui/api";

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
  const [unpaid, setUnpaid] = useState(false);
  return (
    <ListPage<Invoice>
      title="Invoices & payments"
      endpoint="/invoices"
      statuses={["ISSUED", "PARTIALLY_PAID", "PAID", "VOID"]}
      searchPlaceholder="Search invoice number"
      extraFilters={{ unpaidOnly: unpaid || undefined }}
      actions={
        <label>
          <input type="checkbox" checked={unpaid} onChange={(e) => setUnpaid(e.target.checked)} /> Unpaid only
        </label>
      }
      rowKey={(i) => i.id}
      onRow={(i) => router.push(`/invoices/${i.id}`)}
      columns={[
        { header: "Number", cell: (i) => <Link href={`/invoices/${i.id}`}>{i.number}</Link> },
        { header: "Issued", cell: (i) => formatDate(i.issueDate) },
        { header: "Due", cell: (i) => formatDate(i.dueDate) },
        { header: "Status", cell: (i) => <Badge value={i.status} /> },
        { header: "Total", align: "right", cell: (i) => <Money minor={i.totalMinor} currency={i.currency} /> },
        { header: "Balance", align: "right", cell: (i) => <Money minor={i.balanceMinor} currency={i.currency} /> },
      ]}
    />
  );
}
