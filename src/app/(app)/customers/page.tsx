"use client";
import Link from "next/link";
import { useState } from "react";
import { useSession } from "../../../ui/session";
import { ListPage } from "../../../ui/ListPage";
import { Badge, FormModal } from "../../../ui/kit";
import { post } from "../../../ui/api";
import { customerFields } from "../../../ui/parties";
import { useT } from "../../../ui/i18n";

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
  const t = useT();
  const s = useSession();
  const [creating, setCreating] = useState(false);
  const [tick, setTick] = useState(0);
  return (
    <>
      <ListPage<Customer>
        title={t("nav.customers")}
        endpoint="/customers"
        searchPlaceholder={t("customers.searchNameCodePhoneOr")}
        statuses={["ACTIVE", "INACTIVE"]}
        refreshKey={tick}
        actions={
          s.can("customers.write") && (
            <button className="primary" onClick={() => setCreating(true)}>
              {t("customers.newCustomer")}
            </button>
          )
        }
        rowKey={(c) => c.id}
        columns={[
          { header: t("customers.code"), cell: (c) => c.code },
          {
            header: t("customers.name"),
            cell: (c) => <Link href={`/customers/${c.id}`}>{c.name}</Link>,
          },
          { header: t("customers.contact"), cell: (c) => c.contactPerson },
          { header: t("customers.phone"), cell: (c) => c.phone },
          { header: t("auth.email"), cell: (c) => c.email },
          {
            header: t("common.status"),
            cell: (c) => <Badge value={c.status} />,
          },
        ]}
      />
      {creating && (
        <FormModal
          title={t("customers.newCustomer")}
          fields={customerFields}
          onClose={() => setCreating(false)}
          onSubmit={async (v) => (
            await post("/customers", v),
            setTick((t) => t + 1)
          )}
        />
      )}
    </>
  );
}
