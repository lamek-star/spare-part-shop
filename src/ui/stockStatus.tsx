"use client";
import Link from "next/link";
import { useState } from "react";
import { patch, qs } from "./api";
import { useT } from "./i18n";
import type { MessageKey } from "./messages";
import { useSession } from "./session";
import {
  Empty,
  ErrorBanner,
  FormModal,
  Loading,
  Panel,
  useApi,
  useToast,
} from "./kit";
import { useUnitLabel } from "./productForm";

type Level = "RED" | "AMBER" | "GREEN";
interface Item {
  productId: string;
  sku: string;
  name: string;
  brand: string;
  unit: string;
  available: number;
  reorderLevel: number;
  minimumLevel: number;
  level: Level;
}
interface StockStatus {
  counts: Record<Level, number>;
  items: Item[];
}
const LEVELS: Level[] = ["RED", "AMBER", "GREEN"];
const LIMIT = 12;

/** How full the bar is: available against twice the reorder level (half-full = at the reorder level). */
function fill(i: Item): number {
  const scale = Math.max(i.reorderLevel, i.minimumLevel) * 2;
  if (i.available <= 0) return 0;
  if (scale <= 0) return 100;
  return Math.min(100, Math.round((i.available / scale) * 100));
}

/**
 * The dashboard's red / amber / green stock list. The server decides each product's level from the stock ledger
 * and the product's own minimum and reorder levels; this panel only shows it and lets the shop set the levels.
 */
export function StockStatusPanel() {
  const t = useT();
  const s = useSession();
  const toast = useToast();
  const unitLabel = useUnitLabel();
  const [chosen, setChosen] = useState<Level | "ALL" | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [editing, setEditing] = useState<Item | null>(null);
  // Counts first (all levels), then the worst level that has items, unless the person picked one.
  const all = useApi<StockStatus>(
    `/reports/stock-status${qs({ limit: 1 })}`,
    refresh,
  );
  const counts = all.data?.counts;
  const level: Level | "ALL" | null =
    chosen ?? (counts ? (LEVELS.find((l) => counts[l] > 0) ?? "ALL") : null);
  const list = useApi<StockStatus>(
    level ? `/reports/stock-status${qs({ level, limit: LIMIT })}` : null,
    `${refresh}-${level}`,
  );
  const shown = level === "ALL" || !level ? null : (counts?.[level] ?? 0);
  return (
    <Panel
      title={t("dash.stockStatus")}
      actions={
        <Link className="button" href="/products">
          {t("dash.allProducts")}
        </Link>
      }
    >
      <ErrorBanner message={all.error || list.error} />
      <div
        className="level-tabs"
        role="tablist"
        aria-label={t("dash.stockStatus")}
      >
        {LEVELS.map((l) => (
          <button
            key={l}
            role="tab"
            aria-selected={level === l}
            className={`level-tab ${l.toLowerCase()}`}
            onClick={() => setChosen(l)}
            title={t(`dash.levelHint${l}` as MessageKey)}
          >
            <span className="level-dot" aria-hidden="true" />
            <span className="level-name">
              {t(`dash.level${l}` as MessageKey)}
            </span>
            <strong className="level-count">{counts ? counts[l] : "–"}</strong>
            <small>{t(`dash.levelHint${l}` as MessageKey)}</small>
          </button>
        ))}
        <button
          role="tab"
          aria-selected={level === "ALL"}
          className="level-tab all"
          onClick={() => setChosen("ALL")}
        >
          <span className="level-name">{t("dash.allLevels")}</span>
          <strong className="level-count">
            {counts ? counts.RED + counts.AMBER + counts.GREEN : "–"}
          </strong>
        </button>
      </div>
      {list.loading && !list.data && <Loading />}
      {list.data && list.data.items.length === 0 && (
        <Empty>{t("dash.noItemsAtLevel")}</Empty>
      )}
      {list.data && list.data.items.length > 0 && (
        <ul className="stock-list" key={String(level)}>
          {list.data.items.map((i) => (
            <li
              key={i.productId}
              className={`stock-row ${i.level.toLowerCase()}`}
            >
              <span
                className="level-dot"
                title={t(`dash.level${i.level}` as MessageKey)}
              />
              <Link href={`/products/${i.productId}`} className="stock-name">
                {i.name}
                <small className="muted">
                  {i.sku}
                  {i.brand ? ` · ${i.brand}` : ""}
                </small>
              </Link>
              <div className="stock-meter" aria-hidden="true">
                <span style={{ width: `${fill(i)}%` }} />
              </div>
              <div className="stock-qty">
                <strong>{i.available}</strong>{" "}
                <span className="muted">{unitLabel(i.unit)}</span>
                <small className="muted">
                  {t("dash.minReorder", {
                    min: i.minimumLevel,
                    reorder: i.reorderLevel,
                  })}
                </small>
              </div>
              {s.can("products.write") && (
                <button className="ghost" onClick={() => setEditing(i)}>
                  {t("dash.setLevels")}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {shown !== null && shown > LIMIT && (
        <small className="muted">
          {t("dash.showingFirst", { count: LIMIT })}
        </small>
      )}
      {editing && (
        <FormModal
          title={t("dash.levelsFor", { name: editing.name })}
          fields={[
            {
              name: "minimumLevel",
              label: t("prod.minimumLevel"),
              type: "number",
              help: t("prod.minimumLevelHelp"),
            },
            {
              name: "reorderLevel",
              label: t("prod.reorderLevel"),
              type: "number",
              help: t("prod.warnWhenAvailableStockFalls"),
            },
          ]}
          initial={{
            minimumLevel: editing.minimumLevel,
            reorderLevel: editing.reorderLevel,
          }}
          onClose={() => setEditing(null)}
          onSubmit={async (v) => {
            await patch(`/products/${editing.productId}`, v);
            toast(t("dash.levelsSaved"));
            setRefresh((n) => n + 1);
          }}
        />
      )}
    </Panel>
  );
}
