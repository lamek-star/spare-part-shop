/**
 * Domain types shared by the server, the HTTP API and the browser client.
 * Type-only: nothing in here imports node modules, so client code may
 * `import type` from it freely. All money is integer minor units
 * (see server/kernel/money.ts); all rates are integer basis points.
 */
export const roles = [
  "OWNER",
  "ADMIN",
  "SALES",
  "INVENTORY",
  "VIEWER",
] as const;
export type Role = (typeof roles)[number];

export interface Actor {
  id: string;
  email: string;
  displayName: string;
  role: Role;
  /** Set by a platform identity provider (IntraForge) that grants
   * permissions individually; then it, not the role, decides. The role is
   * kept for display and for the few owner/admin conveniences. */
  permissions?: readonly string[];
}
export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}
export interface PageQuery {
  page?: number;
  pageSize?: number;
  q?: string;
}

// ---------- master data ----------
export interface Customer {
  id: string;
  code: string;
  name: string;
  contactPerson: string;
  phone: string;
  email: string;
  billingAddress: string;
  shippingAddress: string;
  country: string;
  taxNumber: string;
  currency: string;
  paymentTerms: string;
  creditLimitMinor: number;
  notes: string;
  status: "ACTIVE" | "INACTIVE";
  createdAt: string;
  updatedAt: string;
}
export type CustomerInput = Partial<
  Omit<Customer, "id" | "code" | "createdAt" | "updatedAt">
> & { name: string };
export interface Supplier {
  id: string;
  code: string;
  name: string;
  contactPerson: string;
  phone: string;
  email: string;
  address: string;
  country: string;
  taxNumber: string;
  currency: string;
  paymentTerms: string;
  notes: string;
  status: "ACTIVE" | "INACTIVE";
  createdAt: string;
  updatedAt: string;
}
export type SupplierInput = Partial<
  Omit<Supplier, "id" | "code" | "createdAt" | "updatedAt">
> & { name: string };
export interface Branch {
  id: string;
  name: string;
  address: string;
  status: "ACTIVE" | "INACTIVE";
}
export interface Warehouse {
  id: string;
  code: string;
  name: string;
  branchId: string | null;
  address: string;
  status: "ACTIVE" | "INACTIVE";
}
export interface Location {
  id: string;
  warehouseId: string;
  code: string;
  rack: string;
  shelf: string;
  bin: string;
  description: string;
}

// ---------- products ----------
export const productConditions = [
  "NEW",
  "USED",
  "REMANUFACTURED",
  "OTHER",
] as const;
export type ProductCondition = (typeof productConditions)[number];
export interface Product {
  id: string;
  sku: string;
  name: string;
  brand: string;
  manufacturer: string;
  category: string;
  description: string;
  condition: ProductCondition;
  unit: string;
  weightGrams: number;
  origin: string;
  status: "ACTIVE" | "INACTIVE";
  /** Cost is permission controlled: null when the caller may not see it. */
  costMinor: number | null;
  priceMinor: number;
  currency: string;
  taxCategory: string;
  reorderLevel: number;
  minimumLevel: number;
  defaultSupplierId: string | null;
  defaultLocationId: string | null;
  notes: string;
  createdAt: string;
  updatedAt: string;
}
export interface ProductNumber {
  id: string;
  productId: string;
  display: string;
  normalized: string;
  type: string;
  brand: string;
  source: string;
  market: string;
  active: boolean;
  primary: boolean;
  notes: string;
  supplierId: string | null;
  supersededByNumber: string | null;
}
export interface ProductSupplier {
  id: string;
  productId: string;
  supplierId: string;
  supplierPartNumber: string;
  costMinor: number | null;
  currency: string;
  isDefault: boolean;
  notes: string;
}
export interface ProductImage {
  id: string;
  productId: string;
  fileId: string;
  position: number;
  isPrimary: boolean;
  caption: string;
  mime: string;
  size: number;
  url: string;
}
export interface ReferenceLink {
  id: string;
  productId: string;
  referencePartId: string;
  oemNumber: string;
  linkedAt: string;
}
export interface ProductInput {
  sku: string;
  name: string;
  brand?: string;
  manufacturer?: string;
  category?: string;
  description?: string;
  condition?: ProductCondition;
  unit?: string;
  weightGrams?: number;
  origin?: string;
  status?: "ACTIVE" | "INACTIVE";
  costMinor?: number;
  priceMinor: number;
  currency?: string;
  taxCategory?: string;
  reorderLevel?: number;
  minimumLevel?: number;
  defaultSupplierId?: string | null;
  defaultLocationId?: string | null;
  notes?: string;
}

// ---------- inventory ----------
export const movementTypes = [
  "OPENING_BALANCE",
  "RECEIPT",
  "SALE",
  "RETURN_IN",
  "RETURN_OUT",
  "TRANSFER_IN",
  "TRANSFER_OUT",
  "ADJUSTMENT_IN",
  "ADJUSTMENT_OUT",
] as const;
export type MovementType = (typeof movementTypes)[number];
export interface StockBalance {
  productId: string;
  locationId: string;
  warehouseId: string;
  onHand: number;
  reserved: number;
  available: number;
}
export interface StockMovement {
  id: string;
  productId: string;
  locationId: string;
  type: MovementType;
  /** Signed: positive adds to on-hand, negative removes. */
  quantity: number;
  referenceType: string;
  referenceId: string | null;
  note: string;
  createdAt: string;
  createdBy: string | null;
}
export interface Reservation {
  id: string;
  productId: string;
  locationId: string;
  quantity: number;
  status: "ACTIVE" | "RELEASED" | "FULFILLED";
  referenceType: string;
  referenceId: string;
  createdAt: string;
  closedAt: string | null;
}

// ---------- sales chain ----------
export const enquiryStatuses = [
  "DRAFT",
  "SUBMITTED",
  "QUOTED",
  "CLOSED",
  "CANCELLED",
] as const;
export type EnquiryStatus = (typeof enquiryStatuses)[number];
export interface EnquiryItem {
  id: string;
  enquiryId: string;
  position: number;
  oemNumber: string;
  partName: string;
  vehicleDescription: string;
  quantity: number;
  referencePartId: string | null;
  providerKey: string;
  sourceUrl: string;
  notes: string;
  addedAt: string;
}
export interface Enquiry {
  id: string;
  number: string;
  status: EnquiryStatus;
  customerId: string | null;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  vin: string;
  notes: string;
  items: EnquiryItem[];
  createdBy: string | null;
  createdAt: string;
  submittedAt: string | null;
  updatedAt: string;
}
export interface DocumentLine {
  id: string;
  position: number;
  productId: string | null;
  sku: string;
  oemNumber: string;
  description: string;
  quantity: number;
  unitPriceMinor: number;
  discountBp: number;
  lineTotalMinor: number;
  /** Invoice lines only: the sales-order line this bills. */
  orderItemId?: string | null;
}
export type DocumentLineInput = {
  productId?: string | null;
  sku?: string;
  oemNumber?: string;
  description: string;
  quantity: number;
  unitPriceMinor: number;
  discountBp?: number;
};
export interface Totals {
  subtotalMinor: number;
  taxMinor: number;
  totalMinor: number;
}
export const quotationStatuses = [
  "DRAFT",
  "ISSUED",
  "ACCEPTED",
  "REJECTED",
  "EXPIRED",
  "CANCELLED",
] as const;
export type QuotationStatus = (typeof quotationStatuses)[number];
export interface Quotation extends Totals {
  id: string;
  number: string;
  status: QuotationStatus;
  enquiryId: string | null;
  customerId: string;
  currency: string;
  taxBp: number;
  validUntil: string | null;
  notes: string;
  terms: string;
  lines: DocumentLine[];
  issuedAt: string | null;
  acceptedAt: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}
export const orderStatuses = [
  "CONFIRMED",
  "PARTIALLY_FULFILLED",
  "FULFILLED",
  "INVOICED",
  "CANCELLED",
] as const;
export type OrderStatus = (typeof orderStatuses)[number];
export interface SalesOrderLine extends DocumentLine {
  quantityFulfilled: number;
  quantityReturned: number;
  quantityInvoiced: number;
}
export interface SalesOrder extends Totals {
  id: string;
  number: string;
  status: OrderStatus;
  quotationId: string | null;
  enquiryId: string | null;
  customerId: string;
  currency: string;
  taxBp: number;
  notes: string;
  lines: SalesOrderLine[];
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}
export const invoiceStatuses = [
  "ISSUED",
  "PARTIALLY_PAID",
  "PAID",
  "VOID",
] as const;
export type InvoiceStatus = (typeof invoiceStatuses)[number];
export interface Invoice extends Totals {
  id: string;
  number: string;
  status: InvoiceStatus;
  salesOrderId: string | null;
  quotationId: string | null;
  customerId: string;
  currency: string;
  taxBp: number;
  issueDate: string;
  dueDate: string | null;
  amountPaidMinor: number;
  balanceMinor: number;
  notes: string;
  lines: DocumentLine[];
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}
export const paymentMethods = [
  "CASH",
  "BANK_TRANSFER",
  "CARD",
  "OTHER",
] as const;
export type PaymentMethod = (typeof paymentMethods)[number];
export interface Payment {
  id: string;
  invoiceId: string;
  amountMinor: number;
  method: PaymentMethod;
  reference: string;
  paidAt: string;
  notes: string;
  recordedBy: string | null;
  createdAt: string;
}

// ---------- purchasing ----------
export const purchaseStatuses = [
  "DRAFT",
  "CONFIRMED",
  "PARTIALLY_RECEIVED",
  "RECEIVED",
  "CLOSED",
  "CANCELLED",
] as const;
export type PurchaseStatus = (typeof purchaseStatuses)[number];
export interface PurchaseLine {
  id: string;
  position: number;
  productId: string;
  quantity: number;
  quantityReceived: number;
  unitCostMinor: number;
  discountBp: number;
  lineTotalMinor: number;
}
export interface PurchaseOrder extends Totals {
  id: string;
  number: string;
  status: PurchaseStatus;
  supplierId: string;
  /** Where received goods are put away. */
  locationId: string;
  currency: string;
  taxBp: number;
  expectedDate: string | null;
  notes: string;
  lines: PurchaseLine[];
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

// ---------- audit ----------
export interface AuditEvent {
  id: string;
  at: string;
  actorId: string | null;
  actorLabel: string;
  action: string;
  entityType: string;
  entityId: string | null;
  summary: string;
  metadata: Record<string, unknown> | null;
}
