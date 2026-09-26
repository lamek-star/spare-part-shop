import type { SqlDatabase } from "../db/connection";
import type { Actor } from "../domain/types";
import type { ConfigurationProvider, ShopConfig } from "../providers/core";
import { defaultShopConfig, nextSequenceValue } from "../standalone/config";
import type { IntraForgeClient } from "./intraforge";

/**
 * ConfigurationProvider over IntraForge. Shop identity and document settings
 * are the installed instance's configuration in IntraForge (edited in
 * IntraForge > Apps > Settings, or here -- IntraForge re-checks the acting
 * user's capability either way). Document number sequences stay in the
 * application's schema: they must be atomic with the transaction that uses
 * the number, which only the same store can give.
 */
const CACHE_MS = 10_000;

export class PlatformConfigurationProvider implements ConfigurationProvider {
  private cached: { at: number; value: ShopConfig } | null = null;
  constructor(
    private readonly db: SqlDatabase,
    private readonly client: IntraForgeClient,
  ) {}

  async get(): Promise<ShopConfig> {
    const now = Date.now();
    if (this.cached && now - this.cached.at < CACHE_MS)
      return this.cached.value;
    const { data } = await this.client.json<Partial<ShopConfig>>(
      "GET",
      "/config/",
    );
    const value = { ...defaultShopConfig, ...pick(data) };
    this.cached = { at: now, value };
    return value;
  }

  async update(actor: Actor, patch: Partial<ShopConfig>): Promise<ShopConfig> {
    const { data } = await this.client.json<Partial<ShopConfig>>(
      "PATCH",
      "/config/",
      {
        actorId: actor.id,
        patch,
      },
    );
    const value = { ...defaultShopConfig, ...pick(data) };
    this.cached = { at: Date.now(), value };
    return value;
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

function pick(data: Partial<ShopConfig> | null): Partial<ShopConfig> {
  const out: Partial<ShopConfig> = {};
  for (const key of Object.keys(defaultShopConfig) as (keyof ShopConfig)[])
    if (data && data[key] !== undefined) (out[key] as unknown) = data[key];
  return out;
}
