import type { MasterDataRepository } from "./data";
import type { SalesRepository } from "./sales";
import type { CatalogueRepository, CatalogueWriter } from "./catalogue";

/**
 * The integration seams by their business names. The standalone build
 * groups related methods into a few repository interfaces (one SQLite
 * transaction spans them); these aliases give each business capability its
 * own name so a platform adapter can be written and reviewed one
 * capability at a time. docs/INTRAFORGE_INTEGRATION_CONTRACT.md maps every
 * one of them to what a platform implementation must provide.
 *
 * Nothing here is implemented against IntraForge in this phase.
 */
export type CustomerRepository = Pick<
  MasterDataRepository,
  "listCustomers" | "getCustomer" | "insertCustomer" | "updateCustomer"
>;
export type SupplierRepository = Pick<
  MasterDataRepository,
  "listSuppliers" | "getSupplier" | "insertSupplier" | "updateSupplier"
>;
export type WarehouseRepository = Pick<
  MasterDataRepository,
  | "listWarehouses"
  | "getWarehouse"
  | "insertWarehouse"
  | "updateWarehouse"
  | "listLocations"
  | "getLocation"
  | "insertLocation"
  | "updateLocation"
>;
export type EnquiryRepository = Pick<
  SalesRepository,
  | "insertEnquiry"
  | "saveEnquiry"
  | "getEnquiry"
  | "listEnquiries"
  | "draftEnquiryFor"
>;
export type QuotationRepository = Pick<
  SalesRepository,
  | "insertQuotation"
  | "saveQuotation"
  | "getQuotation"
  | "listQuotations"
  | "quotationsForEnquiry"
>;
export type OrderRepository = Pick<
  SalesRepository,
  | "insertOrder"
  | "saveOrder"
  | "getOrder"
  | "listOrders"
  | "orderForQuotation"
  | "insertReturn"
  | "returnsForOrder"
  | "listReturns"
>;
export type InvoiceRepository = Pick<
  SalesRepository,
  | "insertInvoice"
  | "saveInvoice"
  | "getInvoice"
  | "listInvoices"
  | "invoicesForOrder"
>;
export type PaymentRepository = Pick<
  SalesRepository,
  "insertPayment" | "paymentsForInvoice"
>;
/** Where the reference catalogue lives (reads, search, writes, import jobs). */
export type CatalogueStorageProvider = CatalogueRepository;
export type CatalogueStorageWriter = CatalogueWriter;

/**
 * A source of reference-catalogue data. Every provider feeds the same
 * normalized model through the same validated, idempotent, provenance-keeping
 * write path; the catalogue itself never knows which provider a record came
 * from except through its source record.
 */
export interface CatalogueProvider {
  key: string;
  name: string;
  kind: "csv" | "offline-package" | "manual" | "online";
  /** True for anything that would contact a third party at runtime. */
  requiresNetwork: boolean;
  /** Shipped and enabled in this build. */
  implemented: boolean;
  /** Where staff start it in the application. */
  entryPoint: string;
  notes: string;
}
export const catalogueProviders: CatalogueProvider[] = [
  {
    key: "csv",
    name: "CSV file",
    kind: "csv",
    requiresNetwork: false,
    implemented: true,
    entryPoint: "Import > CSV import (POST /api/v1/catalogue/import/jobs)",
    notes: "Column detection, mapping, validation, preview, resumable commit.",
  },
  {
    key: "offline-package",
    name: "Offline catalogue package",
    kind: "offline-package",
    requiresNetwork: false,
    implemented: true,
    entryPoint: "Import > Offline package, or `npm run catalogue:import`",
    notes:
      ".ifcatalog / .zip / folder with manifest, checksums, tables and drawings.",
  },
  {
    key: "manual",
    name: "Manual entry",
    kind: "manual",
    requiresNetwork: false,
    implemented: true,
    entryPoint: "POST /api/v1/catalogue/parts",
    notes: "One part typed in by staff; recorded with source 'Manual entry'.",
  },
  {
    key: "toyota-epc",
    name: "Toyota EPC (online)",
    kind: "online",
    requiresNetwork: true,
    implemented: false,
    entryPoint: "not shipped",
    notes:
      "Needs a licence from the data owner. An earlier prototype adapter exists in git history (commit 7099192); a future adapter must emit CatalogueRecord rows into the same write path and export offline packages.",
  },
  {
    key: "nengun",
    name: "Nengun (online)",
    kind: "online",
    requiresNetwork: true,
    implemented: false,
    entryPoint: "not shipped",
    notes:
      "Collection is disabled pending the site owner's permission. Only operator-supplied files can be imported.",
  },
];
