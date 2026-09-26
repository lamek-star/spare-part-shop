# Spare Parts — roles and permissions

Authorization is decided **only on the server**. Every API route names the
permission it needs (`src/server/http/routes.ts`), and every domain service
method checks the same permission again (`requirePermission`), so a call that
bypasses a route still cannot exceed the caller's role. The UI hides actions a
role cannot use purely as a convenience.

The matrix below is generated from `src/server/domain/permissions.ts`; the
full list of routes and the permission each requires is in
[generated/API_ROUTES.md](generated/API_ROUTES.md). Both files are rebuilt by
`npm run docs:generate` and a test fails when they are stale.

## Roles

| Role          | Intended for                                                                                                                                                                         |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **OWNER**     | The shop owner. Everything, including managing users. At least one active Owner must always exist.                                                                                   |
| **ADMIN**     | Manager. Everything except managing users.                                                                                                                                           |
| **SALES**     | Counter/sales staff: customers, enquiries, quotations, orders, invoices, payments, sales reports, read-only catalogue/products/stock. **No cost prices, no purchasing, no imports.** |
| **INVENTORY** | Storekeeper/purchasing: products (including cost), stock, warehouses, purchase orders, inventory reports, supplier list. **No sales documents, no customers.**                       |
| **VIEWER**    | Read-only: catalogue, products (without cost), stock.                                                                                                                                |

See [generated/PERMISSIONS_MATRIX.md](generated/PERMISSIONS_MATRIX.md) for
the exact permission-by-role table.

## Data-level rules on top of permissions

- **Cost prices** (`products.cost.read`) are removed from every response for
  roles without the permission — list, detail, supplier links and search — not
  merely hidden in the UI.
- **Dashboard figures** are individually gated: inventory value needs
  `reports.financial`; sales figures need `reports.sales`; document counts need
  the matching `*.read` permission. A role never receives a number it may not
  see (the field is `null`).
- **Enquiry carts are personal.** A draft cart can be changed, submitted or
  cancelled only by its owner, or by an Owner/Admin.
- **Reference images** are served only while their recorded rights allow
  display, regardless of role.
- **Files** are served through `/files/:id` only for kinds the caller may read
  (product images need `products.read`; quotation PDFs `quotations.read`;
  invoice PDFs `invoices.read`); every other kind returns 404 there.
- **Users:** only `users.manage` (Owner) can create, disable, re-role or reset
  passwords. Disabling a user, changing their role or resetting their
  password ends their sessions immediately. Administrator-created accounts
  must change their temporary password at first sign-in.

## Session and request protection

| Control         | Behaviour                                                                                                                                                                                                                    |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Session cookie  | `sp_session`, random opaque token, only its SHA-256 is stored; `HttpOnly; SameSite=Lax`; `Secure` when the request arrived over HTTPS.                                                                                       |
| Lifetime        | 12 hours idle (sliding), 7 days absolute.                                                                                                                                                                                    |
| CSRF            | Every state-changing request needs the per-session `X-CSRF-Token` header (constant-time comparison) **and** a same-origin `Origin` (or one listed in `SPAREPARTS_ALLOWED_ORIGINS`). Login and setup are also origin-checked. |
| JSON bodies     | Must be `application/json` (forces a CORS pre-flight for cross-site callers) and ≤ 1 MB. Uploads have per-route limits. No CORS headers are ever sent.                                                                       |
| Sign-in abuse   | Account lockout after repeated failures (15-minute window) and a per-address limit on public POSTs. Failure messages do not reveal whether an email exists.                                                                  |
| Password policy | ≥ 10 characters, not all digits, not a common password, must not contain the email name. Hashed with scrypt (N=16384, r=8, p=1) and a per-user salt.                                                                         |
| Forced change   | Accounts created or reset by an administrator can only call `me`, `logout` and `password` until the password is changed.                                                                                                     |
| Errors          | Business errors carry a stable `code`; unexpected faults return a generic message plus a reference id and are logged server-side only.                                                                                       |

## Mapping to a future platform

When IntraForge provides identity, its roles must be mapped onto these five
roles (or onto the individual permissions). The mapping belongs inside the
`IdentityProvider` implementation; business code only ever sees an `Actor`
with a `role`. See [the integration contract](INTRAFORGE_INTEGRATION_CONTRACT.md).
