"use client";
import Link from "next/link";
import { useState } from "react";
import { useSession } from "../../../ui/session";
import { ListPage } from "../../../ui/ListPage";
import { Badge, FormModal } from "../../../ui/kit";
import { post } from "../../../ui/api";
import { customerFields } from "../../../ui/parties";

interface Customer {
  id: string;
  code: string;
  name: string;
  contactPerson: string;
  phone: string;
  email: string;
  status: string;
}
export default function Customers() {
  const s = useSession();
  const [creating, setCreating] = useState(false);
  const [tick, setTick] = useState(0);
  return (
    <>
      <ListPage<Customer>
        title="Customers"
        endpoint="/customers"
        searchPlaceholder="Search name, code, phone or email"
        statuses={["ACTIVE", "INACTIVE"]}
        refreshKey={tick}
        actions={s.can("customers.write") && <button className="primary" onClick={() => setCreating(true)}>New customer</button>}
        rowKey={(c) => c.id}
        columns={[
          { header: "Code", cell: (c) => c.code },
          { header: "Name", cell: (c) => <Link href={`/customers/${c.id}`}>{c.name}</Link> },
          { header: "Contact", cell: (c) => c.contactPerson },
          { header: "Phone", cell: (c) => c.phone },
          { header: "Email", cell: (c) => c.email },
          { header: "Status", cell: (c) => <Badge value={c.status} /> },
        ]}
      />
      {creating && <FormModal title="New customer" fields={customerFields} onClose={() => setCreating(false)} onSubmit={async (v) => (await post("/customers", v), setTick((t) => t + 1))} />}
    </>
  );
}
