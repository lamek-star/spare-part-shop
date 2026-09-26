import type { Database } from "../../db/connection";
import type {
  Branch,
  Customer,
  Location,
  Page,
  Supplier,
  Warehouse,
} from "../../domain/types";
import type { MasterDataRepository, Paged } from "../../providers/data";
import { likeTerm, pageArgs } from "./util";

type Row = Record<string, unknown>;
const s = (v: unknown) => String(v ?? "");

const customer = (r: Row): Customer => ({
  id: s(r.id),
  code: s(r.code),
  name: s(r.name),
  contactPerson: s(r.contact_person),
  phone: s(r.phone),
  email: s(r.email),
  billingAddress: s(r.billing_address),
  shippingAddress: s(r.shipping_address),
  country: s(r.country),
  taxNumber: s(r.tax_number),
  currency: s(r.currency),
  paymentTerms: s(r.payment_terms),
  creditLimitMinor: Number(r.credit_limit_minor),
  notes: s(r.notes),
  status: r.status as Customer["status"],
  createdAt: s(r.created_at),
  updatedAt: s(r.updated_at),
});
const supplier = (r: Row): Supplier => ({
  id: s(r.id),
  code: s(r.code),
  name: s(r.name),
  contactPerson: s(r.contact_person),
  phone: s(r.phone),
  email: s(r.email),
  address: s(r.address),
  country: s(r.country),
  taxNumber: s(r.tax_number),
  currency: s(r.currency),
  paymentTerms: s(r.payment_terms),
  notes: s(r.notes),
  status: r.status as Supplier["status"],
  createdAt: s(r.created_at),
  updatedAt: s(r.updated_at),
});
const location = (r: Row): Location => ({
  id: s(r.id),
  warehouseId: s(r.warehouse_id),
  code: s(r.code),
  rack: s(r.rack),
  shelf: s(r.shelf),
  bin: s(r.bin),
  description: s(r.description),
});
const warehouse = (r: Row): Warehouse => ({
  id: s(r.id),
  code: s(r.code),
  name: s(r.name),
  branchId: (r.branch_id as string | null) ?? null,
  address: s(r.address),
  status: r.status as Warehouse["status"],
});

export class SqliteMasterDataRepository implements MasterDataRepository {
  constructor(private readonly db: Database) {}

  private async listParties<T>(
    table: "customers" | "suppliers",
    map: (r: Row) => T,
    query: Paged & { status?: string },
  ): Promise<Page<T>> {
    const { page, pageSize, offset } = pageArgs(query.page, query.pageSize);
    const where: string[] = [];
    const params: (string | number)[] = [];
    if (query.q?.trim()) {
      where.push(
        "(name LIKE ? ESCAPE '\\' OR code LIKE ? ESCAPE '\\' OR email LIKE ? ESCAPE '\\' OR phone LIKE ? ESCAPE '\\' OR contact_person LIKE ? ESCAPE '\\')",
      );
      const t = likeTerm(query.q);
      params.push(t, t, t, t, t);
    }
    if (query.status) (where.push("status = ?"), params.push(query.status));
    const clause = where.length ? "WHERE " + where.join(" AND ") : "";
    return this.db.read((h) => ({
      items: h
        .all<Row>(
          `SELECT * FROM ${table} ${clause} ORDER BY name COLLATE NOCASE LIMIT ? OFFSET ?`,
          [...params, pageSize, offset],
        )
        .map(map),
      total: h.count(`SELECT COUNT(*) AS n FROM ${table} ${clause}`, params),
      page,
      pageSize,
    }));
  }

  listCustomers(query: Paged & { status?: string }) {
    return this.listParties("customers", customer, query);
  }
  async getCustomer(id: string) {
    const r = await this.db.read((h) =>
      h.get<Row>("SELECT * FROM customers WHERE id = ?", [id]),
    );
    return r ? customer(r) : null;
  }
  async insertCustomer(c: Customer) {
    await this.db.write((h) =>
      h.run(
        `INSERT INTO customers(id,code,name,contact_person,phone,email,billing_address,shipping_address,country,tax_number,currency,payment_terms,credit_limit_minor,notes,status,created_at,updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          c.id,
          c.code,
          c.name,
          c.contactPerson,
          c.phone,
          c.email,
          c.billingAddress,
          c.shippingAddress,
          c.country,
          c.taxNumber,
          c.currency,
          c.paymentTerms,
          c.creditLimitMinor,
          c.notes,
          c.status,
          c.createdAt,
          c.updatedAt,
        ],
      ),
    );
  }
  async updateCustomer(c: Customer) {
    await this.db.write((h) =>
      h.run(
        `UPDATE customers SET name=?,contact_person=?,phone=?,email=?,billing_address=?,shipping_address=?,country=?,tax_number=?,currency=?,payment_terms=?,credit_limit_minor=?,notes=?,status=?,updated_at=? WHERE id=?`,
        [
          c.name,
          c.contactPerson,
          c.phone,
          c.email,
          c.billingAddress,
          c.shippingAddress,
          c.country,
          c.taxNumber,
          c.currency,
          c.paymentTerms,
          c.creditLimitMinor,
          c.notes,
          c.status,
          c.updatedAt,
          c.id,
        ],
      ),
    );
  }

  listSuppliers(query: Paged & { status?: string }) {
    return this.listParties("suppliers", supplier, query);
  }
  async getSupplier(id: string) {
    const r = await this.db.read((h) =>
      h.get<Row>("SELECT * FROM suppliers WHERE id = ?", [id]),
    );
    return r ? supplier(r) : null;
  }
  async insertSupplier(x: Supplier) {
    await this.db.write((h) =>
      h.run(
        `INSERT INTO suppliers(id,code,name,contact_person,phone,email,address,country,tax_number,currency,payment_terms,notes,status,created_at,updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          x.id,
          x.code,
          x.name,
          x.contactPerson,
          x.phone,
          x.email,
          x.address,
          x.country,
          x.taxNumber,
          x.currency,
          x.paymentTerms,
          x.notes,
          x.status,
          x.createdAt,
          x.updatedAt,
        ],
      ),
    );
  }
  async updateSupplier(x: Supplier) {
    await this.db.write((h) =>
      h.run(
        `UPDATE suppliers SET name=?,contact_person=?,phone=?,email=?,address=?,country=?,tax_number=?,currency=?,payment_terms=?,notes=?,status=?,updated_at=? WHERE id=?`,
        [
          x.name,
          x.contactPerson,
          x.phone,
          x.email,
          x.address,
          x.country,
          x.taxNumber,
          x.currency,
          x.paymentTerms,
          x.notes,
          x.status,
          x.updatedAt,
          x.id,
        ],
      ),
    );
  }

  listBranches(): Promise<Branch[]> {
    return this.db.read((h) =>
      h
        .all<Row>("SELECT * FROM branches ORDER BY name COLLATE NOCASE")
        .map((r) => ({
          id: s(r.id),
          name: s(r.name),
          address: s(r.address),
          status: r.status as Branch["status"],
        })),
    );
  }
  async saveBranch(b: Branch) {
    await this.db.write((h) =>
      h.run(
        `INSERT INTO branches(id,name,address,status) VALUES (?,?,?,?)
         ON CONFLICT(id) DO UPDATE SET name=excluded.name, address=excluded.address, status=excluded.status`,
        [b.id, b.name, b.address, b.status],
      ),
    );
  }

  listWarehouses(): Promise<Warehouse[]> {
    return this.db.read((h) =>
      h
        .all<Row>("SELECT * FROM warehouses ORDER BY name COLLATE NOCASE")
        .map(warehouse),
    );
  }
  async getWarehouse(id: string) {
    const r = await this.db.read((h) =>
      h.get<Row>("SELECT * FROM warehouses WHERE id = ?", [id]),
    );
    return r ? warehouse(r) : null;
  }
  async insertWarehouse(w: Warehouse) {
    await this.db.write((h) =>
      h.run(
        "INSERT INTO warehouses(id,code,name,branch_id,address,status) VALUES (?,?,?,?,?,?)",
        [w.id, w.code, w.name, w.branchId, w.address, w.status],
      ),
    );
  }
  async updateWarehouse(w: Warehouse) {
    await this.db.write((h) =>
      h.run(
        "UPDATE warehouses SET name=?, branch_id=?, address=?, status=? WHERE id=?",
        [w.name, w.branchId, w.address, w.status, w.id],
      ),
    );
  }
  listLocations(warehouseId?: string): Promise<Location[]> {
    return this.db.read((h) =>
      h
        .all<Row>(
          `SELECT * FROM locations ${warehouseId ? "WHERE warehouse_id = ?" : ""} ORDER BY warehouse_id, code`,
          warehouseId ? [warehouseId] : [],
        )
        .map(location),
    );
  }
  async getLocation(id: string) {
    const r = await this.db.read((h) =>
      h.get<Row>("SELECT * FROM locations WHERE id = ?", [id]),
    );
    return r ? location(r) : null;
  }
  async insertLocation(l: Location) {
    await this.db.write((h) =>
      h.run(
        "INSERT INTO locations(id,warehouse_id,code,rack,shelf,bin,description) VALUES (?,?,?,?,?,?,?)",
        [l.id, l.warehouseId, l.code, l.rack, l.shelf, l.bin, l.description],
      ),
    );
  }
  async updateLocation(l: Location) {
    await this.db.write((h) =>
      h.run(
        "UPDATE locations SET code=?, rack=?, shelf=?, bin=?, description=? WHERE id=?",
        [l.code, l.rack, l.shelf, l.bin, l.description, l.id],
      ),
    );
  }
}
