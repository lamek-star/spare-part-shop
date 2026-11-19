import type { FieldSpec } from "./kit";
import type { Translate } from "./i18n";
import { translate } from "./messages";

export function productFields(opts: {
  /** The person's language (useT()). */
  t: Translate;
  canCost: boolean;
  suppliers: { id: string; name: string }[];
  creating: boolean;
  locations?: { value: string; label: string }[];
  /** The pharmacy edition: medicine details, prescription and batch tracking. */
  pharmacy?: boolean;
}): FieldSpec[] {
  const { t } = opts;
  const f: FieldSpec[] = opts.pharmacy
    ? [
        {
          name: "sku",
          label: t("prod.barcodeOrYourOwnCode"),
          required: true,
          help: t("prod.scanThePackSBarcode"),
        },
        { name: "name", label: t("prod.nameOnThePack"), required: true },
        {
          name: "genericName",
          label: t("prod.genericName"),
          placeholder: t("prod.paracetamol"),
        },
        { name: "strength", label: t("prod.strength"), placeholder: "500 mg" },
        {
          name: "dosageForm",
          label: t("prod.dosageForm"),
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
        { name: "brand", label: t("prod.brand") },
        { name: "manufacturer", label: t("prod.manufacturer") },
        {
          name: "category",
          label: t("prod.category"),
          placeholder: t("prod.analgesics"),
        },
        {
          name: "prescriptionOnly",
          label: t("prod.prescriptionOnlyTheTillAsks"),
          type: "checkbox",
        },
        {
          name: "trackBatches",
          label: t("prod.keepInBatchesWithExpiry"),
          type: "checkbox",
        },
        { name: "priceMinor", label: t("prod.sellingPrice"), type: "money" },
      ]
    : [
        { name: "sku", label: t("prod.skuYourOwnCode"), required: true },
        { name: "name", label: t("users.name"), required: true },
        { name: "brand", label: t("prod.brand") },
        { name: "manufacturer", label: t("prod.manufacturer") },
        { name: "category", label: t("prod.category") },
        {
          name: "condition",
          label: t("prod.condition"),
          type: "select",
          options: ["NEW", "USED", "REMANUFACTURED", "OTHER"].map((v) => ({
            value: v,
            label: v.charAt(0) + v.slice(1).toLowerCase(),
          })),
        },
        { name: "priceMinor", label: t("prod.sellingPrice"), type: "money" },
      ];
  if (opts.canCost)
    f.push({ name: "costMinor", label: t("prod.costPrice"), type: "money" });
  f.push(
    {
      name: "reorderLevel",
      label: t("prod.reorderLevel"),
      type: "number",
      help: t("prod.warnWhenAvailableStockFalls"),
    },
    {
      name: "unit",
      label: t("prod.unit"),
      placeholder: opts.pharmacy ? "Pack" : "Each",
    },
    ...(opts.pharmacy
      ? []
      : [
          {
            name: "weightGrams",
            label: t("prod.weightGrams"),
            type: "number" as const,
            optional: true,
            help: t("prod.forShippingLeaveEmptyIf"),
          },
        ]),
    {
      name: "origin",
      label: t("prod.originCountry"),
      placeholder: opts.pharmacy ? "India" : "Japan",
    },
    { name: "description", label: t("lines.description"), type: "textarea" },
    { name: "notes", label: t("prod.notesStaffOnly"), type: "textarea" },
    {
      name: "status",
      label: t("common.status"),
      type: "select",
      options: [
        { value: "ACTIVE", label: t("status.ACTIVE") },
        { value: "INACTIVE", label: t("status.INACTIVE") },
      ],
    },
  );
  if (opts.suppliers.length)
    f.splice(f.length - 1, 0, {
      name: "defaultSupplierId",
      label: t("prod.defaultSupplier"),
      type: "select",
      optional: true,
      options: [
        { value: "", label: t("prod.none") },
        ...opts.suppliers.map((s) => ({ value: s.id, label: s.name })),
      ],
    });
  if (opts.creating && opts.locations?.length) {
    f.push(
      {
        name: "openingLocationId",
        label: t("prod.openingStockLocation"),
        type: "select",
        optional: true,
        options: [
          { value: "", label: t("prod.noOpeningStock") },
          ...opts.locations,
        ],
      },
      {
        name: "openingQuantity",
        label: t("prod.openingStockQuantity"),
        type: "number",
        optional: true,
      },
    );
    if (opts.pharmacy)
      f.push(
        {
          name: "openingBatchNo",
          label: t("prod.openingStockBatchNumber"),
          optional: true,
        },
        {
          name: "openingExpiryDate",
          label: t("prod.openingStockExpiryDate"),
          type: "date",
          optional: true,
        },
      );
  }
  return f;
}
/** H3: selling below cost may be on purpose (clearance), so it is a question, not a refusal. */
export function belowCostWarning(
  v: Record<string, unknown>,
  t: Translate = (key, vars) => translate("en", key, vars),
): string | null {
  const price = v.priceMinor;
  const cost = v.costMinor;
  if (typeof price !== "number" || typeof cost !== "number") return null;
  if (cost <= 0 || price >= cost) return null;
  return t("prod.belowCost");
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
