"use client";
import { useState, ReactNode } from "react";
import { Contact, Order, money } from "../domain/models";
import { Services } from "../services/contracts";
import { Badge, Table } from "./ui";
import Forms from "./Forms";
export default function ContactDetails({
  contact,
  services,
  renderOrders,
  renderDocuments,
}: {
  contact: Contact;
  services: Services;
  renderOrders: (orders: Order[]) => ReactNode;
  renderDocuments: () => ReactNode;
}) {
  const [tab, setTab] = useState("Overview");
  const s = services.snapshot();
  const orders = s.orders.filter((o) => o.contactId === contact.id);
  const products = s.parts.filter(
    (p) =>
      orders.some((o) => o.lines.some((l) => l.partId === p.id)) ||
      s.numbers.some((n) => n.partId === p.id && n.supplierId === contact.id),
  );
  return (
    <>
      <Badge>{contact.status}</Badge>
      <p className="muted">
        {contact.kind} · {contact.country}
      </p>
      <div className="tabs">
        {[
          "Overview",
          "Products",
          contact.kind === "Supplier" ? "Purchases" : "Sales",
          "Documents",
          "Activity",
          "Edit",
        ].map((t) => (
          <button
            key={t}
            className={tab === t ? "selected" : ""}
            onClick={() => setTab(t)}
          >
            {t}
          </button>
        ))}
      </div>
      {tab === "Overview" ? (
        <dl>
          {[
            ["Contact person", contact.person],
            ["Email", contact.email],
            ["Phone", contact.phone],
            ["Address", contact.address],
            ["Tax number", contact.taxNumber],
            ["Currency", contact.currency],
            ["Payment terms", contact.terms],
            ["Credit limit", money(contact.creditLimit)],
            ["Notes", contact.notes],
          ].map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd>{v || "—"}</dd>
            </div>
          ))}
        </dl>
      ) : tab === "Products" ? (
        <Table
          headers={["Part", "SKU", "Brand"]}
          rows={products.map((p) => [p.name, p.sku, p.brand])}
        />
      ) : tab === "Documents" ? (
        renderDocuments()
      ) : tab === "Activity" ? (
        <Table
          headers={["Date", "Action", "Detail"]}
          rows={s.audit
            .filter(
              (a) =>
                a.detail === contact.name ||
                orders.some((o) => a.detail === o.id || a.detail === o.number),
            )
            .map((a) => [
              new Date(a.date).toLocaleString(),
              a.action,
              a.detail,
            ])}
        />
      ) : tab === "Edit" ? (
        <Forms
          type={contact.kind}
          contact={contact}
          services={services}
          done={() => setTab("Overview")}
        />
      ) : (
        renderOrders(orders)
      )}
    </>
  );
}
