# Architecture

## Boundaries

Next.js App Router hosts a client-side operational application. Domain entities are separate from presentation. A Services interface groups catalogue, inventory, purchasing, sales, contacts, documents and management capabilities. The demo adapter owns validation, transitions and mutations. Views receive a service instance; no component calls fetch or storage directly.

## Consistency

Stock derives from immutable movement records; reservations derive from confirmed unfulfilled sales. Receipts and fulfillment validate all lines before committing. Transfers append paired movements atomically. Monetary totals round to currency precision. IDs are opaque and independent of displayed references.

## Persistence

Versioned local browser storage is temporary and single-user. It is not a concurrent database, authentication system or permanent backend. Adapter snapshots support isolated deterministic tests. Platform integration will replace persistence and supply transactions, identity, authorization and concurrency control.

## Design plan

Navy #172C40 navigation, teal #087F75 actions, slate #526478 text, white #FFFFFF work surfaces, grey #F2F5F8 background, amber #A56108 alerts. Segoe UI supports dense operational reading; numbers use tabular alignment. Left-aligned navigation and tables, restrained 6–10px radii, no decorative charts or gradients.

Layout: sidebar | breadcrumb/search header | title/actions | filters | operational content.
The catalogue number provenance and warehouse availability are emphasized over generic dashboard decoration.
