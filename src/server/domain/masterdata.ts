import type { UnitOfWork } from "../providers/uow";
import type {
  Actor,
  Branch,
  Customer,
  CustomerInput,
  Location,
  Page,
  Supplier,
  SupplierInput,
  Warehouse,
} from "./types";
import type { Paged } from "../providers/data";
import { conflict, notFound } from "../kernel/errors";
import { newId, nowIso } from "../kernel/ids";
import { requirePermission } from "./permissions";
import {
  currency,
  moneyMinor,
  oneOf,
  optionalEmail,
  record,
  text,
} from "./validate";

const status = ["ACTIVE", "INACTIVE"] as const;

function partyFields(input: Record<string, unknown>) {
  return {
    name: text(input.name, "Name", { required: true, max: 200 }),
    contactPerson: text(input.contactPerson, "Contact person", { max: 200 }),
    phone: text(input.phone, "Phone", { max: 60 }),
    email: optionalEmail(input.email),
    country: text(input.country, "Country", { max: 100 }),
    taxNumber: text(input.taxNumber, "Tax number", { max: 60 }),
    currency: currency(input.currency),
    paymentTerms: text(input.paymentTerms, "Payment terms", { max: 200 }),
    notes: text(input.notes, "Notes", { max: 2000 }),
    status: oneOf(input.status, status, "Status", "ACTIVE"),
  };
}

export class MasterDataService {
  constructor(private readonly uow: UnitOfWork) {}

  // ---------------- customers ----------------
  async listCustomers(
    actor: Actor,
    q: Paged & { status?: string },
  ): Promise<Page<Customer>> {
    requirePermission(actor, "customers.read");
    return this.uow.read((r) => r.masterData.listCustomers(q));
  }
  async getCustomer(actor: Actor, id: string): Promise<Customer> {
    requirePermission(actor, "customers.read");
    const c = await this.uow.read((r) => r.masterData.getCustomer(id));
    if (!c) throw notFound("Customer");
    return c;
  }
  async createCustomer(actor: Actor, raw: unknown): Promise<Customer> {
    requirePermission(actor, "customers.write");
    const input = record(raw) as CustomerInput;
    const f = partyFields(input);
    return this.uow.write(async (r) => {
      const now = nowIso();
      const customer: Customer = {
        id: newId(),
        code: await r.config.nextCode("customer", "CUS"),
        ...f,
        billingAddress: text(input.billingAddress, "Billing address", {
          max: 500,
        }),
        shippingAddress: text(input.shippingAddress, "Shipping address", {
          max: 500,
        }),
        creditLimitMinor: moneyMinor(input.creditLimitMinor, "Credit limit", {
          default: 0,
        }),
        createdAt: now,
        updatedAt: now,
      };
      await r.masterData.insertCustomer(customer);
      await r.audit.record(actor, {
        action: "customer.create",
        entityType: "customer",
        entityId: customer.id,
        summary: `Customer ${customer.code} ${customer.name} created`,
      });
      return customer;
    });
  }
  async updateCustomer(
    actor: Actor,
    id: string,
    raw: unknown,
  ): Promise<Customer> {
    requirePermission(actor, "customers.write");
    const input = record(raw) as CustomerInput;
    return this.uow.write(async (r) => {
      const current = await r.masterData.getCustomer(id);
      if (!current) throw notFound("Customer");
      const merged = { ...current, ...input } as Record<string, unknown>;
      const f = partyFields(merged);
      const next: Customer = {
        ...current,
        ...f,
        billingAddress: text(merged.billingAddress, "Billing address", {
          max: 500,
        }),
        shippingAddress: text(merged.shippingAddress, "Shipping address", {
          max: 500,
        }),
        creditLimitMinor: moneyMinor(merged.creditLimitMinor, "Credit limit"),
        updatedAt: nowIso(),
      };
      await r.masterData.updateCustomer(next);
      await r.audit.record(actor, {
        action: "customer.update",
        entityType: "customer",
        entityId: id,
        summary: `Customer ${next.code} updated`,
      });
      return next;
    });
  }

  // ---------------- suppliers ----------------
  async listSuppliers(
    actor: Actor,
    q: Paged & { status?: string },
  ): Promise<Page<Supplier>> {
    requirePermission(actor, "suppliers.read");
    return this.uow.read((r) => r.masterData.listSuppliers(q));
  }
  async getSupplier(actor: Actor, id: string): Promise<Supplier> {
    requirePermission(actor, "suppliers.read");
    const s = await this.uow.read((r) => r.masterData.getSupplier(id));
    if (!s) throw notFound("Supplier");
    return s;
  }
  async createSupplier(actor: Actor, raw: unknown): Promise<Supplier> {
    requirePermission(actor, "suppliers.write");
    const input = record(raw) as SupplierInput;
    const f = partyFields(input);
    return this.uow.write(async (r) => {
      const now = nowIso();
      const supplier: Supplier = {
        id: newId(),
        code: await r.config.nextCode("supplier", "SUP"),
        ...f,
        address: text(input.address, "Address", { max: 500 }),
        createdAt: now,
        updatedAt: now,
      };
      await r.masterData.insertSupplier(supplier);
      await r.audit.record(actor, {
        action: "supplier.create",
        entityType: "supplier",
        entityId: supplier.id,
        summary: `Supplier ${supplier.code} ${supplier.name} created`,
      });
      return supplier;
    });
  }
  async updateSupplier(
    actor: Actor,
    id: string,
    raw: unknown,
  ): Promise<Supplier> {
    requirePermission(actor, "suppliers.write");
    const input = record(raw) as SupplierInput;
    return this.uow.write(async (r) => {
      const current = await r.masterData.getSupplier(id);
      if (!current) throw notFound("Supplier");
      const merged = { ...current, ...input } as Record<string, unknown>;
      const next: Supplier = {
        ...current,
        ...partyFields(merged),
        address: text(merged.address, "Address", { max: 500 }),
        updatedAt: nowIso(),
      };
      await r.masterData.updateSupplier(next);
      await r.audit.record(actor, {
        action: "supplier.update",
        entityType: "supplier",
        entityId: id,
        summary: `Supplier ${next.code} updated`,
      });
      return next;
    });
  }

  // ---------------- branches, warehouses, locations ----------------
  async listBranches(actor: Actor): Promise<Branch[]> {
    requirePermission(actor, "settings.read");
    return this.uow.read((r) => r.masterData.listBranches());
  }
  async saveBranch(actor: Actor, raw: unknown): Promise<Branch> {
    requirePermission(actor, "settings.manage");
    const input = record(raw);
    const branch: Branch = {
      id: typeof input.id === "string" && input.id ? input.id : newId(),
      name: text(input.name, "Branch name", { required: true, max: 120 }),
      address: text(input.address, "Address", { max: 500 }),
      status: oneOf(input.status, status, "Status", "ACTIVE"),
    };
    return this.uow.write(async (r) => {
      await r.masterData.saveBranch(branch);
      await r.audit.record(actor, {
        action: "branch.save",
        entityType: "branch",
        entityId: branch.id,
        summary: `Branch ${branch.name} saved`,
      });
      return branch;
    });
  }
  async listWarehouses(
    actor: Actor,
  ): Promise<{ warehouses: Warehouse[]; locations: Location[] }> {
    requirePermission(actor, "inventory.read");
    return this.uow.read(async (r) => ({
      warehouses: await r.masterData.listWarehouses(),
      locations: await r.masterData.listLocations(),
    }));
  }
  async createWarehouse(actor: Actor, raw: unknown): Promise<Warehouse> {
    requirePermission(actor, "warehouses.write");
    const input = record(raw);
    const name = text(input.name, "Warehouse name", {
      required: true,
      max: 120,
    });
    const branchId =
      typeof input.branchId === "string" && input.branchId
        ? input.branchId
        : null;
    return this.uow.write(async (r) => {
      const warehouse: Warehouse = {
        id: newId(),
        code: await r.config.nextCode("warehouse", "WH"),
        name,
        branchId,
        address: text(input.address, "Address", { max: 500 }),
        status: "ACTIVE",
      };
      await r.masterData.insertWarehouse(warehouse);
      // Every warehouse has a default location so stock always has a place.
      await r.masterData.insertLocation({
        id: newId(),
        warehouseId: warehouse.id,
        code: "MAIN",
        rack: "",
        shelf: "",
        bin: "",
        description: "Default location",
      });
      await r.audit.record(actor, {
        action: "warehouse.create",
        entityType: "warehouse",
        entityId: warehouse.id,
        summary: `Warehouse ${warehouse.code} ${name} created`,
      });
      return warehouse;
    });
  }
  async updateWarehouse(
    actor: Actor,
    id: string,
    raw: unknown,
  ): Promise<Warehouse> {
    requirePermission(actor, "warehouses.write");
    const input = record(raw);
    return this.uow.write(async (r) => {
      const current = await r.masterData.getWarehouse(id);
      if (!current) throw notFound("Warehouse");
      const next: Warehouse = {
        ...current,
        name: text(input.name ?? current.name, "Warehouse name", {
          required: true,
          max: 120,
        }),
        address: text(input.address ?? current.address, "Address", {
          max: 500,
        }),
        status: oneOf(input.status, status, "Status", current.status),
        branchId:
          input.branchId === undefined
            ? current.branchId
            : typeof input.branchId === "string" && input.branchId
              ? input.branchId
              : null,
      };
      await r.masterData.updateWarehouse(next);
      await r.audit.record(actor, {
        action: "warehouse.update",
        entityType: "warehouse",
        entityId: id,
        summary: `Warehouse ${next.code} updated`,
      });
      return next;
    });
  }
  async createLocation(
    actor: Actor,
    warehouseId: string,
    raw: unknown,
  ): Promise<Location> {
    requirePermission(actor, "warehouses.write");
    const input = record(raw);
    const rack = text(input.rack, "Rack", { max: 40 });
    const shelf = text(input.shelf, "Shelf", { max: 40 });
    const bin = text(input.bin, "Bin", { max: 40 });
    const code =
      text(input.code, "Code", { max: 60 }) ||
      [rack, shelf, bin].filter(Boolean).join("-");
    if (!code)
      throw conflict(
        "Give the location a code, or a rack, shelf or bin.",
        "VALIDATION",
      );
    return this.uow.write(async (r) => {
      if (!(await r.masterData.getWarehouse(warehouseId)))
        throw notFound("Warehouse");
      const existing = (await r.masterData.listLocations(warehouseId)).find(
        (l) => l.code.toLowerCase() === code.toLowerCase(),
      );
      if (existing)
        throw conflict(`Location ${code} already exists in this warehouse.`);
      const location: Location = {
        id: newId(),
        warehouseId,
        code,
        rack,
        shelf,
        bin,
        description: text(input.description, "Description", { max: 200 }),
      };
      await r.masterData.insertLocation(location);
      await r.audit.record(actor, {
        action: "location.create",
        entityType: "location",
        entityId: location.id,
        summary: `Location ${code} added`,
      });
      return location;
    });
  }
}
