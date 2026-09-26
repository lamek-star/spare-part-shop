"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useSession } from "../../../ui/session";
import { ListPage } from "../../../ui/ListPage";
import { Badge, FormModal, Money, useApi } from "../../../ui/kit";
import { post } from "../../../ui/api";
import { locationOptions, useWarehouses } from "../../../ui/stock";
import { productFields, productPayload } from "../../../ui/productForm";

interface Product {
  id: string;
  sku: string;
  name: string;
  brand: string;
  category: string;
  status: string;
  priceMinor: number;
  costMinor: number | null;
  currency: string;
  reorderLevel: number;
  onHand: number;
  available: number;
  primaryImageUrl: string | null;
}
export default function Products() {
  const s = useSession();
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [low, setLow] = useState(false);
  const [category, setCategory] = useState("");
  const cats = useApi<string[]>("/products/categories");
  const suppliers = useApi<{ items: { id: string; name: string }[] }>(
    creating && s.can("suppliers.read") ? "/suppliers?pageSize=100" : null,
  );
  const wh = useWarehouses(creating && s.can("inventory.read"));
  return (
    <>
      <ListPage<Product>
        title="My Products"
        subtitle="Items your shop sells, with your own SKU, price and stock. Reference Catalogue parts stay separate until you import them here."
        endpoint="/products"
        statuses={["ACTIVE", "INACTIVE"]}
        searchPlaceholder="Search name, SKU, brand or part number"
        extraFilters={{
          lowStockOnly: low || undefined,
          category: category || undefined,
        }}
        actions={
          <>
            <select
              aria-label="Category"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            >
              <option value="">All categories</option>
              {cats.data?.filter(Boolean).map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
            <label>
              <input
                type="checkbox"
                checked={low}
                onChange={(e) => setLow(e.target.checked)}
              />{" "}
              Low stock only
            </label>
            {s.can("products.write") && (
              <button className="primary" onClick={() => setCreating(true)}>
                New product
              </button>
            )}
          </>
        }
        rowKey={(p) => p.id}
        onRow={(p) => router.push(`/products/${p.id}`)}
        columns={[
          {
            header: "Product",
            cell: (p) => (
              <div
                className="part-cell"
                style={{ display: "flex", gap: 10, alignItems: "center" }}
              >
                {p.primaryImageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element -- served by the authenticated API
                  <img
                    src={p.primaryImageUrl}
                    alt=""
                    width={38}
                    height={38}
                    style={{
                      objectFit: "cover",
                      borderRadius: 4,
                      border: "1px solid var(--line)",
                    }}
                  />
                ) : (
                  <span
                    style={{
                      width: 38,
                      height: 38,
                      background: "#eef2f5",
                      borderRadius: 4,
                      display: "inline-block",
                    }}
                  />
                )}
                <div>
                  <Link href={`/products/${p.id}`}>{p.name}</Link>
                  <small className="muted" style={{ display: "block" }}>
                    {p.sku}
                    {p.brand ? ` · ${p.brand}` : ""}
                  </small>
                </div>
              </div>
            ),
          },
          { header: "Category", cell: (p) => p.category },
          {
            header: "Available",
            align: "right",
            cell: (p) =>
              p.reorderLevel > 0 && p.available <= p.reorderLevel ? (
                <strong style={{ color: "#a4323e" }}>{p.available}</strong>
              ) : (
                p.available
              ),
          },
          { header: "On hand", align: "right", cell: (p) => p.onHand },
          {
            header: "Price",
            align: "right",
            cell: (p) => <Money minor={p.priceMinor} currency={p.currency} />,
          },
          ...(s.can("products.cost.read")
            ? [
                {
                  header: "Cost",
                  align: "right" as const,
                  cell: (p: Product) => (
                    <Money minor={p.costMinor} currency={p.currency} />
                  ),
                },
              ]
            : []),
          { header: "Status", cell: (p) => <Badge value={p.status} /> },
        ]}
      />
      {creating && (
        <FormModal
          title="New product"
          fields={productFields({
            canCost: s.can("products.cost.read"),
            suppliers: suppliers.data?.items ?? [],
            creating: true,
            locations: locationOptions(wh.data),
          })}
          initial={{ condition: "NEW", status: "ACTIVE", currency: "AED" }}
          onClose={() => setCreating(false)}
          onSubmit={async (v) => {
            const p = await post<{ id: string }>(
              "/products",
              productPayload(v),
            );
            router.push(`/products/${p.id}`);
          }}
        />
      )}
    </>
  );
}
