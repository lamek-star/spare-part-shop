"use client";
import { ReactNode } from "react";
import { Warehouse, BarChart3, ArrowUpRight } from "lucide-react";
import { Part, Order, Stock, State, money, totals } from "../domain/models";
import { Badge, Table } from "./ui";
export default function Dashboard({
  s,
  stock,
  available,
  status,
  ordersTable,
  partLink,
  navigate,
}: {
  s: State;
  stock: Stock[];
  available: (id: string) => number;
  status: (part: Part) => string;
  ordersTable: (orders: Order[]) => ReactNode;
  partLink: (id: string) => ReactNode;
  navigate: (page: string) => void;
}) {
  const sales = s.orders.filter(
    (o) => o.kind === "Sale" && ["Fulfilled", "Invoiced"].includes(o.status),
  );
  const low = s.parts.filter((p) => available(p.id) < p.reorder);
  const monthly = sales.filter(
    (o) => o.date.slice(0, 7) === new Date().toISOString().slice(0, 7),
  );
  const metrics = [
    [
      "Stock valuation",
      money(
        stock.reduce(
          (n, x) => n + x.onHand * s.parts.find((p) => p.id === x.partId)!.cost,
          0,
        ),
      ),
      "Across all locations",
    ],
    [
      "Monthly sales",
      money(monthly.reduce((n, o) => n + totals(o).total, 0)),
      `${monthly.length} fulfilled orders`,
    ],
    [
      "Open purchases",
      s.orders.filter(
        (o) =>
          o.kind === "Purchase" && !["Received", "Closed"].includes(o.status),
      ).length,
      "Awaiting supplier delivery",
    ],
    ["Low-stock parts", low.length, "Review replenishment"],
  ];
  return (
    <>
      <div className="metrics">
        {metrics.map(([label, value, sub]) => (
          <div className="metric" key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
            <small>{sub}</small>
          </div>
        ))}
      </div>
      <div className="quick-stats">
        {[
          ["Catalogue parts", s.parts.length],
          ["Out of stock", s.parts.filter((p) => available(p.id) <= 0).length],
          [
            "Today’s sales",
            money(
              sales
                .filter(
                  (o) =>
                    o.date.slice(0, 10) ===
                    new Date().toISOString().slice(0, 10),
                )
                .reduce((n, o) => n + totals(o).total, 0),
            ),
          ],
          [
            "Pending deliveries",
            s.orders.filter(
              (o) => o.kind === "Sale" && o.status === "Confirmed",
            ).length,
          ],
          [
            "Active customers",
            s.contacts.filter(
              (c) => c.kind === "Customer" && c.status === "Active",
            ).length,
          ],
          [
            "Active suppliers",
            s.contacts.filter(
              (c) => c.kind === "Supplier" && c.status === "Active",
            ).length,
          ],
        ].map(([k, v]) => (
          <div key={k}>
            <small>{k}</small>
            <strong>{v}</strong>
          </div>
        ))}
      </div>
      <div className="dashboard-grid">
        <section className="panel">
          <div className="panel-head">
            <div>
              <h3>Recent sales</h3>
              <small>The latest customer activity</small>
            </div>
            <button onClick={() => navigate("Sales Orders")}>
              View all <ArrowUpRight size={14} />
            </button>
          </div>
          {ordersTable(s.orders.filter((o) => o.kind === "Sale").slice(0, 5))}
        </section>
        <section className="panel">
          <div className="panel-head">
            <h3>Warehouse stock</h3>
            <Warehouse size={19} />
          </div>
          {s.warehouses.map((w) => {
            const total = stock
              .filter((x) => x.warehouseId === w.id)
              .reduce((n, x) => n + x.onHand, 0);
            return (
              <div className="warehouse-meter" key={w.id}>
                <div>
                  <span>{w.name}</span>
                  <strong>
                    {total.toLocaleString()} <small>units</small>
                  </strong>
                </div>
                <meter min={0} max={4000} value={total}>
                  {total}
                </meter>
                <small>{w.branch}</small>
              </div>
            );
          })}
        </section>
        <section className="panel">
          <div className="panel-head">
            <div>
              <h3>Replenishment watchlist</h3>
              <small>Parts below their reorder level</small>
            </div>
            <button onClick={() => navigate("Low Stock")}>Review stock</button>
          </div>
          <Table
            headers={["Part", "Brand", "Available", "Status"]}
            rows={low
              .slice(0, 5)
              .map((p) => [
                partLink(p.id),
                p.brand,
                available(p.id),
                <Badge>{status(p)}</Badge>,
              ])}
          />
        </section>
        <section className="panel">
          <div className="panel-head">
            <h3>Top-selling parts</h3>
            <BarChart3 size={19} />
          </div>
          {s.parts
            .map((p) => ({
              p,
              qty: sales
                .flatMap((o) => o.lines)
                .filter((l) => l.partId === p.id)
                .reduce((n, l) => n + l.quantity, 0),
            }))
            .sort((a, b) => b.qty - a.qty)
            .slice(0, 4)
            .map(({ p, qty }, i) => (
              <div className="top-part" key={p.id}>
                <span>{i + 1}</span>
                {partLink(p.id)}
                <strong>
                  {qty}
                  <small>sold</small>
                </strong>
              </div>
            ))}
        </section>
      </div>
      <section className="panel">
        <div className="panel-head">
          <h3>Recent purchases</h3>
          <button onClick={() => navigate("Purchase Orders")}>
            View purchases
          </button>
        </div>
        {ordersTable(s.orders.filter((o) => o.kind === "Purchase").slice(0, 3))}
      </section>
    </>
  );
}
