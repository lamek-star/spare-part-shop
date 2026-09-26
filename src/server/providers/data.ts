import type {
  Branch,
  Customer,
  Location,
  MovementType,
  Page,
  Product,
  ProductImage,
  ProductNumber,
  ProductSupplier,
  ReferenceLink,
  Reservation,
  StockBalance,
  StockMovement,
  Supplier,
  Warehouse,
} from "../domain/types";

/**
 * Data-access interfaces for master data, products and inventory. They
 * are deliberately storage-agnostic (async, plain data in/out): a later
 * IntraForge Data Storage implementation replaces the SQLite ones in
 * server/standalone/repos without touching services or the UI. Business
 * rules live in the services; repositories only persist and query.
 */
export interface Paged {
  page?: number;
  pageSize?: number;
  q?: string;
}

export interface MasterDataRepository {
  listCustomers(query: Paged & { status?: string }): Promise<Page<Customer>>;
  getCustomer(id: string): Promise<Customer | null>;
  insertCustomer(c: Customer): Promise<void>;
  updateCustomer(c: Customer): Promise<void>;

  listSuppliers(query: Paged & { status?: string }): Promise<Page<Supplier>>;
  getSupplier(id: string): Promise<Supplier | null>;
  insertSupplier(s: Supplier): Promise<void>;
  updateSupplier(s: Supplier): Promise<void>;

  listBranches(): Promise<Branch[]>;
  saveBranch(b: Branch): Promise<void>;

  listWarehouses(): Promise<Warehouse[]>;
  getWarehouse(id: string): Promise<Warehouse | null>;
  insertWarehouse(w: Warehouse): Promise<void>;
  updateWarehouse(w: Warehouse): Promise<void>;
  listLocations(warehouseId?: string): Promise<Location[]>;
  getLocation(id: string): Promise<Location | null>;
  insertLocation(l: Location): Promise<void>;
  updateLocation(l: Location): Promise<void>;
}

export interface ProductQuery extends Paged {
  status?: "ACTIVE" | "INACTIVE";
  category?: string;
  brand?: string;
  lowStockOnly?: boolean;
}
export interface ProductRow extends Product {
  /** Stored cost, unmasked; the service masks it for the caller. */
  costMinor: number;
}

export interface ProductRepository {
  list(query: ProductQuery): Promise<Page<ProductRow>>;
  get(id: string): Promise<ProductRow | null>;
  getBySku(sku: string): Promise<ProductRow | null>;
  findByNormalizedNumber(normalized: string): Promise<ProductRow[]>;
  insert(p: ProductRow, createdBy: string | null): Promise<void>;
  update(p: ProductRow): Promise<void>;
  categories(): Promise<string[]>;

  numbers(productId: string): Promise<ProductNumber[]>;
  upsertNumber(n: ProductNumber): Promise<void>;
  removeNumber(id: string): Promise<void>;

  suppliers(
    productId: string,
  ): Promise<(ProductSupplier & { costMinor: number })[]>;
  upsertSupplier(s: ProductSupplier & { costMinor: number }): Promise<void>;
  removeSupplier(id: string): Promise<void>;

  images(productId: string): Promise<Omit<ProductImage, "url">[]>;
  getImage(id: string): Promise<Omit<ProductImage, "url"> | null>;
  addImage(i: Omit<ProductImage, "url">, createdAt: string): Promise<void>;
  setPrimaryImage(productId: string, imageId: string): Promise<void>;
  reorderImages(productId: string, orderedIds: string[]): Promise<void>;
  removeImage(id: string): Promise<void>;

  links(productId: string): Promise<ReferenceLink[]>;
  linksForReference(referencePartId: string): Promise<ReferenceLink[]>;
  addLink(
    link: ReferenceLink & { snapshot: unknown; linkedBy: string | null },
  ): Promise<void>;
  removeLink(id: string): Promise<void>;
}

export interface MovementQuery {
  productId?: string;
  locationId?: string;
  referenceType?: string;
  referenceId?: string;
  type?: MovementType;
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
}
export interface BalanceQuery {
  productId?: string;
  locationId?: string;
  warehouseId?: string;
  onlyPositive?: boolean;
}
export interface InventoryRepository {
  balance(productId: string, locationId: string): Promise<StockBalance | null>;
  balances(query: BalanceQuery): Promise<StockBalance[]>;
  /** Applies signed deltas atomically. The database rejects results that
   * would make on-hand negative or reserved exceed on-hand. */
  applyDelta(
    productId: string,
    locationId: string,
    onHandDelta: number,
    reservedDelta: number,
  ): Promise<void>;
  insertMovement(
    m: StockMovement & { transferId?: string | null },
  ): Promise<void>;
  listMovements(q: MovementQuery): Promise<Page<StockMovement>>;
  insertReservation(r: Reservation): Promise<void>;
  activeReservations(
    referenceType: string,
    referenceId: string,
  ): Promise<Reservation[]>;
  closeReservation(
    id: string,
    status: "RELEASED" | "FULFILLED",
    closedAt: string,
  ): Promise<void>;
  /** Consumes `quantity` of an active reservation: the consumed part is
   * recorded as FULFILLED, any remainder stays as a new ACTIVE reservation
   * (so the sum of ACTIVE quantities always equals the reserved balance). */
  fulfillReservation(
    id: string,
    quantity: number,
    closedAt: string,
    newId: string,
  ): Promise<void>;
  reservationsFor(
    referenceType: string,
    referenceId: string,
  ): Promise<Reservation[]>;
  /** Recomputes on-hand from movements and reserved from reservations and
   * reports any balance row that disagrees. Empty means consistent. */
  verifyIntegrity(): Promise<
    {
      productId: string;
      locationId: string;
      field: "on_hand" | "reserved";
      stored: number;
      expected: number;
    }[]
  >;
}
