import type { FieldSpec } from "./kit";

export function productFields(opts: { canCost: boolean; suppliers: { id: string; name: string }[]; creating: boolean; locations?: { value: string; label: string }[] }): FieldSpec[] {
  const f: FieldSpec[] = [
    { name: "sku", label: "SKU (your own code)", required: true },
    { name: "name", label: "Name", required: true },
    { name: "brand", label: "Brand" },
    { name: "manufacturer", label: "Manufacturer" },
    { name: "category", label: "Category" },
    { name: "condition", label: "Condition", type: "select", options: ["NEW", "USED", "REMANUFACTURED", "OTHER"].map((v) => ({ value: v, label: v.charAt(0) + v.slice(1).toLowerCase() })) },
    { name: "priceMinor", label: "Selling price", type: "money" },
  ];
  if (opts.canCost) f.push({ name: "costMinor", label: "Cost price", type: "money" });
  f.push(
    { name: "reorderLevel", label: "Reorder level", type: "number", help: "Warn when available stock falls to this number." },
    { name: "unit", label: "Unit", placeholder: "Each" },
    { name: "description", label: "Description", type: "textarea" },
    { name: "status", label: "Status", type: "select", options: [{ value: "ACTIVE", label: "Active" }, { value: "INACTIVE", label: "Inactive" }] },
  );
  if (opts.suppliers.length) f.splice(f.length - 1, 0, { name: "defaultSupplierId", label: "Default supplier", type: "select", optional: true, options: [{ value: "", label: "— none —" }, ...opts.suppliers.map((s) => ({ value: s.id, label: s.name }))] });
  if (opts.creating && opts.locations?.length) {
    f.push({ name: "openingLocationId", label: "Opening stock location", type: "select", optional: true, options: [{ value: "", label: "— no opening stock —" }, ...opts.locations] }, { name: "openingQuantity", label: "Opening stock quantity", type: "number", optional: true });
  }
  return f;
}
export function productPayload(v: Record<string, unknown>) {
  const { openingLocationId, openingQuantity, ...rest } = v;
  if (rest.defaultSupplierId === "") rest.defaultSupplierId = null;
  if (openingLocationId && openingQuantity) rest.openingStock = { locationId: openingLocationId, quantity: openingQuantity };
  return rest;
}
