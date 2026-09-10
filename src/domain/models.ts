export const numberTypes = [
  "INTERNAL_SKU",
  "OEM_OE",
  "MANUFACTURER_MPN",
  "AFTERMARKET",
  "SUPPLIER",
  "CROSS_REFERENCE",
  "INTERCHANGE",
  "SUPERSEDED",
  "PREVIOUS",
  "REPLACEMENT",
  "BARCODE_EAN_UPC_GTIN",
  "CATALOGUE",
  "ENGINE_REFERENCE",
  "TRANSMISSION_REFERENCE",
  "OTHER",
] as const;
export type NumberType = (typeof numberTypes)[number];
export interface Part {
  imageMetadata?: Record<
    string,
    {
      mime: string;
      size: number;
      width: number;
      height: number;
      rights: import("../catalogue/models").ImageRights;
      source: string;
    }
  >;
  preferredCataloguePartId?: string;
  supplierId?: string;
  defaultWarehouseId?: string;
  taxCategory?: string;
  referenceProvenance?: import("../catalogue/models").Provenance;
  id: string;
  name: string;
  sku: string;
  brand: string;
  manufacturer: string;
  category: string;
  description: string;
  cost: number;
  price: number;
  currency: string;
  unit: string;
  weight: number;
  origin: string;
  reorder: number;
  minimum: number;
  status: "Active" | "Inactive";
  images: string[];
  notes: string;
  pricingPending?: boolean;
  catalogueSource?: {
    provider: string;
    url: string;
    diagramUrl: string;
    diagramCode: string;
    observedAt: string;
    priceJpy: number | null;
    availability: string;
    quantityRequired: number | null;
    applicability: string;
    specification: string;
  };
}
export interface PartNumber {
  provenance?: import("../catalogue/models").Provenance;
  readonly id: string;
  partId: string;
  display: string;
  normalized: string;
  type: NumberType;
  brand: string;
  supplierId?: string;
  source: string;
  market: string;
  active: boolean;
  primary: boolean;
  notes: string;
  verification: "Demo" | "Verified" | "Supplier listed";
  supersededBy?: string;
}
export interface Vehicle {
  id: string;
  make: string;
  model: string;
  variant: string;
  from: number;
  to: number;
  engine: string;
  engineCode: string;
  transmission: string;
}
export interface Compatibility {
  id: string;
  partId: string;
  vehicleId: string;
  notes: string;
  source: string;
}
export interface Warehouse {
  id: string;
  name: string;
  branch: string;
  address: string;
}
export type MovementType =
  | "OPENING_BALANCE"
  | "PURCHASE_RECEIPT"
  | "SALE"
  | "RETURN_IN"
  | "RETURN_OUT"
  | "TRANSFER_IN"
  | "TRANSFER_OUT"
  | "ADJUSTMENT";
export interface Movement {
  id: string;
  partId: string;
  warehouseId: string;
  quantity: number;
  type: MovementType;
  reference: string;
  date: string;
  notes: string;
}
export interface Stock {
  partId: string;
  warehouseId: string;
  onHand: number;
  reserved: number;
  available: number;
  bin: string;
}
export interface Contact {
  id: string;
  kind: "Customer" | "Supplier";
  name: string;
  person: string;
  country: string;
  phone: string;
  email: string;
  address: string;
  taxNumber: string;
  currency: string;
  terms: string;
  creditLimit: number;
  status: string;
  notes: string;
}
export interface Line {
  partId: string;
  quantity: number;
  price: number;
  processed: number;
  returned: number;
  discount: number;
}
export interface Order {
  id: string;
  number: string;
  kind: "Purchase" | "Sale";
  contactId: string;
  warehouseId: string;
  date: string;
  status:
    | "Draft"
    | "Quotation"
    | "Confirmed"
    | "Partially Received"
    | "Received"
    | "Closed"
    | "Fulfilled"
    | "Invoiced";
  payment: "Unpaid" | "Paid";
  lines: Line[];
  taxRate: number;
  notes: string;
  invoiceNumber?: string;
}
export interface Attachment {
  id: string;
  name: string;
  entityType: string;
  entityId: string;
  mime: string;
  size: number;
  url: string;
  date: string;
}
export interface Audit {
  id: string;
  date: string;
  action: string;
  detail: string;
  actor: string;
}
export interface Settings {
  company: string;
  currency: string;
  taxRate: number;
  address: string;
}
export interface Branch {
  id: string;
  name: string;
  address: string;
  status: string;
}
export interface DemoUser {
  id: string;
  name: string;
  email: string;
  role: string;
  branchId: string;
  status: string;
}
export interface Role {
  id: string;
  name: string;
  permissions: string[];
}
export interface State {
  version: 1;
  parts: Part[];
  numbers: PartNumber[];
  vehicles: Vehicle[];
  compatibility: Compatibility[];
  warehouses: Warehouse[];
  contacts: Contact[];
  movements: Movement[];
  orders: Order[];
  documents: Attachment[];
  audit: Audit[];
  settings: Settings;
  branches: Branch[];
  users: DemoUser[];
  roles: Role[];
}
export const normalizeNumber = (value: string) =>
  value.toUpperCase().replace(/[\s-]/g, "");
export const money = (n: number) =>
  new Intl.NumberFormat("en-AE", {
    style: "currency",
    currency: "AED",
    maximumFractionDigits: 2,
  }).format(n);
export function totals(order: Order) {
  const subtotal =
    Math.round(
      order.lines.reduce(
        (n, l) => n + l.quantity * l.price * (1 - l.discount / 100),
        0,
      ) * 100,
    ) / 100;
  const tax = Math.round(subtotal * order.taxRate) / 100;
  return { subtotal, tax, total: Math.round((subtotal + tax) * 100) / 100 };
}
