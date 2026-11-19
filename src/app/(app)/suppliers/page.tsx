"use client";
import Link from "next/link";
import { useState } from "react";
import { useSession } from "../../../ui/session";
import { ListPage } from "../../../ui/ListPage";
import { Badge, FormModal } from "../../../ui/kit";
import { post } from "../../../ui/api";
import { supplierFields } from "../../../ui/parties";
import { useT } from "../../../ui/i18n";

interface Supplier {
  id: string;
  code: string;
  name: string;
  contactPerson: string;
  phone: string;
  email: string;
  status: string;
}
export default function Suppliers() {
  const t = useT();
  const s = useSession();
  const [creating, setCreating] = useState(false);
  const [tick, setTick] = useState(0);
  return (
    <>
      <ListPage<Supplier>
        title={t("nav.suppliers")}
        endpoint="/suppliers"
        searchPlaceholder={t("suppliers.searchNameCodePhoneOr")}
        statuses={["ACTIVE", "INACTIVE"]}
        refreshKey={tick}
        actions={
          s.can("suppliers.write") && (
            <button className="primary" onClick={() => setCreating(true)}>
              {t("suppliers.newSupplier")}
            </button>
          )
        }
        rowKey={(c) => c.id}
        columns={[
          { header: t("suppliers.code"), cell: (c) => c.code },
          {
            header: t("suppliers.name"),
            cell: (c) => <Link href={`/suppliers/${c.id}`}>{c.name}</Link>,
          },
          { header: t("suppliers.contact"), cell: (c) => c.contactPerson },
          { header: t("suppliers.phone"), cell: (c) => c.phone },
          { header: t("auth.email"), cell: (c) => c.email },
          {
            header: t("common.status"),
            cell: (c) => <Badge value={c.status} />,
          },
        ]}
      />
      {creating && (
        <FormModal
          title={t("suppliers.newSupplier")}
          fields={supplierFields}
          onClose={() => setCreating(false)}
          onSubmit={async (v) => (
            await post("/suppliers", v),
            setTick((t) => t + 1)
          )}
        />
      )}
    </>
  );
}
