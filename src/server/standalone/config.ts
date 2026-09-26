import type { SqlDatabase } from "../db/connection";
import type { Actor } from "../domain/types";
import type {
  AuditProvider,
  ConfigurationProvider,
  ShopConfig,
} from "../providers/core";
import { nowIso } from "../kernel/ids";
import { validation } from "../kernel/errors";

/** Defaults deliberately carry no shop identity: the shop name is
 * configuration, never something domain logic knows. */
export const defaultShopConfig: ShopConfig = {
  shopName: "",
  address: "",
  phone: "",
  email: "",
  taxRegistration: "",
  currency: "AED",
  defaultTaxBp: 500,
  quotationValidityDays: 14,
  invoiceDueDays: 30,
  quotationTerms: "",
  invoiceNotes: "",
};

export class SqliteConfigurationProvider implements ConfigurationProvider {
  constructor(
    private readonly db: SqlDatabase,
    private readonly audit: AuditProvider,
  ) {}
  async get(): Promise<ShopConfig> {
    const row = await this.db.read((h) =>
      h.get<{ value: string }>(
        "SELECT value FROM app_config WHERE key = 'shop'",
      ),
    );
    return {
      ...defaultShopConfig,
      ...(row ? (JSON.parse(row.value) as Partial<ShopConfig>) : {}),
    };
  }
  async update(actor: Actor, patch: Partial<ShopConfig>): Promise<ShopConfig> {
    return this.db.write(async (h) => {
      const current = await this.get();
      const next: ShopConfig = { ...current };
      for (const key of Object.keys(
        defaultShopConfig,
      ) as (keyof ShopConfig)[]) {
        const value = patch[key];
        if (value === undefined) continue;
        if (typeof defaultShopConfig[key] === "number") {
          if (!Number.isInteger(value) || (value as number) < 0)
            throw validation(`${key} must be a non-negative whole number.`);
          (next[key] as number) = value as number;
        } else {
          if (typeof value !== "string")
            throw validation(`${key} must be text.`);
          (next[key] as string) = value.trim().slice(0, 2000);
        }
      }
      if (!/^[A-Z]{3}$/.test(next.currency))
        throw validation("Currency must be a 3-letter code.");
      if (next.defaultTaxBp > 100000)
        throw validation("Tax rate is out of range.");
      await h.run(
        `INSERT INTO app_config(key,value,updated_at) VALUES ('shop',?,?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
        [JSON.stringify(next), nowIso()],
      );
      await this.audit.record(actor, {
        action: "settings.update",
        entityType: "settings",
        summary: "Shop settings updated",
        metadata: { fields: Object.keys(patch) },
      });
      return next;
    });
  }
  async nextNumber(sequence: string, prefix: string): Promise<string> {
    const year = new Date().getUTCFullYear();
    const value = await nextSequenceValue(this.db, `${sequence}:${year}`);
    return `${prefix}-${year}-${String(value).padStart(6, "0")}`;
  }
  async nextCode(sequence: string, prefix: string): Promise<string> {
    const value = await nextSequenceValue(this.db, sequence);
    return `${prefix}-${String(value).padStart(6, "0")}`;
  }
}

/** Atomically advances a named sequence inside the caller's transaction
 * (the number commits or rolls back with the document that uses it).
 * Shared by the standalone and platform configuration providers. */
export async function nextSequenceValue(
  db: SqlDatabase,
  name: string,
): Promise<number> {
  return db.write(async (h) => {
    await h.run(
      "INSERT INTO sequences(name, next_value) VALUES (?, 1) ON CONFLICT(name) DO UPDATE SET next_value = sequences.next_value + 1",
      [name],
    );
    const row = await h.get<{ next_value: number }>(
      "SELECT next_value FROM sequences WHERE name = ?",
      [name],
    );
    return Number(row!.next_value);
  });
}
