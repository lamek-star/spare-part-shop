"use client";
import { FormModal, useApi, type FieldSpec } from "./kit";
import { post } from "./api";

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
const batchFields = (required: boolean, help?: string): FieldSpec[] => [
  {
    name: "batchNo",
    label: "Batch number",
    required,
    optional: !required,
    help,
  },
  {
    name: "expiryDate",
    label: "Expiry date",
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
  const fields: FieldSpec[] = [
    {
      name: "locationId",
      label: "Location",
      type: "select",
      options: locationOptions(warehouses),
    },
    {
      name: "quantity",
      label: "Quantity received",
      type: "number",
      required: true,
    },
    ...(trackBatches ? batchFields(true) : []),
    { name: "note", label: "Note (delivery note, source)", optional: true },
  ];
  return (
    <FormModal
      title={`Receive stock — ${productName}`}
      fields={fields}
      submitLabel="Receive"
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
  const fields: FieldSpec[] = [
    {
      name: "locationId",
      label: "Location",
      type: "select",
      options: locationOptions(warehouses),
    },
    {
      name: "delta",
      label: "Change in quantity",
      type: "number",
      required: true,
      help: "Use a negative number to remove stock, e.g. -2 for damaged goods.",
    },
    ...(trackBatches
      ? batchFields(
          false,
          "Needed when adding stock. When removing, leave empty to take from the batch that expires first.",
        )
      : []),
    { name: "reason", label: "Reason", type: "textarea", required: true },
  ];
  return (
    <FormModal
      title={`Adjust stock — ${productName}`}
      fields={fields}
      submitLabel="Save adjustment"
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
  const opts = locationOptions(warehouses);
  const fields: FieldSpec[] = [
    { name: "fromLocationId", label: "From", type: "select", options: opts },
    { name: "toLocationId", label: "To", type: "select", options: opts },
    { name: "quantity", label: "Quantity", type: "number", required: true },
    { name: "note", label: "Note", optional: true },
  ];
  return (
    <FormModal
      title={`Transfer stock — ${productName}`}
      fields={fields}
      submitLabel="Transfer"
      onClose={onClose}
      onSubmit={(v) => run("/inventory/transfer", { ...v, productId }, onDone)}
    />
  );
}
