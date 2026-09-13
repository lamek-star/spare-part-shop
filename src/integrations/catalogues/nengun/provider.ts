import {
  CatalogueProvider,
  capabilitiesFor,
} from "../../../catalogue/providers";
import {
  Page,
  ReferenceHit,
  ReferenceDetail,
  DiagramDetail,
  BrowseOptions,
} from "../../../catalogue/models";
import { nengunImportMode } from "./config";
/**
 * Implements the application's generic CatalogueProvider contract for
 * nengun.com. Disabled for bulk/production import by default — see
 * config.ts and docs/catalogues/NENGUN_SOURCE_REVIEW.md.
 *
 * There is intentionally no transport implementation (no fetch/HTTP call
 * to nengun.com anywhere in this file or this package). robots.txt
 * disallows automated access to the OEM catalogue paths for general bots
 * and blocks ClaudeBot entirely; this provider must not attempt retrieval
 * until a documented authorization or licensed feed supplies both the
 * legal basis and the access method. Setting NENGUN_IMPORT_MODE alone
 * does not enable extraction — it only changes which error this class
 * raises, so the gap is visible rather than silently bypassed.
 *
 * When authorization exists, wire an actual transport (an injected
 * fetcher, not a hardcoded implementation here) that returns
 * NengunDiagramPage objects for mapNengunDiagramPage (mapper.ts) to
 * normalize — the CatalogueProvider contract and the rest of the
 * application do not need to change.
 */
export class NengunProvider implements CatalogueProvider {
  readonly key = "nengun";
  readonly capabilities = capabilitiesFor("nengun");
  private unavailable(): never {
    const mode = nengunImportMode();
    if (mode !== "licensed_import")
      throw new Error(
        "nengun: reference_only mode — catalogue queries are disabled. Set NENGUN_IMPORT_MODE=licensed_import only once a documented authorization or licensed feed exists.",
      );
    throw new Error(
      "nengun: licensed_import is configured, but no authorized transport is implemented. Supply an approved fetch mechanism before this provider can serve data.",
    );
  }
  async searchParts(
    _query: string,
    _page: number,
  ): Promise<Page<ReferenceHit>> {
    this.unavailable();
  }
  async getPart(_id: string): Promise<ReferenceDetail> {
    this.unavailable();
  }
  async browse(_filters: Record<string, string>): Promise<BrowseOptions> {
    this.unavailable();
  }
  async getDiagram(_id: string): Promise<DiagramDetail> {
    this.unavailable();
  }
}
export const nengunProvider = new NengunProvider();
