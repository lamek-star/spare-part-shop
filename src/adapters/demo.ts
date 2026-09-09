import { State, Order, Stock, normalizeNumber } from "../domain/models";
import { Services } from "../services/contracts";
import { seed } from "./seed";
export const uid = () => crypto.randomUUID();
const requireThat = (ok: unknown, message: string) => {
  if (!ok) throw new Error(message);
};
export function createDemoAdapter(
  initial: State = seed(),
  persist?: (s: State) => void,
): Services {
  const defaults = seed();
  let state = structuredClone({
    ...initial,
    branches: initial.branches ?? defaults.branches,
    users: initial.users ?? defaults.users,
    roles: initial.roles ?? defaults.roles,
  });
  const listeners = new Set<() => void>();
  const stock = (s: State): Stock[] =>
    s.parts.flatMap((p) =>
      s.warehouses.map((w, i) => {
        const onHand = s.movements
          .filter((m) => m.partId === p.id && m.warehouseId === w.id)
          .reduce((n, m) => n + m.quantity, 0);
        const reserved = s.orders
          .filter(
            (o) =>
              o.kind === "Sale" &&
              o.status === "Confirmed" &&
              o.warehouseId === w.id,
          )
          .flatMap((o) => o.lines)
          .filter((l) => l.partId === p.id)
          .reduce((n, l) => n + l.quantity, 0);
        return {
          partId: p.id,
          warehouseId: w.id,
          onHand,
          reserved,
          available: onHand - reserved,
          bin: `${String.fromCharCode(65 + i)}-${(p.sku.split("-").at(-1) ?? p.id).slice(-3).padStart(3, "0")}`,
        };
      }),
    );
  const commit = (
    action: string,
    detail: string,
    mutate: (s: State) => void,
  ) => {
    const draft = structuredClone(state);
    mutate(draft);
    draft.audit.unshift({
      id: uid(),
      date: new Date().toISOString(),
      action,
      detail,
      actor: "Demo operator",
    });
    persist?.(draft);
    state = draft;
    listeners.forEach((l) => l());
  };
  const order = (s: State, id: string, kind: Order["kind"]) => {
    const o = s.orders.find((o) => o.id === id && o.kind === kind);
    requireThat(o, "Order not found.");
    return o!;
  };
  const move = (
    s: State,
    partId: string,
    warehouseId: string,
    quantity: number,
    type: State["movements"][number]["type"],
    reference: string,
    notes = "",
  ) => {
    requireThat(
      s.parts.some((p) => p.id === partId) &&
        s.warehouses.some((w) => w.id === warehouseId),
      "Select a valid part and warehouse.",
    );
    s.movements.push({
      id: uid(),
      partId,
      warehouseId,
      quantity,
      type,
      reference,
      notes,
      date: new Date().toISOString(),
    });
  };
  const validateOrder = (s: State, o: Order) => {
    requireThat(
      !s.orders.some((x) => x.id === o.id || x.number === o.number),
      "Order already exists.",
    );
    requireThat(o.lines.length > 0, "Add at least one line.");
    requireThat(
      new Set(o.lines.map((l) => l.partId)).size === o.lines.length,
      "Combine duplicate parts into one line.",
    );
    requireThat(
      s.contacts.some(
        (c) =>
          c.id === o.contactId &&
          c.kind === (o.kind === "Purchase" ? "Supplier" : "Customer"),
      ),
      "Select a valid business contact.",
    );
    requireThat(
      s.warehouses.some((w) => w.id === o.warehouseId),
      "Select a warehouse.",
    );
    requireThat(
      Number.isFinite(o.taxRate) && o.taxRate >= 0 && o.taxRate <= 100,
      "Tax must be between 0 and 100.",
    );
    o.lines.forEach((l) =>
      requireThat(
        s.parts.some((p) => p.id === l.partId) &&
          Number.isInteger(l.quantity) &&
          l.quantity > 0 &&
          Number.isFinite(l.price) &&
          l.price >= 0 &&
          Number.isFinite(l.discount) &&
          l.discount >= 0 &&
          l.discount <= 100 &&
          l.processed === 0 &&
          l.returned === 0,
        "Each line needs a valid part, positive whole quantity, valid price and discount.",
      ),
    );
  };
  return {
    snapshot: () => state,
    subscribe: (l) => {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
    catalogue: {
      search: (q) => {
        const n = normalizeNumber(q);
        const matches = state.parts.filter(
          (p) =>
            `${p.name} ${p.brand} ${p.sku}`
              .toLowerCase()
              .includes(q.toLowerCase()) ||
            state.numbers.some(
              (x) => x.partId === p.id && x.normalized.includes(n),
            ),
        );
        const exactIds = new Set(
          state.numbers.filter((x) => x.normalized === n).map((x) => x.partId),
        );
        return matches.sort(
          (a, b) => Number(exactIds.has(b.id)) - Number(exactIds.has(a.id)),
        );
      },
      save: (p) =>
        commit("Part saved", p.sku, (s) => {
          requireThat(
            p.name.trim() && p.sku.trim(),
            "Name and SKU are required.",
          );
          requireThat(
            !s.parts.some((x) => x.sku === p.sku && x.id !== p.id),
            "SKU already exists.",
          );
          requireThat(
            [p.cost, p.price, p.reorder, p.minimum, p.weight].every(
              (x) => Number.isFinite(x) && x >= 0,
            ),
            "Prices, weight and stock thresholds must be nonnegative.",
          );
          const i = s.parts.findIndex((x) => x.id === p.id);
          if (i < 0) {
            s.parts.push(p);
            s.numbers.push({
              id: uid(),
              partId: p.id,
              display: p.sku,
              normalized: normalizeNumber(p.sku),
              type: "INTERNAL_SKU",
              brand: p.brand,
              source: "Manual Entry",
              market: "UAE",
              active: true,
              primary: true,
              notes: "Demo",
              verification: "Demo",
            });
          } else {
            requireThat(
              s.parts[i].sku === p.sku,
              "Internal SKU cannot be changed in this reference app.",
            );
            s.parts[i] = p;
          }
        }),
      addNumber: (n) =>
        commit("Part number added", n.display, (s) => {
          requireThat(
            n.display.trim() && s.parts.some((p) => p.id === n.partId),
            "A number and valid part are required.",
          );
          requireThat(
            !s.numbers.some((x) => x.id === n.id),
            "Number ID already exists.",
          );
          if (n.primary)
            s.numbers
              .filter((x) => x.partId === n.partId && x.type === n.type)
              .forEach((x) => (x.primary = false));
          s.numbers.push({ ...n, normalized: normalizeNumber(n.display) });
        }),
      supersede: (oldId, newId) =>
        commit("Supersession recorded", `${oldId} → ${newId}`, (s) => {
          const old = s.numbers.find((n) => n.id === oldId),
            next = s.numbers.find((n) => n.id === newId);
          requireThat(old && next, "Number not found.");
          let cursor = next;
          const seen = new Set([oldId]);
          while (cursor) {
            requireThat(
              !seen.has(cursor.id),
              "Circular supersession is not allowed.",
            );
            seen.add(cursor.id);
            cursor = s.numbers.find((n) => n.id === cursor!.supersededBy);
          }
          old!.supersededBy = newId;
          old!.active = false;
        }),
    },
    compatibility: {
      saveVehicle: (v) =>
        commit("Vehicle saved", v.model, (s) => {
          requireThat(
            v.make.trim() &&
              v.model.trim() &&
              Number.isInteger(v.from) &&
              Number.isInteger(v.to) &&
              v.from >= 1900 &&
              v.to >= v.from,
            "Enter a make, model and valid year range.",
          );
          const index = s.vehicles.findIndex((x) => x.id === v.id);
          if (index < 0) s.vehicles.push(v);
          else s.vehicles[index] = v;
        }),
      link: (c) =>
        commit("Compatibility linked", c.partId, (s) => {
          requireThat(
            s.parts.some((p) => p.id === c.partId) &&
              s.vehicles.some((v) => v.id === c.vehicleId),
            "Select a valid part and vehicle.",
          );
          requireThat(
            !s.compatibility.some(
              (x) => x.partId === c.partId && x.vehicleId === c.vehicleId,
            ),
            "This vehicle is already linked to the part.",
          );
          s.compatibility.push(c);
        }),
    },
    inventory: {
      list: () => stock(state),
      transfer: (partId, from, to, quantity, notes) =>
        commit("Stock transferred", notes, (s) => {
          requireThat(from !== to, "Choose different warehouses.");
          requireThat(
            Number.isInteger(quantity) && quantity > 0,
            "Quantity must be a positive whole number.",
          );
          requireThat(
            (stock(s).find((x) => x.partId === partId && x.warehouseId === from)
              ?.available ?? 0) >= quantity,
            "Insufficient available stock.",
          );
          const ref = `TR-${uid().slice(0, 8)}`;
          move(s, partId, from, -quantity, "TRANSFER_OUT", ref, notes);
          move(s, partId, to, quantity, "TRANSFER_IN", ref, notes);
        }),
      adjust: (partId, warehouseId, quantity, notes) =>
        commit("Stock adjusted", notes, (s) => {
          requireThat(
            Number.isInteger(quantity) && quantity !== 0 && notes.trim(),
            "Enter a nonzero whole quantity and a reason.",
          );
          requireThat(
            (stock(s).find(
              (x) => x.partId === partId && x.warehouseId === warehouseId,
            )?.available ?? 0) +
              quantity >=
              0,
            "Adjustment would consume reserved stock or create negative stock.",
          );
          move(
            s,
            partId,
            warehouseId,
            quantity,
            "ADJUSTMENT",
            `ADJ-${uid().slice(0, 8)}`,
            notes,
          );
        }),
    },
    purchasing: {
      create: (o) =>
        commit("Purchase drafted", o.number, (s) => {
          validateOrder(s, o);
          requireThat(
            o.kind === "Purchase" && o.status === "Draft",
            "New purchases must be drafts.",
          );
          s.orders.unshift(o);
        }),
      confirm: (id) =>
        commit("Purchase confirmed", id, (s) => {
          const o = order(s, id, "Purchase");
          requireThat(
            o.status === "Draft",
            "Only draft purchases can be confirmed.",
          );
          o.status = "Confirmed";
        }),
      receive: (id, quantities) =>
        commit("Goods received", id, (s) => {
          const o = order(s, id, "Purchase");
          requireThat(
            ["Confirmed", "Partially Received"].includes(o.status),
            "This purchase cannot receive goods.",
          );
          requireThat(
            quantities.length === o.lines.length &&
              quantities.some((q) => q > 0),
            "Enter received quantities.",
          );
          o.lines.forEach((l, i) =>
            requireThat(
              Number.isInteger(quantities[i]) &&
                quantities[i] >= 0 &&
                quantities[i] <= l.quantity - l.processed,
              "Receipt exceeds the remaining quantity.",
            ),
          );
          o.lines.forEach((l, i) => {
            if (quantities[i])
              move(
                s,
                l.partId,
                o.warehouseId,
                quantities[i],
                "PURCHASE_RECEIPT",
                o.number,
              );
            l.processed += quantities[i];
          });
          o.status = o.lines.every((l) => l.processed === l.quantity)
            ? "Received"
            : "Partially Received";
        }),
      close: (id) =>
        commit("Purchase closed", id, (s) => {
          const o = order(s, id, "Purchase");
          requireThat(
            o.status === "Received",
            "Receive all goods before closing.",
          );
          o.status = "Closed";
        }),
    },
    sales: {
      create: (o) =>
        commit("Sale drafted", o.number, (s) => {
          validateOrder(s, o);
          requireThat(
            o.kind === "Sale" && ["Draft", "Quotation"].includes(o.status),
            "New sales must be drafts or quotations.",
          );
          s.orders.unshift(o);
        }),
      confirm: (id) =>
        commit("Sale confirmed", id, (s) => {
          const o = order(s, id, "Sale");
          requireThat(
            ["Draft", "Quotation"].includes(o.status),
            "This sale cannot be confirmed.",
          );
          o.lines.forEach((l) =>
            requireThat(
              (stock(s).find(
                (x) => x.partId === l.partId && x.warehouseId === o.warehouseId,
              )?.available ?? 0) >= l.quantity,
              "Insufficient available stock. Receive goods or select another warehouse.",
            ),
          );
          o.status = "Confirmed";
        }),
      fulfill: (id) =>
        commit("Sale fulfilled", id, (s) => {
          const o = order(s, id, "Sale");
          requireThat(
            o.status === "Confirmed",
            "Confirm the sale before fulfillment.",
          );
          o.lines.forEach((l) => {
            requireThat(
              (stock(s).find(
                (x) => x.partId === l.partId && x.warehouseId === o.warehouseId,
              )?.onHand ?? 0) >= l.quantity,
              "Insufficient on-hand stock.",
            );
            move(s, l.partId, o.warehouseId, -l.quantity, "SALE", o.number);
            l.processed = l.quantity;
          });
          o.status = "Fulfilled";
        }),
      invoice: (id) =>
        commit("Invoice issued", id, (s) => {
          const o = order(s, id, "Sale");
          requireThat(
            o.status === "Fulfilled",
            "Fulfill the sale before invoicing.",
          );
          o.status = "Invoiced";
          o.invoiceNumber = `INV-${o.number}`;
        }),
      pay: (id) =>
        commit("Payment recorded", id, (s) => {
          const o = order(s, id, "Sale");
          requireThat(
            o.status === "Invoiced" && o.payment === "Unpaid",
            "Only unpaid invoices can be paid.",
          );
          o.payment = "Paid";
        }),
      returnItems: (id, quantities) =>
        commit("Customer return received", id, (s) => {
          const o = order(s, id, "Sale");
          requireThat(
            ["Fulfilled", "Invoiced"].includes(o.status),
            "Only fulfilled sales can be returned.",
          );
          requireThat(
            quantities.length === o.lines.length &&
              quantities.some((q) => q > 0),
            "Enter return quantities.",
          );
          o.lines.forEach((l, i) =>
            requireThat(
              Number.isInteger(quantities[i]) &&
                quantities[i] >= 0 &&
                quantities[i] <= l.processed - l.returned,
              "Return exceeds delivered quantity.",
            ),
          );
          o.lines.forEach((l, i) => {
            if (quantities[i])
              move(
                s,
                l.partId,
                o.warehouseId,
                quantities[i],
                "RETURN_IN",
                o.number,
                "Stock return only; credit settlement handled separately",
              );
            l.returned += quantities[i];
          });
        }),
    },
    contacts: {
      save: (c) =>
        commit(`${c.kind} saved`, c.name, (s) => {
          requireThat(
            c.name.trim() && c.email.includes("@"),
            "Company name and valid email are required.",
          );
          requireThat(
            Number.isFinite(c.creditLimit) && c.creditLimit >= 0,
            "Credit limit must be nonnegative.",
          );
          const i = s.contacts.findIndex((x) => x.id === c.id);
          if (i < 0) s.contacts.push(c);
          else s.contacts[i] = c;
        }),
    },
    documents: {
      add: (d) =>
        commit("Document attached", d.name, (s) => {
          requireThat(
            d.name && d.url.startsWith("data:") && d.size <= 2_000_000,
            "Use a local document smaller than 2 MB.",
          );
          s.documents.push(d);
        }),
      remove: (id) =>
        commit("Document removed", id, (s) => {
          s.documents = s.documents.filter((d) => d.id !== id);
        }),
    },
    management: {
      saveBranch: (b) =>
        commit("Branch saved", b.name, (s) => {
          requireThat(b.name.trim(), "Branch name is required.");
          const i = s.branches.findIndex((x) => x.id === b.id);
          requireThat(
            !s.branches.some((x) => x.id !== b.id && x.name === b.name),
            "Branch name already exists.",
          );
          if (i < 0) s.branches.push(b);
          else {
            const previous = s.branches[i].name;
            s.branches[i] = b;
            s.warehouses
              .filter((w) => w.branch === previous)
              .forEach((w) => (w.branch = b.name));
          }
        }),
      saveWarehouse: (w) =>
        commit("Warehouse saved", w.name, (s) => {
          requireThat(
            w.name.trim() && s.branches.some((b) => b.name === w.branch),
            "Name and valid branch are required.",
          );
          const i = s.warehouses.findIndex((x) => x.id === w.id);
          if (i < 0) s.warehouses.push(w);
          else s.warehouses[i] = w;
        }),
      saveUser: (u) =>
        commit("Demo user saved", u.name, (s) => {
          requireThat(
            u.name.trim() &&
              u.email.includes("@") &&
              s.roles.some((r) => r.name === u.role) &&
              s.branches.some((b) => b.id === u.branchId),
            "Enter a name, email, role and branch.",
          );
          requireThat(
            !s.users.some(
              (x) =>
                x.id !== u.id &&
                x.email.toLowerCase() === u.email.toLowerCase(),
            ),
            "Email already exists.",
          );
          const i = s.users.findIndex((x) => x.id === u.id);
          if (i < 0) s.users.push(u);
          else s.users[i] = u;
        }),
      saveRole: (r) =>
        commit("Role design saved", r.name, (s) => {
          requireThat(r.name.trim(), "Role name is required.");
          const i = s.roles.findIndex((x) => x.id === r.id);
          requireThat(
            !s.roles.some((x) => x.id !== r.id && x.name === r.name),
            "Role name already exists.",
          );
          if (i < 0) s.roles.push(r);
          else {
            const previous = s.roles[i].name;
            s.roles[i] = r;
            s.users
              .filter((u) => u.role === previous)
              .forEach((u) => (u.role = r.name));
          }
        }),
      saveSettings: (settings) =>
        commit("Settings updated", settings.company, (s) => {
          requireThat(
            settings.company.trim() &&
              settings.currency === "AED" &&
              Number.isFinite(settings.taxRate) &&
              settings.taxRate >= 0 &&
              settings.taxRate <= 100,
            "Enter a company name and tax between 0 and 100. Demo currency is AED.",
          );
          s.settings = settings;
        }),
    },
  };
}
export function browserAdapter(): Services {
  const key = "intraforge-spareparts-v1";
  let initial: State | undefined;
  const raw = localStorage.getItem(key);
  if (raw) {
    const parsed = JSON.parse(raw) as State;
    if (
      parsed.version !== 1 ||
      !Array.isArray(parsed.parts) ||
      !Array.isArray(parsed.movements)
    )
      throw new Error(
        "Saved demo data is incompatible. Clear this site’s local storage to reload sample data.",
      );
    initial = parsed;
  }
  return createDemoAdapter(initial, (s) =>
    localStorage.setItem(key, JSON.stringify(s)),
  );
}
