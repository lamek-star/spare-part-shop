"use client";
import { useState } from "react";
import { Services } from "../services/contracts";
import {
  Part,
  Order,
  Contact,
  numberTypes,
  normalizeNumber,
} from "../domain/models";
import { uid } from "../adapters/demo";
import { Field } from "./ui";
export default function Forms({
  type,
  services,
  part,
  contact,
  done,
}: {
  type: string;
  services: Services;
  part?: Part;
  contact?: Contact;
  done: () => void;
}) {
  const s = services.snapshot();
  const [error, setError] = useState("");
  const [review, setReview] = useState(false);
  const [lines, setLines] = useState([
    {
      partId: part?.id ?? s.parts[0].id,
      quantity: 1,
      price: type === "Purchase" ? s.parts[0].cost : s.parts[0].price,
      processed: 0,
      returned: 0,
      discount: 0,
    },
  ]);
  const submit = async (f: FormData) => {
    try {
      const v = (k: string) => String(f.get(k) ?? "");
      const n = (k: string) => Number(v(k));
      if (type === "Customer" || type === "Supplier")
        await services.contacts.save({
          id: contact?.id ?? uid(),
          kind: type,
          name: v("name"),
          person: v("person"),
          email: v("email"),
          phone: v("phone"),
          country: v("country"),
          address: v("address"),
          taxNumber: v("taxNumber"),
          currency: "AED",
          terms: v("terms"),
          creditLimit: n("creditLimit"),
          status: "Active",
          notes: v("notes"),
        });
      else if (type === "Part")
        await services.catalogue.save({
          id: part?.id ?? uid(),
          name: v("name"),
          sku: v("sku"),
          brand: v("brand"),
          manufacturer: v("manufacturer"),
          category: v("category"),
          description: v("description"),
          cost: n("cost"),
          price: n("price"),
          currency: "AED",
          unit: v("unit"),
          weight: n("weight"),
          origin: v("origin"),
          reorder: n("reorder"),
          minimum: n("minimum"),
          status: v("status") as Part["status"],
          images: part?.images ?? ["/part.svg"],
          notes: v("notes"),
        });
      else if (type === "Part number")
        await services.catalogue.addNumber({
          id: uid(),
          partId: part!.id,
          display: v("display"),
          normalized: normalizeNumber(v("display")),
          type: v("numberType") as (typeof numberTypes)[number],
          brand: v("brand"),
          supplierId: v("supplierId") || undefined,
          source: v("source"),
          market: v("market"),
          active: true,
          primary: f.has("primary"),
          notes: v("notes"),
          verification: "Demo",
        });
      else if (type === "Transfer") {
        if (!review) {
          setReview(true);
          return;
        }
        await services.inventory.transfer(
          v("partId"),
          v("from"),
          v("to"),
          n("quantity"),
          v("notes"),
        );
      } else if (type === "Adjustment")
        await services.inventory.adjust(
          v("partId"),
          v("from"),
          n("quantity"),
          v("notes"),
        );
      else if (["Purchase", "Sale", "Quotation"].includes(type)) {
        const kind = type === "Purchase" ? "Purchase" : "Sale";
        const o: Order = {
          id: uid(),
          number: `${kind === "Purchase" ? "PO" : "SO"}-${Date.now()}`,
          kind,
          contactId: v("contactId"),
          warehouseId: v("warehouseId"),
          date: new Date().toISOString(),
          status: type === "Quotation" ? "Quotation" : "Draft",
          payment: "Unpaid",
          lines,
          taxRate: n("taxRate"),
          notes: v("notes"),
        };
        if (kind === "Purchase") await services.purchasing.create(o);
        else await services.sales.create(o);
      } else if (type === "Settings")
        await services.management.saveSettings({
          company: v("company"),
          currency: "AED",
          taxRate: n("taxRate"),
          address: v("address"),
        });
      done();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const input = (
    key: string,
    label: string,
    value: string | number = "",
    kind = "text",
    required = false,
  ) => (
    <Field label={label}>
      <input
        name={key}
        type={kind}
        defaultValue={value}
        required={required}
        step={kind === "number" ? "any" : undefined}
      />
    </Field>
  );
  const wh = (key: string, label: string) => (
    <Field label={label}>
      <select name={key}>
        {s.warehouses.map((w) => (
          <option key={w.id} value={w.id}>
            {w.name}
          </option>
        ))}
      </select>
    </Field>
  );
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit(new FormData(e.currentTarget));
      }}
      onChange={() => {
        setError("");
        setReview(false);
      }}
    >
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <div className="form-grid">
        {(type === "Customer" || type === "Supplier") && (
          <>
            {input("name", "Company name", contact?.name ?? "", "text", true)}
            {input("person", "Contact person", contact?.person)}
            {input("email", "Email", contact?.email ?? "", "email", true)}
            {input("phone", "Phone", contact?.phone)}
            {input(
              "country",
              "Country",
              contact?.country ?? "United Arab Emirates",
            )}
            {input("address", "Address", contact?.address)}
            {input("taxNumber", "Tax number", contact?.taxNumber)}
            {input("terms", "Payment terms", contact?.terms ?? "Net 30")}
            {input(
              "creditLimit",
              "Credit limit (AED)",
              contact?.creditLimit ?? 0,
              "number",
            )}
          </>
        )}
        {type === "Part" && (
          <>
            {input("name", "Part name", part?.name ?? "", "text", true)}
            {input(
              "sku",
              "Internal SKU",
              part?.sku ?? `SP-${Date.now()}`,
              "text",
              true,
            )}
            {input("brand", "Brand", part?.brand ?? "", "text", true)}
            {input("manufacturer", "Manufacturer", part?.manufacturer)}
            {input(
              "category",
              "Category",
              part?.category ?? "Engine",
              "text",
              true,
            )}
            {input("description", "Description", part?.description)}
            {input("cost", "Cost (AED)", part?.cost ?? 0, "number")}
            {input("price", "Selling price (AED)", part?.price ?? 0, "number")}
            {input("unit", "Unit", part?.unit ?? "Each")}
            {input("weight", "Weight (kg)", part?.weight ?? 0, "number")}
            {input("origin", "Country of origin", part?.origin)}
            {input("reorder", "Reorder level", part?.reorder ?? 12, "number")}
            {input("minimum", "Minimum stock", part?.minimum ?? 5, "number")}
            <Field label="Status">
              <select name="status" defaultValue={part?.status}>
                <option>Active</option>
                <option>Inactive</option>
              </select>
            </Field>
          </>
        )}
        {type === "Part number" && (
          <>
            {input("display", "Original number", "", "text", true)}
            <Field label="Number type">
              <select name="numberType">
                {numberTypes.map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
            </Field>
            {input("brand", "Manufacturer / brand", part?.brand)}
            {input(
              "source",
              "Catalogue / source",
              "Manual Entry",
              "text",
              true,
            )}
            {input("market", "Country / market", "UAE")}
            <Field label="Supplier">
              <select name="supplierId">
                <option value="">Not applicable</option>
                {s.contacts
                  .filter((c) => c.kind === "Supplier")
                  .map((c) => (
                    <option value={c.id} key={c.id}>
                      {c.name}
                    </option>
                  ))}
              </select>
            </Field>
            <Field label="Primary for this type">
              <input type="checkbox" name="primary" />
            </Field>
            <p className="muted">New numbers are labeled Demo / unverified.</p>
          </>
        )}
        {["Transfer", "Adjustment"].includes(type) && (
          <>
            <Field label="Part">
              <select name="partId" defaultValue={part?.id}>
                {s.parts.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.sku} — {p.name}
                  </option>
                ))}
              </select>
            </Field>
            {wh("from", type === "Transfer" ? "Source warehouse" : "Warehouse")}
            {type === "Transfer" && wh("to", "Destination warehouse")}
            {input(
              "quantity",
              type === "Transfer"
                ? "Transfer quantity"
                : "Quantity change (+ / −)",
              1,
              "number",
              true,
            )}
          </>
        )}
        {["Purchase", "Sale", "Quotation"].includes(type) && (
          <>
            <Field label={type === "Purchase" ? "Supplier" : "Customer"}>
              <select name="contactId">
                {s.contacts
                  .filter(
                    (c) =>
                      c.kind ===
                      (type === "Purchase" ? "Supplier" : "Customer"),
                  )
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
              </select>
            </Field>
            {wh("warehouseId", "Warehouse")}
            {input("taxRate", "Tax rate (%)", s.settings.taxRate, "number")}
          </>
        )}
        {type === "Settings" && (
          <>
            {input("company", "Company name", s.settings.company, "text", true)}
            {input(
              "taxRate",
              "Default tax rate (%)",
              s.settings.taxRate,
              "number",
            )}
            {input("address", "Business address", s.settings.address)}
          </>
        )}
      </div>
      {["Purchase", "Sale", "Quotation"].includes(type) && (
        <div className="order-lines">
          <h3>Line items</h3>
          {lines.map((l, i) => (
            <div className="line-editor" key={i}>
              <Field label="Part">
                <select
                  value={l.partId}
                  onChange={(e) => {
                    const p = s.parts.find((p) => p.id === e.target.value)!;
                    setLines(
                      lines.map((x, j) =>
                        j === i
                          ? {
                              ...x,
                              partId: p.id,
                              price: type === "Purchase" ? p.cost : p.price,
                            }
                          : x,
                      ),
                    );
                  }}
                >
                  {s.parts.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.sku} · {p.name}
                    </option>
                  ))}
                </select>
              </Field>
              {(["quantity", "price", "discount"] as const).map((k) => (
                <Field label={k} key={k}>
                  <input
                    type="number"
                    min={k === "quantity" ? 1 : 0}
                    step={k === "quantity" ? 1 : 0.01}
                    max={k === "discount" ? 100 : undefined}
                    value={l[k]}
                    onChange={(e) =>
                      setLines(
                        lines.map((x, j) =>
                          j === i ? { ...x, [k]: Number(e.target.value) } : x,
                        ),
                      )
                    }
                  />
                </Field>
              ))}
              <button
                type="button"
                aria-label={`Remove line ${i + 1}`}
                onClick={() => setLines(lines.filter((_, j) => j !== i))}
              >
                ×
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() =>
              setLines([
                ...lines,
                {
                  partId: s.parts[0].id,
                  quantity: 1,
                  price: s.parts[0].price,
                  processed: 0,
                  returned: 0,
                  discount: 0,
                },
              ])
            }
          >
            + Add line
          </button>
        </div>
      )}
      <Field
        label={
          ["Transfer", "Adjustment"].includes(type) ? "Reason / notes" : "Notes"
        }
      >
        <textarea
          name="notes"
          defaultValue={part?.notes ?? contact?.notes}
          required={["Transfer", "Adjustment"].includes(type)}
        />
      </Field>
      {review && (
        <p className="notice">
          Review the source, destination, part and quantity above. Confirming
          posts matching outbound and inbound movements.
        </p>
      )}
      <div className="form-actions">
        <button className="primary" type="submit">
          {type === "Transfer"
            ? review
              ? "Confirm transfer"
              : "Review transfer"
            : type === "Purchase" || type === "Sale"
              ? "Save draft"
              : `Save ${type.toLowerCase()}`}
        </button>
      </div>
    </form>
  );
}
