import type { FieldSpec } from "./kit";

const status: FieldSpec = {
  name: "status",
  label: "Status",
  type: "select",
  options: [
    { value: "ACTIVE", label: "Active" },
    { value: "INACTIVE", label: "Inactive" },
  ],
};
const common: FieldSpec[] = [
  { name: "name", label: "Name", required: true },
  { name: "contactPerson", label: "Contact person" },
  { name: "phone", label: "Phone" },
  { name: "email", label: "Email", type: "email" },
  { name: "country", label: "Country" },
  { name: "taxNumber", label: "Tax number" },
  { name: "currency", label: "Currency", help: "3-letter code, e.g. AED" },
  { name: "paymentTerms", label: "Payment terms" },
];
const notes: FieldSpec = { name: "notes", label: "Notes", type: "textarea" };

export const customerFields: FieldSpec[] = [
  ...common,
  { name: "billingAddress", label: "Billing address", type: "textarea" },
  { name: "shippingAddress", label: "Shipping address", type: "textarea" },
  {
    name: "creditLimitMinor",
    label: "Credit limit",
    type: "money",
    optional: true,
  },
  notes,
  status,
];
export const supplierFields: FieldSpec[] = [...common, notes, status];
