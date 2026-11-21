import type { FieldSpec } from "./kit";
import { useT, type Translate } from "./i18n";
import { translate } from "./messages";

/** The part number shown beside the SKU: the active OEM number, else any other active part number
 * (the same rule as the server's mainPartNumber for the product list). */
export function mainPartNumber(
  numbers: { display: string; type: string; active: boolean }[],
): string {
  const active = numbers.filter((n) => n.active && n.type !== "INTERNAL_SKU");
  return (active.find((n) => n.type === "OEM_OE") ?? active[0])?.display ?? "";
}

/** The default units ("Each", "Pack") in the person's language; a unit the shop typed itself is shown as typed. */
export function useUnitLabel() {
  const t = useT();
  return (unit: string) =>
    unit === "Each" ? t("prod.each") : unit === "Pack" ? t("prod.pack") : unit;
}

/** A product's condition; each has a "status.<value>" text in every language. */
export const CONDITIONS = ["NEW", "USED", "REMANUFACTURED", "OTHER"] as const;

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
        // The manufacturer's number goes in with a new product; later ones are added on its Part numbers tab.
        ...(opts.creating
          ? [
              {
                name: "partNumber",
                label: t("prod.partNumberOem"),
                optional: true,
                placeholder: "04465-33450",
                help: t("prod.partNumberHelp"),
              },
            ]
          : []),
        { name: "name", label: t("users.name"), required: true },
        { name: "brand", label: t("prod.brand") },
        { name: "manufacturer", label: t("prod.manufacturer") },
        { name: "category", label: t("prod.category") },
        {
          name: "condition",
          label: t("prod.condition"),
          type: "select",
          options: CONDITIONS.map((v) => ({
            value: v,
            label: t(`status.${v}`),
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
      // Red on the dashboard at or below this; amber at or below the reorder level; green above it.
      name: "minimumLevel",
      label: t("prod.minimumLevel"),
      type: "number",
      help: t("prod.minimumLevelHelp"),
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
