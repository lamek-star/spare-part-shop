# Spare Parts ↔ IntraForge — integration contract

**Status: contract only. Nothing here is implemented against IntraForge.**
This phase changed only the Spare Parts repository; the IntraForge platform
(`C:\Users\Hp\projects\intra-cloude`) was neither edited nor rebuilt, and its
source was not needed to write this page: the contract is derived from what
Spare Parts calls, and states what a platform implementation must provide.

The provider interfaces live in `src/server/providers/`:

- `core.ts` — `IdentityProvider`, `AuditProvider`, `FileStorage`, `ConfigurationProvider`
- `data.ts`, `sales.ts`, `catalogue.ts` — repositories
- `uow.ts` — `Repositories`, `UnitOfWork`, `Providers`
- `contracts.ts` — the business-named aliases below (`CustomerRepository`, …)

The composition root is `src/server/standalone/container.ts`
(`createContainer`). A platform build supplies another container that returns
the same `Providers` (`{ uow, identity }` plus the `Repositories` the unit of
work hands out). Business code (`src/server/domain`, `src/server/catalogue`)
does not change.

## 0. Ground rules for any implementation

1. **Transaction boundary.** `UnitOfWork.write(fn)` must make everything `fn`
   does — repository writes, file registrations, audit events — commit or roll
   back **together**; `read(fn)` must see a consistent snapshot. Nested calls
   join the outer unit. If the platform cannot give one transaction across
   data and audit, audit events must be written in the same store as the data.
2. **Concurrency.** The standalone build serializes writes. A platform
   implementation must give equivalent guarantees for: stock (`on_hand`,
   `reserved` may never go negative / exceed), document numbering (gap-free
   enough, never duplicated), and payments (never exceed invoice balance).
3. **Errors.** Throw `AppError(code, message, status)` (`src/server/kernel/errors.ts`).
   Codes in use: `VALIDATION` 400, `UNAUTHENTICATED` 401, `BAD_CREDENTIALS`
   401, `FORBIDDEN` 403, `PASSWORD_CHANGE_REQUIRED` 403, `NOT_FOUND` 404,
   `METHOD_NOT_ALLOWED` 405, `CONFLICT` 409, `STALE` 409,
   `ALREADY_IMPORTED` 409, `PAYLOAD_TOO_LARGE` 413,
   `UNSUPPORTED_MEDIA_TYPE` 415, `RATE_LIMITED` / sign-in lockout 429.
   Anything that is not an `AppError` is treated as an unexpected fault
   (generic 500 with a reference id, detail logged server-side only).
4. **Money** is integer minor units; percentages are basis points. Do not
   introduce floating point at any boundary.
5. **Ids** are opaque strings (UUIDs today). **Timestamps** are ISO-8601 UTC
   strings. **Dates** without time are `YYYY-MM-DD`.
6. **Secrets never cross the seam**: no password hashes in `Actor`, no tokens
   in audit metadata.

## 1. Provider map

| Standalone provider                               | Replaced by (IntraForge)                        | Interface                                                                                               | Section |
| ------------------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ------- |
| `LocalIdentityProvider` (users, sessions, scrypt) | Platform identity / SSO                         | `IdentityProvider`                                                                                      | 2       |
| `LocalFileStorage` (disk + `files` table)         | Platform document/object storage                | `FileStorage`                                                                                           | 3       |
| `SqliteAuditProvider`                             | Platform audit trail                            | `AuditProvider`                                                                                         | 4       |
| `SqliteConfigurationProvider` (+ sequences)       | Platform tenant settings + numbering            | `ConfigurationProvider`                                                                                 | 5       |
| `SqliteProductRepository`                         | Platform item/product master                    | `ProductRepository`                                                                                     | 6       |
| `SqliteInventoryRepository`                       | Platform stock ledger                           | `InventoryRepository`                                                                                   | 6       |
| `SqliteMasterDataRepository`                      | Platform parties, warehouses                    | `CustomerRepository`, `SupplierRepository`, `WarehouseRepository` (+ branches)                          | 6       |
| `SqliteSalesRepository`                           | Platform sales documents                        | `EnquiryRepository`, `QuotationRepository`, `OrderRepository`, `InvoiceRepository`, `PaymentRepository` | 6       |
| `SqlitePurchasingRepository`                      | Platform purchasing                             | `PurchasingRepository`                                                                                  | 6       |
| `SqliteReportRepository`                          | Platform reporting (or derived)                 | `ReportRepository`                                                                                      | 6       |
| `SqliteCatalogueRepository`                       | Platform catalogue store                        | `CatalogueStorageProvider` (= `CatalogueRepository`, `CatalogueWriter`)                                 | 7       |
| CSV / package / manual importers                  | unchanged (they emit through `CatalogueWriter`) | `CatalogueProvider` registry                                                                            | 7       |

## 2. IdentityProvider

```ts
signIn({ email, password, ip, userAgent }): Promise<{ token: string; session: AuthenticatedSession }>
authenticate(token): Promise<AuthenticatedSession | null>
signOut(token): Promise<void>
changePassword(userId, currentPassword, newPassword): Promise<void>
hasAnyUser(): Promise<boolean>
createUser(actor | null, NewUser): Promise<UserRecord>
listUsers(): Promise<UserRecord[]>
updateUser(actor, id, patch): Promise<UserRecord>
```

- **Data contract.** `AuthenticatedSession = { actor: {id, email, displayName, role}, sessionId, csrfToken, mustChangePassword }`.
  `role` ∈ `OWNER | ADMIN | SALES | INVENTORY | VIEWER`. The platform maps its
  own roles/permissions onto these (see
  [permissions](SPARE_PARTS_PERMISSIONS.md)); the mapping lives inside the
  provider.
- **SSO variant.** `signIn`/`changePassword`/`createUser`/`updateUser` may be
  no-ops or redirects; the HTTP layer needs only `authenticate(token)` to
  resolve the platform session (cookie or bearer, decided by the transport
  adapter) into an `Actor`, plus a `csrfToken` for state-changing calls (or the
  transport can substitute its own CSRF scheme in `http/core.ts`).
- **Errors.** `BAD_CREDENTIALS` (401) with a message that does not reveal
  whether the account exists; 429 on lockout.
- **Permissions.** `createUser`/`updateUser`/`listUsers` are only reached after
  the `users.manage` check in `domain/app.ts`.
- **Migration.** Existing `users` rows carry no external id. Provide a one-off
  script that maps `email → platform user id`, then re-keys `created_by`
  columns and audit `actor_id` (they are plain strings, not foreign keys).
  Passwords are scrypt hashes and cannot be imported into another system;
  users must set a platform password or use SSO.
- **Invariants to keep.** Disabled users lose sessions immediately; the last
  active Owner cannot be removed or demoted.

## 3. FileStorage

```ts
put({ bytes, originalName, mime, kind, entityType?, entityId?, createdBy? }): Promise<StoredFile>
get(id): Promise<{ file: StoredFile; bytes: Uint8Array } | null>
meta(id): Promise<StoredFile | null>
listFor(entityType, entityId, kind?): Promise<StoredFile[]>   // newest first
delete(id): Promise<void>
listOrphans(): Promise<StoredFile[]>                          // unreferenced PRODUCT_IMAGE files
```

- **Data contract.** `StoredFile = { id, originalName, mime, size, sha256, kind, entityType, entityId, createdAt }`.
  Kinds in use: `PRODUCT_IMAGE`, `CATALOGUE_DRAWING`, `QUOTATION_PDF`,
  `INVOICE_PDF`. `originalName` is display metadata only; **never** derive a
  storage path from it. The provider generates the key.
- **File handling rules the callers rely on.** MIME and content type are
  validated by the caller (sniffed from bytes); the provider must still
  reject empty content, store the SHA-256, and verify it on `get` (throw on
  mismatch). Callers enforce size limits (images 8 MB, drawings 64 MB).
  Served files must be delivered with `X-Content-Type-Options: nosniff` and,
  for images, a sandboxing CSP (done in `http/core.ts`).
- **Transaction.** `put` inside `UnitOfWork.write` should be undone if the
  unit rolls back (or produce an orphan that `listOrphans`/cleanup can find).
- **Migration.** Export `files` rows + `files/` blobs (the backup format is a
  ready-made manifest: `backup.json` with SHA-256s) and re-`put` them, then
  rewrite `product_images.file_id`, `assets.file_id` and document links.

## 4. AuditProvider

```ts
record(actor: { id: string | null; displayName?: string }, { action, entityType, entityId?, summary, metadata? }): Promise<void>
query({ entityType?, entityId?, actorId?, limit?, before? }): Promise<AuditEvent[]>
```

`record` is called **inside** the caller's transaction. Metadata is a small
JSON object and must never contain secrets. Action names are stable strings
(`product.create`, `stock.adjust`, `invoice.void`, `catalogue.package.import`,
`user.password_change` …; see `tests/server/http.test.ts` for the checked
ones). `query` is newest-first; `before` is an ISO timestamp cursor.

## 5. ConfigurationProvider

```ts
get(): Promise<ShopConfig>             // shopName, address, phone, email, taxRegistration, currency, defaultTaxBp, quotationValidityDays, invoiceDueDays, quotationTerms, invoiceNotes
update(actor, patch): Promise<ShopConfig>
nextNumber(sequence, prefix): Promise<string>   // "QUO-2026-000001" — atomic, per-year
nextCode(sequence, prefix): Promise<string>     // "CUS-000001"     — atomic, permanent
```

`shopName` is never hard-coded anywhere; a platform tenant name maps to it.
`nextNumber/nextCode` must be atomic with the transaction that uses the
number. Sequences in use: `enquiry ENQ`, `quotation QUO`, `order SO`,
`invoice INV`, `purchase PO`, `receipt GRN`, `return RET`, and codes
`customer CUS`, `supplier SUP`, `warehouse WH`.

## 6. Data repositories

The method lists are the interface definitions in `providers/data.ts` and
`providers/sales.ts`; `providers/contracts.ts` names the subsets:

| Alias                 | Methods                                                                                                                                                               |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CustomerRepository`  | `listCustomers getCustomer insertCustomer updateCustomer`                                                                                                             |
| `SupplierRepository`  | `listSuppliers getSupplier insertSupplier updateSupplier`                                                                                                             |
| `WarehouseRepository` | `listWarehouses getWarehouse insertWarehouse updateWarehouse listLocations getLocation insertLocation updateLocation`                                                 |
| `ProductRepository`   | `list get getBySku findByNormalizedNumber insert update categories numbers upsertNumber removeNumber suppliers … images … links linksForReference addLink removeLink` |
| `InventoryRepository` | `balance balances applyDelta insertMovement listMovements insertReservation activeReservations closeReservation fulfillReservation reservationsFor verifyIntegrity`   |
| `EnquiryRepository`   | `insertEnquiry saveEnquiry getEnquiry listEnquiries draftEnquiryFor`                                                                                                  |
| `QuotationRepository` | `insertQuotation saveQuotation getQuotation listQuotations quotationsForEnquiry`                                                                                      |
| `OrderRepository`     | `insertOrder saveOrder getOrder listOrders orderForQuotation insertReturn returnsForOrder listReturns`                                                                |
| `InvoiceRepository`   | `insertInvoice saveInvoice getInvoice listInvoices invoicesForOrder`                                                                                                  |
| `PaymentRepository`   | `insertPayment paymentsForInvoice`                                                                                                                                    |

Contract notes:

- **Business rules stay in the domain services**, not the repositories. A
  platform repository is a store: it must not re-implement reservation,
  invoicing or rounding rules (and must not "helpfully" recompute totals).
- **Inventory** must guarantee, atomically, `0 ≤ reserved ≤ on_hand` per
  (product, location) in `applyDelta`, keep movements immutable, and support
  `verifyIntegrity()` (recompute balances from movements and reservations,
  return disagreements).
- **Payments** are immutable and append-only; **movements** likewise.
- **Permissions** are checked in the services before a repository is called;
  repositories perform no authorization. Cost masking is done by the product
  service (`mask`), so a repository may return the stored cost.
- **Pagination**: `{ items, total, page, pageSize }`; `q` is a
  case-insensitive substring/normalized-number search; wildcards in `q` are
  literal.
- **Migration.** Export tables in dependency order (see
  [generated/SCHEMA.md](generated/SCHEMA.md)); ids, numbers and codes must be
  preserved because documents and PDFs refer to them. Stock balances are
  derived: import the movement ledger (or one OPENING_BALANCE movement per
  balance) and let `verifyIntegrity` confirm.

## 7. Catalogue

`CatalogueStorageProvider` = `CatalogueRepository` (search, part/drawing
reads, browse, stats, sources, assets, import-job and row bookkeeping,
`writer()`, `attempt()` savepoints) and `CatalogueWriter` (idempotent
`ensure*/upsert*/record*` writes, `saveAsset`, `attachAssetToDrawing`,
`refreshSearch`). Contract notes:

- **Search** must rank exact then prefix number matches ahead of text
  matches, treat any input (quotes, `*`, `NEAR(`, NUL) as data, and accept a
  part number in any format (`90915-10009`, `9091510009`, `90915 10009`).
- **Idempotency**: every writer method is a get-or-create keyed as documented
  in [data model](SPARE_PARTS_DATA_MODEL.md); re-running an import creates no
  duplicates.
- **Images**: `assets.file_id` points into `FileStorage`; serving is gated by
  rights (`displayableRights`), independent of the repository.
- **`CatalogueProvider` registry** (`contracts.ts`): CSV, offline package and
  manual are implemented; online providers are declared but **not shipped**.
  A platform-hosted catalogue can feed the same `CatalogueWriter`.
- **Migration.** Export an offline package (the format in
  [CATALOGUE_IMPORT.md](CATALOGUE_IMPORT.md)) — it round-trips parts,
  fitments, supersessions, drawings, hotspots and images with checksums — and
  import it on the platform side.

## 8. Reports

`ReportRepository` methods are read-only aggregates (`dashboard`,
`stockLevels`, `stockOnHand`, `lowStock`, `inventoryValuation`,
`salesByPeriod`, `salesByProduct`, `customerActivity`, `outstandingInvoices`,
`quotationConversion`, `supplierOverview`, `productSales`). They may be
implemented over platform reporting; figures must stay on the documented
basis: sales on an invoiced (non-void) basis, cash on a payments-received
basis, inventory value at cost.

## 9. HTTP surface a launcher can rely on

`/api/v1/*` (see [generated/API_ROUTES.md](generated/API_ROUTES.md)) is
same-origin JSON: `{ "data": … }` on success and
`{ "error": { code, message, requestId } }` on failure, with the permission
each route needs. A future "launch from IntraForge" only has to establish a
session that `IdentityProvider.authenticate` accepts, then send the user to
`/`. Not implemented.

## 10. Adapter checklist (for the later phase)

1. Implement `IdentityProvider` over platform sessions; map roles.
2. Implement `FileStorage` (kinds above; SHA-256 verify on read).
3. Implement `AuditProvider` and `ConfigurationProvider` (atomic numbering).
4. Implement the repositories one alias at a time; run
   `tests/server/*.test.ts` against the new container (`makeApp` builds a
   container — parametrize it) — the suites are the executable contract.
5. Write the migration scripts in sections 2, 3 and 6 and rehearse them on a
   restored backup (`npm run backup` / `restore`).
6. Switch the composition root (`getContainer`) — and only then remove the
   standalone providers.
