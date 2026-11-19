"use client";
import { FormModal, useApi, type FieldSpec } from "./kit";
import { post } from "./api";
import { useT, type Translate } from "./i18n";

export interface WarehousesData {
  warehouses: {
    id: string;
    code: string;
    name: string;
    status: string;
    address: string;
  }[];
  locations: {
    id: string;
    warehouseId: string;
    code: string;
    rack: string;
    shelf: string;
    bin: string;
    description: string;
  }[];
}
export function useWarehouses(enabled = true) {
  return useApi<WarehousesData>(enabled ? "/warehouses" : null);
}
export const locationOptions = (w: WarehousesData | null) =>
  (w?.locations ?? []).map((l) => {
    const place = [
      l.rack && `Rack ${l.rack}`,
      l.shelf && `Shelf ${l.shelf}`,
      l.bin && `Bin ${l.bin}`,
    ]
      .filter(Boolean)
      .join(" · ");
    return {
      value: l.id,
      label: `${w?.warehouses.find((x) => x.id === l.warehouseId)?.name ?? ""} · ${l.code}${place ? ` (${place})` : ""}`,
    };
  });

type StockModalProps = {
  productId: string;
  productName: string;
  /** The product keeps batches with expiry dates. */
  trackBatches?: boolean;
  warehouses: WarehousesData | null;
  onClose: () => void;
  onDone: () => void;
};
const run = (path: string, body: unknown, done: () => void) =>
  post(path, body).then(done);

/** Batch number and expiry date, as printed on the pack. */
const batchFields = (
  t: Translate,
  required: boolean,
  help?: string,
): FieldSpec[] => [
  {
    name: "batchNo",
    label: t("stock.batchNumber"),
    required,
    optional: !required,
    help,
  },
  {
    name: "expiryDate",
    label: t("stock.expiryDate"),
    type: "date",
    required,
    optional: !required,
  },
];

export function ReceiveStockModal({
  productId,
  productName,
  trackBatches,
  warehouses,
  onClose,
  onDone,
}: StockModalProps) {
  const t = useT();
  const fields: FieldSpec[] = [
    {
      name: "locationId",
      label: t("stock.location"),
      type: "select",
      options: locationOptions(warehouses),
    },
    {
      name: "quantity",
      label: t("stock.quantityReceived"),
      type: "number",
      required: true,
    },
    ...(trackBatches ? batchFields(t, true) : []),
    { name: "note", label: t("stock.noteDeliveryNoteSource"), optional: true },
  ];
  return (
    <FormModal
      title={`Receive stock — ${productName}`}
      fields={fields}
      submitLabel={t("stock.receive")}
      onClose={onClose}
      onSubmit={(v) => run("/inventory/receive", { ...v, productId }, onDone)}
    />
  );
}
export function AdjustStockModal({
  productId,
  productName,
  trackBatches,
  warehouses,
  onClose,
  onDone,
}: StockModalProps) {
  const t = useT();
  const fields: FieldSpec[] = [
    {
      name: "locationId",
      label: t("stock.location"),
      type: "select",
      options: locationOptions(warehouses),
    },
    {
      name: "delta",
      label: t("stock.changeInQuantity"),
      type: "number",
      required: true,
      help: t("stock.useANegativeNumberTo"),
    },
    ...(trackBatches ? batchFields(t, false, t("stock.batchHelp")) : []),
    {
      name: "reason",
      label: t("orders.reason"),
      type: "textarea",
      required: true,
    },
  ];
  return (
    <FormModal
      title={`Adjust stock — ${productName}`}
      fields={fields}
      submitLabel={t("stock.saveAdjustment")}
      onClose={onClose}
      onSubmit={(v) => run("/inventory/adjust", { ...v, productId }, onDone)}
    />
  );
}
export function TransferStockModal({
  productId,
  productName,
  warehouses,
  onClose,
  onDone,
}: StockModalProps) {
  const t = useT();
  const opts = locationOptions(warehouses);
  const fields: FieldSpec[] = [
    {
      name: "fromLocationId",
      label: t("stock.from"),
      type: "select",
      options: opts,
    },
    { name: "toLocationId", label: "To", type: "select", options: opts },
    {
      name: "quantity",
      label: t("lines.quantity"),
      type: "number",
      required: true,
    },
    { name: "note", label: t("stock.note"), optional: true },
  ];
  return (
    <FormModal
      title={`Transfer stock — ${productName}`}
      fields={fields}
      submitLabel={t("stock.transfer")}
      onClose={onClose}
      onSubmit={(v) => run("/inventory/transfer", { ...v, productId }, onDone)}
    />
  );
}
