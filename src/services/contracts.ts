import {
  State,
  Part,
  PartNumber,
  Stock,
  Order,
  Contact,
  Attachment,
  Settings,
  Compatibility,
  Vehicle,
  Branch,
  DemoUser,
  Role,
  Warehouse,
  Enquiry,
  EnquiryItem,
} from "../domain/models";
export type CommandResult = void | Promise<void>;
export interface Services {
  snapshot(): State;
  subscribe(listener: () => void): () => void;
  catalogue: {
    adopt(
      reference: import("../catalogue/models").ReferenceDetail,
      values: {
        sku: string;
        supplierId: string;
        cost: number;
        price: number;
        warehouseId: string;
        reorder: number;
        currency: string;
      },
    ): CommandResult;
    search(query: string): Part[];
    save(part: Part): CommandResult;
    addNumber(number: PartNumber): CommandResult;
    supersede(oldId: string, newId: string): CommandResult;
  };
  compatibility: {
    saveVehicle(vehicle: Vehicle): CommandResult;
    link(record: Compatibility): CommandResult;
  };
  inventory: {
    list(): Stock[];
    transfer(
      partId: string,
      from: string,
      to: string,
      quantity: number,
      notes: string,
    ): CommandResult;
    adjust(
      partId: string,
      warehouseId: string,
      quantity: number,
      notes: string,
    ): CommandResult;
  };
  purchasing: {
    create(order: Order): CommandResult;
    confirm(id: string): CommandResult;
    receive(id: string, quantities: number[]): CommandResult;
    close(id: string): CommandResult;
    cancel(id: string): CommandResult;
  };
  sales: {
    create(order: Order): CommandResult;
    confirm(id: string): CommandResult;
    fulfill(id: string): CommandResult;
    invoice(id: string): CommandResult;
    pay(id: string): CommandResult;
    returnItems(id: string, quantities: number[]): CommandResult;
    cancel(id: string): CommandResult;
  };
  contacts: { save(contact: Contact): CommandResult };
  documents: {
    add(file: Attachment): CommandResult;
    remove(id: string): CommandResult;
  };
  management: {
    saveBranch(branch: Branch): CommandResult;
    saveUser(user: DemoUser): CommandResult;
    saveRole(role: Role): CommandResult;
    saveWarehouse(warehouse: Warehouse): CommandResult;
    saveSettings(settings: Settings): CommandResult;
  };
  /** Reference/enquiry "quote request" cart — deliberately separate from
   * `purchasing`/`sales`, since an enquiry is a request for a quote on
   * parts (typically from an EPC provider with no price data), not yet a
   * priced order against stock. See domain/models.ts `Enquiry`. */
  enquiries: {
    list(): Enquiry[];
    /** The current draft enquiry (the "cart"). Never throws — returns an
     * empty, unsaved placeholder when nothing has been added yet. */
    current(): Enquiry;
    addItem(item: Omit<EnquiryItem, "id" | "addedAt">): CommandResult;
    removeItem(itemId: string): CommandResult;
    submit(contact: {
      name: string;
      email: string;
      phone: string;
      vin: string;
      notes: string;
    }): CommandResult;
  };
}
