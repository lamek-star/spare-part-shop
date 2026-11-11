import type { FieldSpec } from "./kit";

export function productFields(opts: {
  canCost: boolean;
  suppliers: { id: string; name: string }[];
  creating: boolean;
  locations?: { value: string; label: string }[];
  /** The pharmacy edition: medicine details, prescription and batch tracking. */
  pharmacy?: boolean;
}): FieldSpec[] {
  const f: FieldSpec[] = opts.pharmacy
    ? [
        {
          name: "sku",
          label: "Barcode (or your own code)",
          required: true,
          help: "Scan the pack's barcode into this field.",
        },
        { name: "name", label: "Name on the pack", required: true },
        {
          name: "genericName",
          label: "Generic name",
          placeholder: "Paracetamol",
        },
        { name: "strength", label: "Strength", placeholder: "500 mg" },
        {
          name: "dosageForm",
          label: "Dosage form",
          type: "select",
          optional: true,
          options: [
            "",
            "Tablet",
            "Capsule",
            "Syrup",
            "Suspension",
            "Injection",
            "Cream",
            "Ointment",
            "Drops",
            "Inhaler",
            "Suppository",
            "Powder",
            "Device",
            "Other",
          ].map((v) => ({ value: v, label: v || "— choose —" })),
        },
        { name: "brand", label: "Brand" },
        { name: "manufacturer", label: "Manufacturer" },
        { name: "category", label: "Category", placeholder: "Analgesics" },
        {
          name: "prescriptionOnly",
          label: "Prescription only (the till asks for the prescription)",
          type: "checkbox",
        },
        {
          name: "trackBatches",
          label:
            "Keep in batches with expiry dates (sold earliest expiry first)",
          type: "checkbox",
        },
        { name: "priceMinor", label: "Selling price", type: "money" },
      ]
    : [
        { name: "sku", label: "SKU (your own code)", required: true },
        { name: "name", label: "Name", required: true },
        { name: "brand", label: "Brand" },
        { name: "manufacturer", label: "Manufacturer" },
        { name: "category", label: "Category" },
        {
          name: "condition",
          label: "Condition",
          type: "select",
          options: ["NEW", "USED", "REMANUFACTURED", "OTHER"].map((v) => ({
            value: v,
            label: v.charAt(0) + v.slice(1).toLowerCase(),
          })),
        },
        { name: "priceMinor", label: "Selling price", type: "money" },
      ];
  if (opts.canCost)
    f.push({ name: "costMinor", label: "Cost price", type: "money" });
  f.push(
    {
      name: "reorderLevel",
      label: "Reorder level",
      type: "number",
      help: "Warn when available stock falls to this number.",
    },
    {
      name: "unit",
      label: "Unit",
      placeholder: opts.pharmacy ? "Pack" : "Each",
    },
    ...(opts.pharmacy
      ? []
      : [
          {
            name: "weightGrams",
            label: "Weight (grams)",
            type: "number" as const,
            optional: true,
            help: "For shipping; leave empty if unknown.",
          },
        ]),
    {
      name: "origin",
      label: "Origin (country)",
      placeholder: opts.pharmacy ? "India" : "Japan",
    },
    { name: "description", label: "Description", type: "textarea" },
    { name: "notes", label: "Notes (staff only)", type: "textarea" },
    {
      name: "status",
      label: "Status",
      type: "select",
      options: [
        { value: "ACTIVE", label: "Active" },
        { value: "INACTIVE", label: "Inactive" },
      ],
    },
  );
  if (opts.suppliers.length)
    f.splice(f.length - 1, 0, {
      name: "defaultSupplierId",
      label: "Default supplier",
      type: "select",
      optional: true,
      options: [
        { value: "", label: "— none —" },
        ...opts.suppliers.map((s) => ({ value: s.id, label: s.name })),
      ],
    });
  if (opts.creating && opts.locations?.length) {
    f.push(
      {
        name: "openingLocationId",
        label: "Opening stock location",
        type: "select",
        optional: true,
        options: [
          { value: "", label: "— no opening stock —" },
          ...opts.locations,
        ],
      },
      {
        name: "openingQuantity",
        label: "Opening stock quantity",
        type: "number",
        optional: true,
      },
    );
    if (opts.pharmacy)
      f.push(
        {
          name: "openingBatchNo",
          label: "Opening stock batch number",
          optional: true,
        },
        {
          name: "openingExpiryDate",
          label: "Opening stock expiry date",
          type: "date",
          optional: true,
        },
      );
  }
  return f;
}
/** H3: selling below cost may be on purpose (clearance), so it is a question, not a refusal. */
export function belowCostWarning(v: Record<string, unknown>): string | null {
  const price = v.priceMinor;
  const cost = v.costMinor;
  if (typeof price !== "number" || typeof cost !== "number") return null;
  if (cost <= 0 || price >= cost) return null;
  return "The selling price is lower than the cost price, so every sale makes a loss.";
}

export function productPayload(v: Record<string, unknown>) {
  const {
    openingLocationId,
    openingQuantity,
    openingBatchNo,
    openingExpiryDate,
    ...rest
  } = v;
  if (rest.defaultSupplierId === "") rest.defaultSupplierId = null;
  if (openingLocationId && openingQuantity)
    rest.openingStock = {
      locationId: openingLocationId,
      quantity: openingQuantity,
      batchNo: openingBatchNo,
      expiryDate: openingExpiryDate,
    };
  return rest;
}
