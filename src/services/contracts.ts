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
  };
  sales: {
    create(order: Order): CommandResult;
    confirm(id: string): CommandResult;
    fulfill(id: string): CommandResult;
    invoice(id: string): CommandResult;
    pay(id: string): CommandResult;
    returnItems(id: string, quantities: number[]): CommandResult;
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
}
