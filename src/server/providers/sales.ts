import type {
  PayRequest,
  Enquiry,
  Invoice,
  Page,
  Payment,
  PurchaseOrder,
  Quotation,
  SalesOrder,
} from "../domain/types";
import type { Paged } from "./data";

/** A return of goods against a sales order (stock comes back in). */
export interface SalesReturn {
  id: string;
  number: string;
  salesOrderId: string;
  reason: string;
  lines: {
    orderLineId: string;
    productId: string;
    quantity: number;
    locationId: string;
  }[];
  createdBy: string | null;
  createdAt: string;
}

export interface SalesRepository {
  // ----- enquiries -----
  insertEnquiry(e: Enquiry): Promise<void>;
  /** Persists header fields and replaces the item list. */
  saveEnquiry(e: Enquiry): Promise<void>;
  getEnquiry(id: string): Promise<Enquiry | null>;
  listEnquiries(
    q: Paged & { status?: string; createdBy?: string },
  ): Promise<Page<Enquiry>>;
  /** The caller's open draft (their "cart"), if any. */
  draftEnquiryFor(createdBy: string): Promise<Enquiry | null>;

  // ----- quotations -----
  insertQuotation(q: Quotation): Promise<void>;
  saveQuotation(q: Quotation): Promise<void>;
  getQuotation(id: string): Promise<Quotation | null>;
  listQuotations(
    q: Paged & { status?: string; customerId?: string },
  ): Promise<Page<Quotation>>;
  quotationsForEnquiry(enquiryId: string): Promise<Quotation[]>;

  // ----- sales orders -----
  insertOrder(o: SalesOrder): Promise<void>;
  saveOrder(o: SalesOrder): Promise<void>;
  getOrder(id: string): Promise<SalesOrder | null>;
  listOrders(
    q: Paged & { status?: string; customerId?: string },
  ): Promise<Page<SalesOrder>>;
  orderForQuotation(quotationId: string): Promise<SalesOrder | null>;

  // ----- invoices & payments -----
  insertInvoice(i: Invoice): Promise<void>;
  saveInvoice(i: Invoice): Promise<void>;
  getInvoice(id: string): Promise<Invoice | null>;
  listInvoices(
    q: Paged & {
      status?: string;
      customerId?: string;
      unpaidOnly?: boolean;
      overdueBefore?: string;
    },
  ): Promise<Page<Invoice>>;
  invoicesForOrder(orderId: string): Promise<Invoice[]>;
  insertPayment(p: Payment): Promise<void>;
  paymentsForInvoice(invoiceId: string): Promise<Payment[]>;

  // ----- returns -----
  insertReturn(r: SalesReturn): Promise<void>;
  returnsForOrder(orderId: string): Promise<SalesReturn[]>;
  listReturns(q: Paged): Promise<Page<SalesReturn>>;
  /** The prescription a sale was made against (Pharmacy edition). */
  setPrescriptionRef(orderId: string, ref: string): Promise<void>;
  // ---- IntraForge Pay payments ----
  insertPayRequest(p: PayRequest): Promise<void>;
  getPayRequest(id: string): Promise<PayRequest | null>;
  payRequestsForInvoice(invoiceId: string): Promise<PayRequest[]>;
  /** Marks a pending request paid once; false when it was already settled or closed. */
  settlePayRequest(id: string, paymentId: string, receiptNumber: string): Promise<boolean>;
  closePayRequest(id: string, status: "EXPIRED" | "CANCELLED"): Promise<void>;
}

export interface PurchasingRepository {
  insertOrder(o: PurchaseOrder): Promise<void>;
  saveOrder(o: PurchaseOrder): Promise<void>;
  getOrder(id: string): Promise<PurchaseOrder | null>;
  listOrders(
    q: Paged & { status?: string; supplierId?: string },
  ): Promise<Page<PurchaseOrder>>;
  insertReceipt(r: {
    id: string;
    number: string;
    purchaseOrderId: string;
    locationId: string;
    receivedAt: string;
    notes: string;
    receivedBy: string | null;
    lines: { purchaseLineId: string; productId: string; quantity: number }[];
  }): Promise<void>;
  receiptsForOrder(orderId: string): Promise<
    {
      id: string;
      number: string;
      receivedAt: string;
      locationId: string;
      lines: { purchaseLineId: string; productId: string; quantity: number }[];
    }[]
  >;
}

// ---------- reports ----------
export interface DashboardMetrics {
  products: number;
  activeProducts: number;
  lowStockProducts: number;
  inventoryValueMinor: number | null;
  /** Null when the caller's role may not see that figure. */
  openEnquiries: number | null;
  openQuotations: number | null;
  openOrders: number | null;
  outstandingInvoices: number | null;
  outstandingBalanceMinor: number | null;
  salesThisMonthMinor: number | null;
  paymentsThisMonthMinor: number | null;
}
export interface ProductSalesHistory {
  quantity: number;
  totalMinor: number;
  invoices: number;
  lastSoldAt: string | null;
  recent: {
    invoiceId: string;
    number: string;
    issueDate: string;
    customerName: string;
    quantity: number;
    unitPriceMinor: number;
    totalMinor: number;
  }[];
}
export interface StockLevelRow {
  productId: string;
  sku: string;
  name: string;
  warehouseId: string;
  warehouse: string;
  locationId: string;
  location: string;
  onHand: number;
  reserved: number;
  available: number;
}
/** One day's sales: invoices, money and how it was paid (amounts in minor units). */
export interface DailySalesRow {
  day: string;
  invoices: number;
  netMinor: number;
  taxMinor: number;
  totalMinor: number;
  costMinor: number;
  grossProfitMinor: number;
  cashMinor: number;
  cardMinor: number;
  bankTransferMinor: number;
  otherMinor: number;
}
export interface BatchValuationRow {
  sku: string;
  name: string;
  genericName: string;
  batchNo: string;
  expiryDate: string;
  location: string;
  onHand: number;
  unitCostMinor: number;
  valueMinor: number;
  expired: boolean;
}
export interface WriteOffRow {
  date: string;
  sku: string;
  name: string;
  batchNo: string;
  expiryDate: string;
  quantity: number;
  unitCostMinor: number;
  valueMinor: number;
  note: string;
}
export interface PrescriptionRow {
  date: string;
  invoice: string;
  prescriptionRef: string;
  customer: string;
  sku: string;
  name: string;
  quantity: number;
  totalMinor: number;
}

export interface ReportRepository {
  dashboard(): Promise<DashboardMetrics>;
  stockLevels(q: {
    q?: string;
    warehouseId?: string;
    page?: number;
    pageSize?: number;
  }): Promise<{
    items: StockLevelRow[];
    total: number;
    page: number;
    pageSize: number;
  }>;
  productSales(productId: string, limit: number): Promise<ProductSalesHistory>;
  inventoryValuation(): Promise<
    {
      productId: string;
      sku: string;
      name: string;
      onHand: number;
      reserved: number;
      unitCostMinor: number;
      valueMinor: number;
    }[]
  >;
  stockOnHand(): Promise<
    {
      productId: string;
      sku: string;
      name: string;
      warehouse: string;
      location: string;
      onHand: number;
      reserved: number;
      available: number;
    }[]
  >;
  lowStock(): Promise<
    {
      productId: string;
      sku: string;
      name: string;
      available: number;
      reorderLevel: number;
    }[]
  >;
  salesByPeriod(
    from: string,
    to: string,
  ): Promise<
    {
      period: string;
      invoices: number;
      totalMinor: number;
      paidMinor: number;
    }[]
  >;
  salesByProduct(
    from: string,
    to: string,
  ): Promise<
    {
      productId: string | null;
      sku: string;
      description: string;
      quantity: number;
      totalMinor: number;
    }[]
  >;
  customerActivity(
    from: string,
    to: string,
  ): Promise<
    {
      customerId: string;
      name: string;
      invoices: number;
      totalMinor: number;
      balanceMinor: number;
    }[]
  >;
  outstandingInvoices(asOf: string): Promise<
    {
      invoiceId: string;
      number: string;
      customerName: string;
      issueDate: string;
      dueDate: string | null;
      totalMinor: number;
      balanceMinor: number;
      daysOverdue: number;
    }[]
  >;
  quotationConversion(
    from: string,
    to: string,
  ): Promise<{
    issued: number;
    accepted: number;
    rejected: number;
    expired: number;
    cancelled: number;
  }>;
  supplierOverview(): Promise<
    {
      supplierId: string;
      name: string;
      products: number;
      openPurchaseOrders: number;
    }[]
  >;
  dailySales(from: string, to: string): Promise<DailySalesRow[]>;
  /** Stock left in each batch at cost, expired batches flagged (Pharmacy edition). */
  batchValuation(today: string): Promise<BatchValuationRow[]>;
  expiredWriteOffs(from: string, to: string): Promise<WriteOffRow[]>;
  prescriptionRegister(from: string, to: string): Promise<PrescriptionRow[]>;
}
