import { State, Part, PartNumber, normalizeNumber } from "../domain/models";
export function seed(): State {
  const names = [
    "Front brake pad set",
    "Oil filter cartridge",
    "Engine air filter",
    "Iridium spark plug",
    "Front brake disc",
    "Cabin air filter",
    "Water pump assembly",
    "Serpentine drive belt",
    "Front wheel bearing",
    "Rear shock absorber",
    "Thermostat assembly",
    "Fuel filter element",
  ];
  const brands = ["Aster", "Nori", "Vektor", "Motive"];
  const parts: Part[] = Array.from({ length: 48 }, (_, i) => ({
    id: `part-${i + 1}`,
    name: `${names[i % 12]}${i >= 12 ? ` · Series ${Math.floor(i / 12) + 1}` : ""}`,
    sku: `SP-${String(i + 1).padStart(5, "0")}`,
    brand: brands[Math.floor(i / 12)],
    manufacturer: `${brands[Math.floor(i / 12)]} Components`,
    category: [
      "Braking",
      "Filtration",
      "Filtration",
      "Ignition",
      "Braking",
      "Filtration",
      "Cooling",
      "Engine",
      "Suspension",
      "Suspension",
      "Cooling",
      "Filtration",
    ][i % 12],
    description:
      "Sample replacement component for demonstration. Confirm specifications and vehicle fitment with a verified supplier before use.",
    cost: 25 + ((i * 17) % 210),
    price: 45 + ((i * 23) % 340),
    currency: "AED",
    unit: "Set",
    weight: 0.5 + (i % 6),
    origin: ["Japan", "Germany", "Thailand"][i % 3],
    reorder: 12,
    minimum: 5,
    status: "Active",
    images: ["/part.svg"],
    notes:
      "Fictional catalogue record. All numbers and fitments are unverified demo data.",
  }));
  const numbers: PartNumber[] = parts.flatMap((p, i) =>
    [
      {
        id: `num-${i}-sku`,
        partId: p.id,
        display: p.sku,
        type: "INTERNAL_SKU" as const,
        primary: true,
      },
      {
        id: `num-${i}-oe`,
        partId: p.id,
        display: i === 0 ? "04465-0K290" : `DEMO-${44000 + i}-X${i % 8}`,
        type: "OEM_OE" as const,
        primary: true,
      },
      {
        id: `num-${i}-mpn`,
        partId: p.id,
        display: `${p.brand.slice(0, 3).toUpperCase()}-${1000 + i}`,
        type: "MANUFACTURER_MPN" as const,
        primary: false,
      },
      {
        id: `num-${i}-supplier`,
        partId: p.id,
        display: `SUP-${80000 + i}`,
        type: "SUPPLIER" as const,
        primary: false,
      },
    ].map((n) => ({
      ...n,
      normalized: normalizeNumber(n.display),
      supplierId: n.type === "SUPPLIER" ? `contact-${(i % 5) + 1}` : undefined,
      brand: p.brand,
      source: "Manual Entry · Sample dataset",
      market: "UAE demo",
      active: true,
      notes: "Not verified against any manufacturer catalogue.",
      verification: "Demo" as const,
    })),
  );
  parts.forEach((p, i) => {
    for (const type of [
      "AFTERMARKET",
      "CROSS_REFERENCE",
      "INTERCHANGE",
      "BARCODE_EAN_UPC_GTIN",
    ] as const) {
      const display =
        type === "BARCODE_EAN_UPC_GTIN"
          ? `DEMO-BARCODE-${90000 + i}`
          : `DEMO-${type.slice(0, 3)}-${5000 + i}`;
      numbers.push({
        id: `extra-${i}-${type}`,
        partId: p.id,
        display,
        normalized: normalizeNumber(display),
        type,
        brand: p.brand,
        source: "Imported CSV · Sample dataset",
        market: "UAE",
        active: true,
        primary: false,
        notes: "Illustrative number, not a verified interchange or barcode.",
        verification: "Demo",
      });
    }
  });
  numbers.push({
    ...numbers[1],
    id: "num-old",
    display: "DEMO-OLD-001",
    normalized: "DEMOOLD001",
    type: "PREVIOUS",
    primary: false,
    supersededBy: numbers[1].id,
  });
  const now = new Date();
  const date = (days: number) =>
    new Date(now.getTime() - days * 86400000).toISOString();
  const warehouses = [
    {
      id: "wh-1",
      name: "Main Warehouse",
      branch: "Sharjah",
      address: "Industrial district, demo address",
    },
    {
      id: "wh-2",
      name: "RAK Warehouse",
      branch: "Ras Al Khaimah",
      address: "Logistics district, demo address",
    },
    {
      id: "wh-3",
      name: "Dubai Branch",
      branch: "Dubai",
      address: "Trade district, demo address",
    },
    {
      id: "wh-4",
      name: "Retail Shop",
      branch: "Sharjah",
      address: "Retail district, demo address",
    },
  ];
  const vehicles = [
    {
      id: "v1",
      make: "Toyota",
      model: "Hilux",
      variant: "Sample 2.7",
      from: 2016,
      to: 2023,
      engine: "2.7 petrol",
      engineCode: "DEMO-2TR",
      transmission: "Automatic",
    },
    {
      id: "v2",
      make: "Nissan",
      model: "Patrol",
      variant: "Sample 4.0",
      from: 2015,
      to: 2022,
      engine: "4.0 petrol",
      engineCode: "DEMO-VQ",
      transmission: "Automatic",
    },
    {
      id: "v3",
      make: "Toyota",
      model: "Land Cruiser",
      variant: "Sample 4.0",
      from: 2018,
      to: 2024,
      engine: "4.0 petrol",
      engineCode: "DEMO-GR",
      transmission: "Automatic",
    },
  ];
  const contacts = Array.from({ length: 12 }, (_, i) => ({
    id: `contact-${i + 1}`,
    kind: i < 5 ? ("Supplier" as const) : ("Customer" as const),
    name: [
      "Atlas Components FZE",
      "Northline Auto Supply",
      "Cedar Parts Trading",
      "Vertex Distribution",
      "Seabrook Components",
      "Dune Fleet Services",
      "Harbour Auto Workshop",
      "Palm Road Garage",
      "Summit Motors",
      "Falcon Service Centre",
      "Orchard Auto Care",
      "Bluebay Transport",
    ][i],
    person: `Demo contact ${i + 1}`,
    country: "United Arab Emirates",
    phone: "+971 00 000 0000",
    email: `contact${i + 1}@example.com`,
    address: "Fictional business address, UAE",
    taxNumber: "DEMO-NOT-A-TRN",
    currency: "AED",
    terms: "Net 30",
    creditLimit: 25000,
    status: "Active",
    notes: "Fictional business for demonstration.",
  }));
  const orders: State["orders"] = Array.from({ length: 10 }, (_, i) => ({
    id: `order-${i + 1}`,
    number: `${i < 5 ? "PO" : "SO"}-2026-${String(1001 + i)}`,
    kind: i < 5 ? "Purchase" : "Sale",
    contactId: `contact-${i + 1}`,
    warehouseId: "wh-1",
    date: date(i),
    status: i < 5 ? "Confirmed" : "Invoiced",
    payment: i % 2 ? "Paid" : "Unpaid",
    invoiceNumber: i >= 5 ? `INV-2026-${1001 + i}` : undefined,
    lines: [
      {
        partId: parts[i].id,
        quantity: 3 + i,
        price: i < 5 ? parts[i].cost : parts[i].price,
        processed: i < 5 ? 0 : 3 + i,
        returned: 0,
        discount: 0,
      },
    ],
    taxRate: 5,
    notes: "Sample order",
  }));
  const branches = [
    {
      id: "branch-1",
      name: "Sharjah",
      address: "Industrial district, fictional address",
      status: "Active",
    },
    {
      id: "branch-2",
      name: "Ras Al Khaimah",
      address: "Logistics district, fictional address",
      status: "Active",
    },
    {
      id: "branch-3",
      name: "Dubai",
      address: "Trade district, fictional address",
      status: "Active",
    },
  ];
  const roles = [
    "Owner",
    "Administrator",
    "Manager",
    "Sales",
    "Storekeeper",
    "Purchasing",
  ].map((name, i) => ({
    id: `role-${i}`,
    name,
    permissions:
      i < 3
        ? [
            "catalogue.read",
            "inventory.write",
            "purchasing.write",
            "sales.write",
            "management.write",
          ]
        : name === "Sales"
          ? ["catalogue.read", "sales.write"]
          : name === "Storekeeper"
            ? ["catalogue.read", "inventory.write"]
            : ["catalogue.read", "purchasing.write"],
  }));
  const users = roles.map((r, i) => ({
    id: `user-${i}`,
    name: `Demo ${r.name}`,
    email: `${r.name.toLowerCase()}@example.com`,
    role: r.name,
    branchId: branches[i % 3].id,
    status: "Active",
  }));
  return {
    version: 1,
    branches,
    roles,
    users,
    parts,
    numbers,
    vehicles,
    compatibility: parts.flatMap((p, i) =>
      [0, 1].map((offset) => ({
        id: `fit-${i}-${offset}`,
        partId: p.id,
        vehicleId: vehicles[(i + offset) % 3].id,
        notes: "Illustrative fitment only; not verified.",
        source: "Demo dataset",
      })),
    ),
    warehouses,
    contacts,
    movements: [
      ...parts.flatMap((p, i) =>
        warehouses.map((w, j) => ({
          id: `open-${i}-${j}`,
          partId: p.id,
          warehouseId: w.id,
          quantity: i % 11 === 0 ? 0 : 8 + ((i * 7 + j * 11) % 65),
          type: "OPENING_BALANCE" as const,
          reference: "OPEN-2026",
          date: date(40),
          notes: "Demo opening stock",
        })),
      ),
      ...orders
        .filter((o) => o.kind === "Sale")
        .flatMap((o) =>
          o.lines.map((l) => ({
            id: `move-${o.id}`,
            partId: l.partId,
            warehouseId: o.warehouseId,
            quantity: -l.quantity,
            type: "SALE" as const,
            reference: o.number,
            date: o.date,
            notes: "Demo fulfillment",
          })),
        ),
    ],
    orders,
    documents: [
      {
        id: "doc-sample",
        name: "Sample-part-specification.txt",
        entityType: "Part",
        entityId: "part-1",
        mime: "text/plain",
        size: 62,
        url: "data:text/plain;charset=utf-8,Sample%20specification.%20Demo%20only%3B%20verify%20fitment%20before%20use.",
        date: date(0),
      },
    ],
    audit: [
      {
        id: "audit-seed",
        date: date(0),
        action: "Workspace initialized",
        detail: "Loaded 48 clearly labeled sample parts",
        actor: "Demo system",
      },
    ],
    settings: {
      company: "IntraForge Parts Trading",
      currency: "AED",
      taxRate: 5,
      address: "Sharjah, United Arab Emirates · Demo business",
    },
  };
}
