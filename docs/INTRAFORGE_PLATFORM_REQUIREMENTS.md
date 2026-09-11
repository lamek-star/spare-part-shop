# IntraForge platform requirements from the catalogue reference

These are integration requirements, not assertions that IntraForge lacks them. The main platform repository was not modified or inspected for implementation work.

| Capability                 | Catalogue use                                               | Acceptance requirement                                                 |
| -------------------------- | ----------------------------------------------------------- | ---------------------------------------------------------------------- |
| AppModel / immutable IDs   | Sources, vehicles, catalogues, parts, diagrams, batches     | Stable IDs independent of display strings                              |
| Many-to-many relationships | Part ↔ variants; callout ↔ parts; numbers ↔ numbers         | Filter and traverse with relationship metadata                         |
| Parent/child hierarchy     | Make/model/variant; categories; batch/staged rows           | Referential validation; no orphan children                             |
| Composite uniqueness       | Provider + source identity + manufacturer + vehicle context | Conservative deduplication, not description matching                   |
| Indexed queries            | Normalized numbers, source record IDs, variant IDs          | Server pagination, bounded responses, indexes                          |
| Search                     | Number, description, vehicle, brand, related numbers        | Exact-match priority plus filtered full-text / prefix search           |
| Transactional workflows    | Publish a reviewed batch; adopt company product             | Atomic records + identifiers + relationships; idempotency              |
| Concurrency                | Staging based on existing revision                          | Reject stale publication rather than overwrite                         |
| Field ownership            | External description vs company prices/images/notes         | Import commands cannot mutate company-owned fields                     |
| Files and rights           | Diagrams and permitted product images                       | Object-storage adapter, metadata, signed URLs, policy-based display    |
| Permissions                | Import review, publishing, verification, rights review      | Server-enforced platform identity; UI visibility alone is insufficient |
| Bulk import jobs           | CSV and future provider feeds                               | Bounded staging, retry state, progress, cancellation, audit            |
| Provenance                 | Every external record                                       | Provider, record, catalogue, retrieval, batch, verification, license   |
| Audit/history              | Import transitions and supersession                         | Trustworthy actor and timestamps; preserve prior versions              |
| External integrations      | Licensed feeds / authorized APIs                            | Allowlisted destinations, DNS/SSRF defense, cancellation, rate limits  |
| Calculated data            | Stock/reserved/available, reports                           | Transaction-consistent balances without loading all catalogue rows     |

## Local prototype boundaries to replace

The reference repository uses a single-process JSON file and in-memory normalized-number index. It is suitable for development fixtures and bounded imports, not a production million-record database. Exact number lookup uses an index; general description/partial-number queries currently scan server memory. The service contract is paginated, so replacing that with platform indexes/full-text search does not require changing the catalogue UI.

Company data remains in browser storage. The local `x-demo-role` header is a simulated permission context and is not authentication. IntraForge must provide authenticated context, tenant/AppInstance scoping, authorization, transactional adoption, and concurrent storage. No speculative platform endpoint or physical PostgreSQL table name is used.

No source adapter is allowed to make remote requests until rights, endpoints and request policies are approved. JSON/XML/API/feed extension classes intentionally fail closed.
