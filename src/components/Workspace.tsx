"use client";
import {
  useEffect,
  useState,
  useSyncExternalStore,
  useMemo,
  ReactNode,
} from "react";
import {
  LayoutDashboard,
  Package,
  Warehouse,
  ShoppingCart,
  Users,
  BarChart3,
  Files,
  Settings,
  Search,
  PanelLeftClose,
  ChevronRight,
  Plus,
  ArrowUpRight,
  LogOut,
  Box,
  ArrowRightLeft,
  Download,
} from "lucide-react";
import { browserAdapter, uid } from "../adapters/demo";
import { Services } from "../services/contracts";
import { Part, Order, money, totals } from "../domain/models";
import { Badge, Table, Modal, Field } from "./ui";
import Forms from "./Forms";
import ContactDetails from "./ContactDetails";
import Management from "./Management";
import Dashboard from "./Dashboard";
import CatalogueSource from "./CatalogueSource";
import { SupersessionForm, CompatibilityForm, Gallery } from "./CatalogueTools";
import ReferenceCatalogue from "./ReferenceCatalogue";
import OEMPartSearch from "./OEMPartSearch";
import CatalogueAdmin from "./CatalogueAdmin";
import CatalogueImportAdmin from "./CatalogueImportAdmin";
import { CatalogueClient } from "../catalogue/client";
import { ReferenceHit, isCatalogueAdmin } from "../catalogue/models";
import { AuthControls } from "./AuthControls";
const groups = [
  { name: "Dashboard", icon: LayoutDashboard, items: [] },
  {
    name: "Catalogue",
    icon: Package,
    items: [
      "Reference Catalogue",
      "Import / Warm Up",
      "Parts",
      "Part Numbers",
      "Cross References",
      "Brands",
      "Categories",
      "Vehicle Compatibility",
    ],
  },
  {
    name: "Inventory",
    icon: Warehouse,
    items: ["Stock", "Warehouses", "Transfers", "Adjustments", "Low Stock"],
  },
  {
    name: "Purchasing",
    icon: ShoppingCart,
    items: ["Suppliers", "Purchase Orders", "Goods Receiving"],
  },
  {
    name: "Sales",
    icon: Users,
    items: ["Customers", "Quotations", "Sales Orders", "Invoices", "Returns"],
  },
  { name: "Catalogue Administration", icon: Settings, items: [] },
  { name: "Reports", icon: BarChart3, items: [] },
  { name: "Documents", icon: Files, items: [] },
  {
    name: "Management",
    icon: Settings,
    items: ["Branches", "Users", "Roles", "Settings", "Audit Log"],
  },
];
const date = (s: string) =>
  new Date(s).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
export default function Workspace() {
  const [services, setServices] = useState<Services>();
  const [error, setError] = useState("");
  useEffect(() => {
    try {
      setServices(browserAdapter());
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  if (error)
    return (
      <main className="boot">
        <h1>Unable to load demo data</h1>
        <p role="alert">{error}</p>
        <button onClick={() => location.reload()}>Retry</button>
      </main>
    );
  return services ? (
    <App services={services} />
  ) : (
    <main className="boot" role="status">
      Loading your parts workspace…
    </main>
  );
}
function App({ services }: { services: Services }) {
  const s = useSyncExternalStore(
    services.subscribe,
    services.snapshot,
    services.snapshot,
  );
  const [logged, setLogged] = useState(false);
  const [persona, setPersona] = useState("Owner");
  const [page, setPage] = useState("Dashboard");
  const [group, setGroup] = useState("Catalogue");
  const [collapsed, setCollapsed] = useState(false);
  const [query, setQuery] = useState("");
  const [referenceId, setReferenceId] = useState("");
  const [referenceHits, setReferenceHits] = useState<ReferenceHit[]>([]);
  const referenceClient = useMemo(
    () => new CatalogueClient(persona),
    [persona],
  );
  useEffect(() => {
    let live = true;
    const timer = setTimeout(() => {
      if (query.trim().length >= 2)
        referenceClient
          .searchParts(query, 1)
          .then((r) => {
            if (live) setReferenceHits(r.items.slice(0, 5));
          })
          .catch(() => {
            if (live) setReferenceHits([]);
          });
      else setReferenceHits([]);
    }, 200);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [query, referenceClient]);
  const openReference = (id: string) => {
    setReferenceId(id);
    setPartId("");
    setOrderId("");
    setQuery("");
    setPage("Reference Catalogue");
  };
  const [filter, setFilter] = useState("All");
  const [partId, setPartId] = useState("");
  const [tab, setTab] = useState("Overview");
  const [orderId, setOrderId] = useState("");
  const [modal, setModal] = useState("");
  const [confirmRemoveDoc, setConfirmRemoveDoc] = useState("");
  const [contactId, setContactId] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [report, setReport] = useState("Inventory Valuation");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const stock = services.inventory.list();
  const part = s.parts.find((p) => p.id === partId);
  const order = s.orders.find((o) => o.id === orderId);
  const available = (id: string) =>
    stock.filter((x) => x.partId === id).reduce((n, x) => n + x.available, 0);
  const status = (p: Part) =>
    available(p.id) <= 0
      ? "Out of stock"
      : available(p.id) < p.reorder
        ? "Low stock"
        : "In stock";
  const navigate = (p: string) => {
    setPage(p);
    setReferenceId("");
    setPartId("");
    setOrderId("");
    setQuery("");
    setFilter("All");
    setError("");
    history.replaceState(null, "", `#${p.toLowerCase().replaceAll(" ", "-")}`);
  };
  const openPart = (id: string) => {
    setPartId(id);
    setOrderId("");
    setPage("Parts");
    setTab("Overview");
    setQuery("");
  };
  const run = async (fn: () => void | Promise<void>) => {
    try {
      await fn();
      setError("");
      setMessage("Changes saved to this demo workspace.");
    } catch (e) {
      setError((e as Error).message);
    }
  };
  useEffect(() => {
    const hash = decodeURIComponent(location.hash.slice(1)).replaceAll(
      "-",
      " ",
    );
    const pages = groups.flatMap((g) => [g.name, ...g.items]);
    const match = pages.find((p) => p.toLowerCase() === hash);
    if (match) setPage(match);
    setLogged(sessionStorage.getItem("parts-demo-session") === "yes");
    const savedPersona = sessionStorage.getItem("parts-demo-persona");
    if (
      savedPersona &&
      [
        "Owner",
        "Administrator",
        "Manager",
        "Sales",
        "Storekeeper",
        "Purchasing",
      ].includes(savedPersona)
    )
      setPersona(savedPersona);
  }, []);
  useEffect(() => {
    if (message) {
      const t = setTimeout(() => setMessage(""), 4000);
      return () => clearTimeout(t);
    }
  }, [message]);
  const partLink = (id: string) => {
    const p = s.parts.find((p) => p.id === id);
    return (
      <button className="text-link" onClick={() => openPart(id)}>
        {p?.name ?? "Unknown part"}
        <small>{p?.sku}</small>
      </button>
    );
  };
  const contactName = (id: string) =>
    s.contacts.find((c) => c.id === id)?.name ?? "Unknown contact";
  const whName = (id: string) => s.warehouses.find((w) => w.id === id)?.name;
  const ordersTable = (orders: Order[]) => (
    <Table
      headers={[
        "Reference",
        "Business",
        "Date",
        "Status",
        "Payment",
        "Total",
        "",
      ]}
      rows={orders.map((o) => [
        <button
          className="text-link"
          onClick={() => {
            setOrderId(o.id);
            setPartId("");
          }}
        >
          {o.number}
        </button>,
        contactName(o.contactId),
        date(o.date),
        <Badge>{o.status}</Badge>,
        o.kind === "Sale" ? <Badge>{o.payment}</Badge> : "—",
        money(totals(o).total),
        <button
          aria-label={`Open ${o.number}`}
          onClick={() => {
            setOrderId(o.id);
            setPartId("");
          }}
        >
          <ChevronRight size={15} />
        </button>,
      ])}
    />
  );
  const stockTable = (onlyPart?: string, low = false) => (
    <Table
      headers={[
        "Part",
        "Warehouse",
        "Bin",
        "On hand",
        "Reserved",
        "Available",
        "Status",
      ]}
      rows={stock
        .filter(
          (x) =>
            (!onlyPart || x.partId === onlyPart) &&
            (!low ||
              x.available < s.parts.find((p) => p.id === x.partId)!.reorder) &&
            (filter === "All" || x.warehouseId === filter) &&
            (!query ||
              s.parts
                .find((p) => p.id === x.partId)!
                .name.toLowerCase()
                .includes(query.toLowerCase())),
        )
        .map((x) => [
          partLink(x.partId),
          whName(x.warehouseId),
          x.bin,
          x.onHand,
          x.reserved,
          <strong>{x.available}</strong>,
          <Badge>
            {x.available <= 0
              ? "Out of stock"
              : x.available < s.parts.find((p) => p.id === x.partId)!.reorder
                ? "Low stock"
                : "In stock"}
          </Badge>,
        ])}
    />
  );
  const numberTable = (id?: string, expandReferences = false) => (
    <Table
      headers={[
        "Original number",
        "Type",
        "Brand",
        "Source / market",
        "Verification",
        "Primary",
        "Superseded by",
      ]}
      rows={s.numbers
        .filter(
          (n) =>
            (!id || n.partId === id) &&
            (!query ||
              (expandReferences
                ? services.catalogue
                    .search(query)
                    .some((p) => p.id === n.partId)
                : n.normalized.includes(
                    query.toUpperCase().replace(/[\s-]/g, ""),
                  ))),
        )
        .map((n) => [
          <button className="text-link" onClick={() => openPart(n.partId)}>
            {n.display}
            <small>{n.normalized}</small>
          </button>,
          n.type.replaceAll("_", " "),
          n.brand,
          <>
            {n.source}
            <small>{n.market}</small>
          </>,
          <Badge>{n.verification}</Badge>,
          n.primary ? "Yes" : "—",
          s.numbers.find((x) => x.id === n.supersededBy)?.display ?? "—",
        ])}
    />
  );
  const movementTable = (id?: string) => (
    <Table
      headers={[
        "Date",
        "Part",
        "Warehouse",
        "Movement",
        "Quantity",
        "Reference",
        "Reason",
      ]}
      rows={s.movements
        .filter(
          (m) =>
            (!id || m.partId === id) &&
            (!from || m.date.slice(0, 10) >= from) &&
            (!to || m.date.slice(0, 10) <= to),
        )
        .slice()
        .reverse()
        .map((m) => [
          date(m.date),
          partLink(m.partId),
          whName(m.warehouseId),
          m.type.replaceAll("_", " "),
          <strong className={m.quantity > 0 ? "positive" : ""}>
            {m.quantity > 0 ? "+" : ""}
            {m.quantity}
          </strong>,
          m.reference,
          m.notes,
        ])}
    />
  );
  const compatibility = (id?: string) => (
    <>
      <p className="notice">
        Demo and supplier-listed fitment relationships. Always verify
        application, engine and production year with an authoritative catalogue.
      </p>
      <Table
        headers={[
          "Part",
          "Vehicle",
          "Variant",
          "Years",
          "Engine / code",
          "Transmission",
          "Source",
        ]}
        rows={s.compatibility
          .filter((c) => !id || c.partId === id)
          .map((c) => {
            const v = s.vehicles.find((v) => v.id === c.vehicleId)!;
            return [
              partLink(c.partId),
              `${v.make} ${v.model}`,
              v.variant,
              `${v.from}–${v.to}`,
              `${v.engine} / ${v.engineCode}`,
              v.transmission,
              c.source,
            ];
          })}
      />
    </>
  );
  const documents = (entityId?: string, entityType?: string) => (
    <>
      <div className="toolbar">
        <p className="muted">
          Local attachments · PDF, images and text · up to 2 MB each
        </p>
        <label className="button">
          + Attach file
          <input
            className="file-input"
            type="file"
            accept=".pdf,.png,.jpg,.jpeg,.txt,.csv"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              if (file.size > 2_000_000) {
                setError("Choose a file smaller than 2 MB.");
                return;
              }
              const reader = new FileReader();
              reader.onload = () =>
                run(() =>
                  services.documents.add({
                    id: uid(),
                    name: file.name,
                    entityId: entityId ?? "workspace",
                    entityType:
                      entityType ??
                      (part ? "Part" : order ? order.kind : "Workspace"),
                    mime: file.type,
                    size: file.size,
                    url: String(reader.result),
                    date: new Date().toISOString(),
                  }),
                );
              reader.onerror = () =>
                setError("File could not be read. Try again.");
              reader.readAsDataURL(file);
              e.target.value = "";
            }}
          />
        </label>
      </div>
      <Table
        headers={["File", "Linked record", "Size", "Added", "Actions"]}
        rows={s.documents
          .filter((d) => !entityId || d.entityId === entityId)
          .map((d) => [
            d.name,
            `${d.entityType} / ${d.entityId}`,
            `${Math.round(d.size / 1024)} KB`,
            date(d.date),
            <div className="actions">
              <a className="text-link" href={d.url} download={d.name}>
                Download
              </a>
              <button
                className={confirmRemoveDoc === d.id ? "danger" : undefined}
                onClick={() => {
                  if (confirmRemoveDoc !== d.id) {
                    setConfirmRemoveDoc(d.id);
                    return;
                  }
                  setConfirmRemoveDoc("");
                  run(() => services.documents.remove(d.id));
                }}
              >
                {confirmRemoveDoc === d.id ? "Confirm remove" : "Remove"}
              </button>
            </div>,
          ])}
      />
    </>
  );
  if (!logged)
    return (
      <main className="login">
        <div className="login-brand">
          <Box size={42} />
          <h1>
            Parts, people.
            <br />
            Perfectly connected.
          </h1>
          <p>
            Your catalogue, inventory and daily operations in one workspace.
          </p>
          <span>IntraForge Spare Parts Reference</span>
        </div>
        <form
          className="login-card"
          onSubmit={(e) => {
            e.preventDefault();
            sessionStorage.setItem("parts-demo-session", "yes");
            sessionStorage.setItem("parts-demo-persona", persona);
            setLogged(true);
          }}
        >
          <div className="brandmark">
            <Box /> IntraForge <span>Parts</span>
          </div>
          <h2>Welcome to your workspace</h2>
          <p>
            Explore a complete sample business. Changes stay in this browser.
          </p>
          <Field label="Demo persona">
            <select
              value={persona}
              onChange={(e) => setPersona(e.target.value)}
            >
              {[
                "Owner",
                "Administrator",
                "Manager",
                "Sales",
                "Storekeeper",
                "Purchasing",
              ].map((r) => (
                <option key={r}>{r}</option>
              ))}
            </select>
          </Field>
          <button className="primary">
            Enter demo workspace <ArrowUpRight size={16} />
          </button>
          <p className="muted">
            Demo access only. Persona selection is not authentication or
            authorization.
          </p>
        </form>
      </main>
    );
  let content: ReactNode;
  if (page === "Reference Catalogue")
    content = (
      <>
        <OEMPartSearch services={services} />
        <ReferenceCatalogue
          services={services}
          role={persona}
          initialId={referenceId}
          openCompany={openPart}
        />
      </>
    );
  else if (page === "Import / Warm Up")
    content = <CatalogueImportAdmin role={persona} />;
  else if (page === "Catalogue Administration")
    content = <CatalogueAdmin role={persona} />;
  else if (part) {
    content = (
      <>
        {part.preferredCataloguePartId && (
          <div className="notice">
            Linked reference: {part.referenceProvenance?.sourceProvider} /{" "}
            {part.referenceProvenance?.sourceRecordId}{" "}
            <button
              onClick={() => openReference(part.preferredCataloguePartId!)}
            >
              Open reference catalogue record
            </button>
          </div>
        )}
        <div className="part-hero">
          <button
            className="part-image-open"
            aria-label="Open item images"
            onClick={() => setTab("Images")}
          >
            <img
              src={part.images[0] ?? "/part.svg"}
              alt="Item image or shared assembly diagram"
            />
            <small>View / edit images</small>
          </button>
          <div>
            <Badge>{part.brand}</Badge>
            <h2>{part.name}</h2>
            <p>
              {part.sku}{" "}
              <span className="muted">
                {" "}
                / OEM reference{" "}
                {
                  s.numbers.find(
                    (n) => n.partId === part.id && n.type === "OEM_OE",
                  )?.display
                }
              </span>
            </p>
            <Badge>{status(part)}</Badge>{" "}
            <Badge>
              {part.catalogueSource ? "Supplier listed" : "Demo catalogue"}
            </Badge>
          </div>
          <div className="part-price">
            <small>Selling price</small>
            <strong>
              {part.pricingPending ? "Not set" : money(part.price)}
            </strong>
            <small>
              {available(part.id)} available across {s.warehouses.length}{" "}
              locations
            </small>
          </div>
        </div>
        <div className="tabs">
          {[
            "Overview",
            "Part Numbers",
            "Cross References",
            "Compatibility",
            "Inventory",
            "Suppliers",
            "Purchases",
            "Sales",
            "Documents",
            "Images",
            "Activity",
          ].map((t) => (
            <button
              key={t}
              className={tab === t ? "selected" : ""}
              onClick={() => setTab(t)}
            >
              {t}
            </button>
          ))}
        </div>
        <section className="panel">
          {tab === "Overview" ? (
            <div className="detail-grid">
              <div>
                <CatalogueSource part={part} />
                <h3>Product information</h3>
                <p>{part.description}</p>
                <dl>
                  {[
                    ["Manufacturer", part.manufacturer],
                    ["Category", part.category],
                    ["Country of origin", part.origin],
                    ["Unit", part.unit],
                    [
                      "Weight",
                      part.catalogueSource && part.weight === 0
                        ? "Not supplied"
                        : `${part.weight} kg`,
                    ],
                    [
                      "Cost",
                      part.catalogueSource && part.cost === 0
                        ? "Not set"
                        : money(part.cost),
                    ],
                    ["Reorder level", part.reorder],
                    ["Minimum stock", part.minimum],
                  ].map(([k, v]) => (
                    <div key={k}>
                      <dt>{k}</dt>
                      <dd>{v}</dd>
                    </div>
                  ))}
                </dl>
              </div>
              <div>
                <h3>Availability by location</h3>
                {stock
                  .filter((x) => x.partId === part.id)
                  .map((x) => (
                    <div className="warehouse-row" key={x.warehouseId}>
                      <span>{whName(x.warehouseId)}</span>
                      <strong>{x.available}</strong>
                    </div>
                  ))}
                <p className="notice">{part.notes}</p>
              </div>
            </div>
          ) : tab === "Part Numbers" ? (
            <>
              <div className="panel-head">
                <h3>Numbers & provenance</h3>
                <button onClick={() => setModal("Part number")}>
                  + Add number
                </button>
              </div>
              {numberTable(part.id)}
            </>
          ) : tab === "Cross References" ? (
            <>
              <div className="panel-head">
                <h3>Reference relationships</h3>
                <button onClick={() => setModal("Supersession")}>
                  Record supersession
                </button>
              </div>
              <p className="muted">
                Numbers attached to this part are shown together. Equivalence
                remains unverified.
              </p>
              {numberTable(part.id)}
              <p className="notice">
                Previous numbers point to their current replacement in the
                “Superseded by” column.
              </p>
            </>
          ) : tab === "Compatibility" ? (
            <>
              <button onClick={() => setModal("Compatibility")}>
                + Link vehicle
              </button>
              {compatibility(part.id)}
            </>
          ) : tab === "Inventory" ? (
            stockTable(part.id)
          ) : tab === "Purchases" ? (
            ordersTable(
              s.orders.filter(
                (o) =>
                  o.kind === "Purchase" &&
                  o.lines.some((l) => l.partId === part.id),
              ),
            )
          ) : tab === "Sales" ? (
            ordersTable(
              s.orders.filter(
                (o) =>
                  o.kind === "Sale" &&
                  o.lines.some((l) => l.partId === part.id),
              ),
            )
          ) : tab === "Suppliers" ? (
            <Table
              headers={["Supplier", "Reference", "Source"]}
              rows={s.numbers
                .filter((n) => n.partId === part.id && n.type === "SUPPLIER")
                .map((n) => [
                  n.supplierId
                    ? contactName(n.supplierId)
                    : "Supplier not assigned",
                  n.display,
                  n.source,
                ])}
            />
          ) : tab === "Documents" ? (
            documents(part.id)
          ) : tab === "Images" ? (
            <Gallery
              part={part}
              services={services}
              onEdit={() => setModal("Part")}
            />
          ) : (
            movementTable(part.id)
          )}
        </section>
      </>
    );
  } else if (order) {
    content = (
      <section
        className={`panel order-detail ${page === "Invoices" ? "invoice" : ""}`}
      >
        <div className="panel-head">
          <div>
            <p className="muted">
              {order.invoiceNumber ? "Invoice" : "Order"} / {order.kind}
            </p>
            <h2>{order.invoiceNumber ?? order.number}</h2>
            <p>
              {s.settings.company}
              <small>{s.settings.address}</small>
            </p>
          </div>
          <div>
            <Badge>{order.status}</Badge> <Badge>{order.payment}</Badge>
            <p>{date(order.date)}</p>
          </div>
        </div>
        <div className="detail-grid">
          <div>
            <small>{order.kind === "Purchase" ? "Supplier" : "Bill to"}</small>
            <h3>{contactName(order.contactId)}</h3>
            <p>{s.contacts.find((c) => c.id === order.contactId)?.address}</p>
          </div>
          <div>
            <small>Warehouse</small>
            <h3>{whName(order.warehouseId)}</h3>
            <p>{order.notes}</p>
          </div>
        </div>
        <Table
          headers={[
            "Part",
            "Quantity",
            "Processed",
            "Returned",
            "Unit price",
            "Discount",
            "Line total",
          ]}
          rows={order.lines.map((l) => [
            partLink(l.partId),
            l.quantity,
            l.processed,
            l.returned,
            money(l.price),
            `${l.discount}%`,
            money(l.quantity * l.price * (1 - l.discount / 100)),
          ])}
        />
        <div className="totals">
          <p>
            Subtotal <strong>{money(totals(order).subtotal)}</strong>
          </p>
          <p>
            Tax ({order.taxRate}%) <strong>{money(totals(order).tax)}</strong>
          </p>
          <h3>
            Total <strong>{money(totals(order).total)}</strong>
          </h3>
        </div>
        <div className="actions no-print">
          {order.kind === "Purchase" ? (
            <>
              {order.status === "Draft" && (
                <button
                  className="primary"
                  onClick={() =>
                    run(() => services.purchasing.confirm(order.id))
                  }
                >
                  Confirm purchase
                </button>
              )}
              {["Confirmed", "Partially Received"].includes(order.status) && (
                <button
                  className="primary"
                  onClick={() => setModal("Receive goods")}
                >
                  Receive goods
                </button>
              )}
              {order.status === "Received" && (
                <button
                  onClick={() => run(() => services.purchasing.close(order.id))}
                >
                  Close purchase
                </button>
              )}
              {["Draft", "Confirmed"].includes(order.status) && (
                <button
                  className="danger"
                  onClick={() => setModal("Cancel order")}
                >
                  Cancel purchase
                </button>
              )}
            </>
          ) : (
            <>
              {["Draft", "Quotation"].includes(order.status) && (
                <button
                  className="primary"
                  onClick={() => run(() => services.sales.confirm(order.id))}
                >
                  Confirm sales order
                </button>
              )}
              {order.status === "Confirmed" && (
                <button
                  className="primary"
                  onClick={() => run(() => services.sales.fulfill(order.id))}
                >
                  Fulfill order
                </button>
              )}
              {order.status === "Fulfilled" && (
                <button
                  className="primary"
                  onClick={() => run(() => services.sales.invoice(order.id))}
                >
                  Create invoice
                </button>
              )}
              {order.status === "Invoiced" && order.payment === "Unpaid" && (
                <button
                  className="primary"
                  onClick={() => run(() => services.sales.pay(order.id))}
                >
                  Record payment
                </button>
              )}
              {["Fulfilled", "Invoiced"].includes(order.status) && (
                <button onClick={() => setModal("Receive return")}>
                  Receive return
                </button>
              )}
              {["Draft", "Quotation", "Confirmed"].includes(order.status) && (
                <button
                  className="danger"
                  onClick={() => setModal("Cancel order")}
                >
                  Cancel sales order
                </button>
              )}
            </>
          )}
          {order.invoiceNumber && (
            <button onClick={() => window.print()}>Print invoice</button>
          )}
        </div>
        <div className="no-print">{documents(order.id)}</div>
      </section>
    );
  } else if (page === "Dashboard") {
    content = (
      <Dashboard
        s={s}
        stock={stock}
        available={available}
        status={status}
        ordersTable={ordersTable}
        partLink={partLink}
        navigate={navigate}
      />
    );
  } else if (page === "Parts") {
    const parts = services.catalogue
      .search(query)
      .filter((p) => filter === "All" || p.category === filter);
    content = (
      <section className="panel">
        <div className="toolbar">
          <div className="search-box">
            <Search size={17} />
            <input
              aria-label="Search catalogue"
              placeholder="Search name, SKU, OEM or any reference…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <select
            aria-label="Category"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          >
            <option value="All">All categories</option>
            {[...new Set(s.parts.map((p) => p.category))].map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
          <small>{parts.length} parts</small>
        </div>
        <p className="catalogue-coverage">
          My Products contains company-owned commercial records. Browse
          Reference Catalogue to find components and explicitly add them here.
        </p>
        <Table
          headers={[
            "Part / internal SKU",
            "Brand",
            "Category",
            "OEM reference",
            "Available",
            "Selling price",
            "Status",
            "",
          ]}
          rows={parts.map((p) => [
            <div className="part-cell">
              <img src={p.images[0] ?? "/part.svg"} alt="" />
              {partLink(p.id)}
            </div>,
            p.brand,
            p.category,
            s.numbers.find((n) => n.partId === p.id && n.type === "OEM_OE")
              ?.display,
            <strong>{available(p.id)}</strong>,
            p.pricingPending ? "Not set" : money(p.price),
            <Badge>{status(p)}</Badge>,
            <button
              aria-label={`Open ${p.name}`}
              onClick={() => openPart(p.id)}
            >
              <ChevronRight size={16} />
            </button>,
          ])}
        />
      </section>
    );
  } else if (["Part Numbers", "Cross References"].includes(page))
    content = (
      <section className="panel">
        <div className="toolbar">
          <input
            aria-label="Search part numbers"
            placeholder="Try 044650K290 or a supplier reference"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <Badge>Check source verification</Badge>
        </div>
        {numberTable(undefined, page === "Cross References")}
      </section>
    );
  else if (page === "Vehicle Compatibility")
    content = (
      <section className="panel">
        <button onClick={() => setModal("Compatibility")}>
          + Link vehicle
        </button>
        {compatibility()}
      </section>
    );
  else if (["Stock", "Low Stock"].includes(page))
    content = (
      <section className="panel">
        <div className="toolbar">
          <select
            aria-label="Warehouse filter"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          >
            <option value="All">All warehouses</option>
            {s.warehouses.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
          <button onClick={() => setModal("Transfer")}>
            <ArrowRightLeft size={15} /> Transfer stock
          </button>
          <button onClick={() => setModal("Adjustment")}>Adjust stock</button>
        </div>
        {stockTable(undefined, page === "Low Stock")}
      </section>
    );
  else if (["Transfers", "Adjustments"].includes(page))
    content = (
      <section className="panel">
        <Table
          headers={[
            "Date",
            "Part",
            "Warehouse",
            "Quantity",
            "Reference",
            "Reason",
          ]}
          rows={s.movements
            .filter((m) =>
              page === "Transfers"
                ? m.type.startsWith("TRANSFER")
                : m.type === "ADJUSTMENT",
            )
            .slice()
            .reverse()
            .map((m) => [
              date(m.date),
              partLink(m.partId),
              whName(m.warehouseId),
              m.quantity,
              m.reference,
              m.notes,
            ])}
        />
      </section>
    );
  else if (["Users", "Roles", "Warehouses", "Branches"].includes(page))
    content = <Management page={page} services={services} />;
  else if (["Brands", "Categories"].includes(page))
    content = (
      <section className="panel">
        <Table
          headers={[
            page === "Brands" ? "Brand" : "Category",
            "Parts",
            "Available stock",
          ]}
          rows={[
            ...new Set(
              s.parts.map((p) => (page === "Brands" ? p.brand : p.category)),
            ),
          ].map((name) => {
            const parts = s.parts.filter(
              (p) => (page === "Brands" ? p.brand : p.category) === name,
            );
            return [
              name,
              parts.length,
              parts.reduce((n, p) => n + available(p.id), 0),
            ];
          })}
        />
      </section>
    );
  else if (["Customers", "Suppliers"].includes(page))
    content = (
      <section className="panel">
        <Table
          headers={[
            "Company",
            "Contact",
            "Email / phone",
            "Country",
            "Terms",
            "Status",
          ]}
          rows={s.contacts
            .filter(
              (c) =>
                c.kind === (page === "Customers" ? "Customer" : "Supplier") &&
                c.name.toLowerCase().includes(query.toLowerCase()),
            )
            .map((c) => [
              <button
                className="text-link"
                onClick={() => {
                  setContactId(c.id);
                  setModal("Contact details");
                }}
              >
                {c.name}
              </button>,
              c.person,
              <>
                {c.email}
                <small>{c.phone}</small>
              </>,
              c.country,
              c.terms,
              <Badge>{c.status}</Badge>,
            ])}
        />
      </section>
    );
  else if (
    [
      "Purchase Orders",
      "Goods Receiving",
      "Sales Orders",
      "Quotations",
      "Invoices",
      "Returns",
    ].includes(page)
  )
    content = (
      <section className="panel">
        {page === "Returns" && (
          <p className="notice">
            Open a fulfilled sale to receive returned units. This demo records
            stock returns; financial credits require settlement outside this
            reference workflow.
          </p>
        )}
        {ordersTable(
          s.orders.filter((o) =>
            page === "Purchase Orders"
              ? o.kind === "Purchase"
              : page === "Goods Receiving"
                ? o.kind === "Purchase" &&
                  ["Confirmed", "Partially Received"].includes(o.status)
                : page === "Quotations"
                  ? o.status === "Quotation"
                  : page === "Invoices"
                    ? !!o.invoiceNumber
                    : page === "Returns"
                      ? o.kind === "Sale" &&
                        ["Fulfilled", "Invoiced"].includes(o.status)
                      : o.kind === "Sale",
          ),
        )}
      </section>
    );
  else if (page === "Documents")
    content = <section className="panel">{documents()}</section>;
  else if (page === "Audit Log")
    content = (
      <section className="panel">
        <Table
          headers={["Time", "Action", "Detail", "Actor"]}
          rows={s.audit.map((a) => [
            new Date(a.date).toLocaleString(),
            a.action,
            a.detail,
            a.actor,
          ])}
        />
      </section>
    );
  else if (page === "Settings")
    content = (
      <section className="panel">
        <Forms
          type="Settings"
          services={services}
          done={() => setMessage("Business settings saved.")}
        />
      </section>
    );
  else if (page === "Reports") {
    const reportNames = [
      "Inventory Valuation",
      "Current Stock",
      "Low Stock",
      "Out of Stock",
      "Sales by Product",
      "Sales by Customer",
      "Purchases by Supplier",
      "Gross Margin",
      "Top Selling Parts",
      "Slow-Moving Parts",
      "Stock Movement History",
    ];
    const filtered = s.orders.filter(
      (o) =>
        (!from || o.date.slice(0, 10) >= from) &&
        (!to || o.date.slice(0, 10) <= to),
    );
    const sold = filtered.filter(
      (o) => o.kind === "Sale" && ["Fulfilled", "Invoiced"].includes(o.status),
    );
    let headers: string[] = ["Part", "On hand", "Unit cost", "Stock value"];
    let rows: (string | number)[][] = s.parts
      .filter((p) =>
        report === "Low Stock"
          ? available(p.id) < p.reorder
          : report === "Out of Stock"
            ? available(p.id) <= 0
            : true,
      )
      .map((p) => {
        const on = stock
          .filter((x) => x.partId === p.id)
          .reduce((n, x) => n + x.onHand, 0);
        return [p.name, on, money(p.cost), money(on * p.cost)];
      });
    if (["Current Stock", "Low Stock", "Out of Stock"].includes(report)) {
      headers = ["Part", "On hand", "Reserved", "Available", "Reorder level"];
      rows = s.parts
        .filter((p) =>
          report === "Low Stock"
            ? available(p.id) < p.reorder
            : report === "Out of Stock"
              ? available(p.id) <= 0
              : true,
        )
        .map((p) => {
          const balances = stock.filter((x) => x.partId === p.id);
          return [
            p.name,
            balances.reduce((n, x) => n + x.onHand, 0),
            balances.reduce((n, x) => n + x.reserved, 0),
            available(p.id),
            p.reorder,
          ];
        });
    } else if (
      ["Sales by Customer", "Purchases by Supplier"].includes(report)
    ) {
      headers = ["Business", "Orders", "Total"];
      rows = s.contacts
        .filter(
          (c) =>
            c.kind ===
            (report === "Sales by Customer" ? "Customer" : "Supplier"),
        )
        .map((c) => {
          const os = (
            report === "Sales by Customer"
              ? sold
              : filtered.filter((o) => o.kind === "Purchase")
          ).filter((o) => o.contactId === c.id);
          return [
            c.name,
            os.length,
            money(os.reduce((n, o) => n + totals(o).total, 0)),
          ];
        });
    } else if (
      [
        "Sales by Product",
        "Gross Margin",
        "Top Selling Parts",
        "Slow-Moving Parts",
      ].includes(report)
    ) {
      headers = ["Part", "Units sold", "Net sales", "Estimated gross margin"];
      rows = s.parts
        .map((p) => {
          const ls = sold
            .flatMap((o) => o.lines)
            .filter((l) => l.partId === p.id);
          const units = ls.reduce((n, l) => n + l.quantity - l.returned, 0);
          const revenue = ls.reduce(
            (n, l) =>
              n + (l.quantity - l.returned) * l.price * (1 - l.discount / 100),
            0,
          );
          return [
            p.name,
            units,
            money(revenue),
            money(revenue - units * p.cost),
          ];
        })
        .sort((a, b) =>
          report === "Slow-Moving Parts"
            ? Number(a[1]) - Number(b[1])
            : Number(b[1]) - Number(a[1]),
        );
    }
    const csv = () => {
      const csvText = [headers, ...rows]
        .map((r) =>
          r
            .map(
              (v) =>
                '"' +
                String(v)
                  .replace(/^[=+@-]/, "'$&")
                  .replaceAll('"', '""') +
                '"',
            )
            .join(","),
        )
        .join("\r\n");
      const url = URL.createObjectURL(
        new Blob([csvText], { type: "text/csv" }),
      );
      const a = document.createElement("a");
      a.href = url;
      a.download = `${report}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    };
    content = (
      <section className="panel">
        <div className="toolbar">
          <select
            aria-label="Report"
            value={report}
            onChange={(e) => setReport(e.target.value)}
          >
            {reportNames.map((r) => (
              <option key={r}>{r}</option>
            ))}
          </select>
          <Field label="From">
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
          </Field>
          <Field label="To">
            <input
              type="date"
              value={to}
              min={from}
              onChange={(e) => setTo(e.target.value)}
            />
          </Field>
          {report !== "Stock Movement History" && (
            <button onClick={csv}>
              <Download size={15} /> Export CSV
            </button>
          )}
        </div>
        <p className="muted">
          Stock reports show current balances. Dates filter sales, purchases and
          movements. Gross margin uses current demo costs, excluding tax.
        </p>
        {report === "Stock Movement History" ? (
          movementTable()
        ) : (
          <Table headers={headers} rows={rows} />
        )}
      </section>
    );
  } else
    content = (
      <section className="panel empty">
        <h2>Page not found</h2>
        <button onClick={() => navigate("Dashboard")}>
          Return to dashboard
        </button>
      </section>
    );
  const createType = part
    ? "Part"
    : (
        {
          Parts: "Part",
          Customers: "Customer",
          Suppliers: "Supplier",
          "Purchase Orders": "Purchase",
          "Goods Receiving": "Purchase",
          "Sales Orders": "Sale",
          Quotations: "Quotation",
          Transfers: "Transfer",
          Adjustments: "Adjustment",
        } as Record<string, string>
      )[page];
  const subtitle = part
    ? "Catalogue / Part detail"
    : order
      ? "Operations / Order detail"
      : page === "Dashboard"
        ? "A clear view of your business, from shelf to sale."
        : ((
            {
              Parts: "Every part, every reference, one reliable catalogue.",
              Stock: "Availability and reservations across your locations.",
              "Purchase Orders":
                "Plan replenishment and track supplier deliveries.",
            } as Record<string, string>
          )[page] ?? "Manage your daily spare-parts operations.");
  return (
    <div className={`app ${collapsed ? "collapsed" : ""}`}>
      <aside className="sidebar no-print">
        <div className="brandmark">
          <Box size={27} />
          {!collapsed && (
            <span>
              IntraForge<small>Spare parts</small>
            </span>
          )}
        </div>
        <nav aria-label="Main navigation">
          {groups
            .filter(
              (g) =>
                g.name !== "Catalogue Administration" ||
                isCatalogueAdmin(persona),
            )
            .map((g) => (
              <div className="nav-group" key={g.name}>
                <button
                  className={`nav-item ${page === g.name || g.items.includes(page) ? "active" : ""}`}
                  title={g.name}
                  onClick={() =>
                    g.items.length
                      ? (setGroup(group === g.name ? "" : g.name),
                        collapsed && setCollapsed(false))
                      : navigate(g.name)
                  }
                >
                  <g.icon size={18} />
                  {!collapsed && (
                    <>
                      <span>{g.name}</span>
                      {g.items.length > 0 && <ChevronRight size={14} />}
                    </>
                  )}
                </button>
                {!collapsed &&
                  group === g.name &&
                  g.items.map((p) => (
                    <button
                      key={p}
                      className={`nav-child ${page === p ? "active-child" : ""}`}
                      onClick={() => navigate(p)}
                    >
                      {p === "Parts" ? "My Products" : p}
                      {p === "Low Stock" && (
                        <span>
                          {
                            s.parts.filter((p) => available(p.id) < p.reorder)
                              .length
                          }
                        </span>
                      )}
                    </button>
                  ))}
              </div>
            ))}
        </nav>
        <div className="sidebar-bottom">
          {!collapsed && (
            <>
              <span className="status-dot" /> Demo workspace
              <small>Local data · IntraForge ready architecture</small>
            </>
          )}
          <button
            aria-label="Collapse sidebar"
            onClick={() => setCollapsed(!collapsed)}
          >
            <PanelLeftClose size={18} />
          </button>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar no-print">
          <div className="breadcrumb">
            <span>Workspace</span>
            <ChevronRight size={14} />
            <strong>{page}</strong>
          </div>
          <div className="global-search">
            <Search size={17} />
            <input
              aria-label="Global search"
              placeholder="Search parts, references, orders…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {query && (
              <div className="search-results">
                <small>My Products</small>
                {services.catalogue
                  .search(query)
                  .slice(0, 6)
                  .map((p) => (
                    <button key={p.id} onClick={() => openPart(p.id)}>
                      {p.name}
                      <small>{p.sku}</small>
                    </button>
                  ))}
                {referenceHits.length > 0 && <small>Reference Catalogue</small>}
                {referenceHits.map((h) => (
                  <button
                    key={h.part.id}
                    onClick={() => openReference(h.part.id)}
                  >
                    {h.part.description}
                    <small>Reference part · {h.numbers[0]?.original}</small>
                  </button>
                ))}
                {s.contacts
                  .filter((c) =>
                    c.name.toLowerCase().includes(query.toLowerCase()),
                  )
                  .slice(0, 3)
                  .map((c) => (
                    <button
                      key={c.id}
                      onClick={() => {
                        setContactId(c.id);
                        setModal("Contact details");
                        setQuery("");
                      }}
                    >
                      {c.name}
                      <small>{c.kind}</small>
                    </button>
                  ))}
                {s.orders
                  .filter((o) =>
                    o.number.toLowerCase().includes(query.toLowerCase()),
                  )
                  .slice(0, 3)
                  .map((o) => (
                    <button
                      key={o.id}
                      onClick={() => {
                        setPartId("");
                        setOrderId(o.id);
                        setQuery("");
                      }}
                    >
                      {o.number}
                    </button>
                  ))}
                {!referenceHits.length &&
                  !services.catalogue.search(query).length &&
                  !s.contacts.some((c) =>
                    c.name.toLowerCase().includes(query.toLowerCase()),
                  ) &&
                  !s.orders.some((o) =>
                    o.number.toLowerCase().includes(query.toLowerCase()),
                  ) && <p>No matching records.</p>}
              </div>
            )}
          </div>
          <AuthControls />
          <details className="account">
            <summary>
              <span className="avatar">DO</span>
              <span>
                Demo operator<small>{persona}</small>
              </span>
            </summary>
            <button
              onClick={() => {
                sessionStorage.removeItem("parts-demo-session");
                sessionStorage.removeItem("parts-demo-persona");
                setLogged(false);
              }}
            >
              <LogOut size={15} /> Leave workspace
            </button>
          </details>
        </header>
        <main>
          <div className="page-head no-print">
            <div>
              {(part || order) && (
                <button
                  className="back"
                  onClick={() => {
                    setPartId("");
                    setOrderId("");
                  }}
                >
                  ← Back to {page.toLowerCase()}
                </button>
              )}
              <h1>
                {part
                  ? "Part details"
                  : order
                    ? order.invoiceNumber
                      ? "Invoice"
                      : "Order details"
                    : page === "Dashboard"
                      ? "Business overview"
                      : page === "Parts"
                        ? "My Products"
                        : page}
              </h1>
              <p>{subtitle}</p>
            </div>
            <div className="actions">
              {page === "Dashboard" && (
                <>
                  <span className="today">
                    {date(new Date().toISOString())}
                  </span>
                  <button className="primary" onClick={() => setModal("Sale")}>
                    <Plus size={16} /> New sale
                  </button>
                </>
              )}
              {createType && !order && (
                <button
                  className="primary"
                  onClick={() => setModal(createType)}
                >
                  <Plus size={16} />
                  {part ? "Edit part" : `New ${createType.toLowerCase()}`}
                </button>
              )}
            </div>
          </div>
          {error && (
            <div className="error no-print" role="alert">
              {error}
              <button onClick={() => setError("")}>Dismiss</button>
            </div>
          )}
          {message && (
            <div className="toast no-print" role="status">
              {message}
            </div>
          )}
          {content}
          <footer className="no-print">
            <span>IntraForge Parts</span>
            <span>
              Demo data · All catalogue numbers and fitments are unverified
            </span>
          </footer>
        </main>
      </div>
      {modal && (
        <Modal title={modal} onClose={() => setModal("")}>
          {modal === "Supersession" ? (
            <SupersessionForm
              part={part!}
              services={services}
              done={() => setModal("")}
            />
          ) : modal === "Compatibility" ? (
            <CompatibilityForm
              part={part}
              services={services}
              done={() => setModal("")}
            />
          ) : modal === "Contact details" ? (
            <ContactDetails
              contact={s.contacts.find((c) => c.id === contactId)!}
              services={services}
              renderOrders={(os) => (
                <div onClick={() => setModal("")}>{ordersTable(os)}</div>
              )}
              renderDocuments={() =>
                documents(
                  contactId,
                  s.contacts.find((c) => c.id === contactId)?.kind,
                )
              }
            />
          ) : modal === "Receive goods" || modal === "Receive return" ? (
            <QuantityForm
              order={order!}
              services={services}
              isReturn={modal === "Receive return"}
              done={() => {
                setModal("");
                setMessage("Stock movements posted successfully.");
              }}
            />
          ) : modal === "Cancel order" ? (
            <CancelOrderConfirm
              order={order!}
              services={services}
              done={() => {
                setModal("");
                setMessage("Order cancelled.");
              }}
              cancel={() => setModal("")}
            />
          ) : (
            <Forms
              type={modal}
              services={services}
              part={part}
              done={() => {
                setModal("");
                setMessage("Record saved successfully.");
              }}
            />
          )}
        </Modal>
      )}
    </div>
  );
}
function QuantityForm({
  order,
  services,
  isReturn,
  done,
}: {
  order: Order;
  services: Services;
  isReturn: boolean;
  done: () => void;
}) {
  const [error, setError] = useState("");
  return (
    <form
      action={async (f) => {
        try {
          const qs = order.lines.map((_, i) => Number(f.get(`qty-${i}`)));
          if (isReturn) await services.sales.returnItems(order.id, qs);
          else await services.purchasing.receive(order.id, qs);
          done();
        } catch (e) {
          setError((e as Error).message);
        }
      }}
    >
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {order.lines.map((l, i) => (
        <Field
          key={i}
          label={`${services.snapshot().parts.find((p) => p.id === l.partId)?.name} — ${isReturn ? l.processed - l.returned : l.quantity - l.processed} remaining`}
        >
          <input
            name={`qty-${i}`}
            type="number"
            min={0}
            max={isReturn ? l.processed - l.returned : l.quantity - l.processed}
            defaultValue={isReturn ? 0 : l.quantity - l.processed}
            required
          />
        </Field>
      ))}
      <button className="primary">
        {isReturn ? "Confirm return" : "Post goods receipt"}
      </button>
    </form>
  );
}
function CancelOrderConfirm({
  order,
  services,
  done,
  cancel,
}: {
  order: Order;
  services: Services;
  done: () => void;
  cancel: () => void;
}) {
  const [error, setError] = useState("");
  return (
    <div>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <p>
        Cancel {order.kind === "Purchase" ? "purchase" : "sales order"}{" "}
        <strong>{order.number}</strong>? This cannot be undone.
      </p>
      <div className="actions">
        <button
          className="danger"
          onClick={async () => {
            try {
              if (order.kind === "Purchase")
                await services.purchasing.cancel(order.id);
              else await services.sales.cancel(order.id);
              done();
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        >
          Yes, cancel order
        </button>
        <button onClick={cancel}>Keep order</button>
      </div>
    </div>
  );
}
