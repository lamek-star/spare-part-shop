# Spare parts reference application

Separate development repository. IntraForge Core is neither imported nor modified.

## Run

Node 24 recommended. `npm install`, then `npm run dev`. Open http://localhost:3000.
Demo login is a local persona selector, not authentication. All catalogue references and fitments are unverified samples. Data is stored in this browser only.

## Architecture

React views → bounded typed services → demo adapter. Future integration lives in src/integrations/intraforge and needs an approved platform contract. No physical database assumptions or invented endpoints.

See docs/ARCHITECTURE.md, docs/BUSINESS_WORKFLOWS.md and docs/TESTING.md.

## Reference status

**SPARE PARTS REFERENCE APP READY FOR INTRAFORGE ADAPTER**

The local reference workflows are implemented and tested. The actual IntraForge API adapter awaits the main platform's approved contract. See [readiness and boundaries](docs/READINESS.md).

Quick walkthrough: enter the demo, search `044650K290`, inspect references and stock, create a purchase for that part, receive stock, create a customer and sales order, confirm and fulfill, then issue/print the invoice. Seed part 1 intentionally starts out of stock so receiving demonstrates the balance change.

Validation: 13 service/component tests and four Playwright browser tests, plus strict type checking and production build.

Use `npm ci` to reproduce the locked dependency installation. For a production build locally, run `npm run build` then `npm start`. The local server binds to 127.0.0.1.

## Catalogue foundation extension

Reference catalogue/import architecture is documented in [docs/catalogues/FOUNDATION.md](docs/catalogues/FOUNDATION.md). Open Reference Catalogue for vehicle/number browsing and Add to My Products. Owner/Administrator can open Catalogue Administration for the CSV pipeline. Source collection from Nengun is disabled pending permission; its former copied image is no longer served.

Future platform capability requirements are recorded in [docs/INTRAFORGE_PLATFORM_REQUIREMENTS.md](docs/INTRAFORGE_PLATFORM_REQUIREMENTS.md). The reference backend is a local development adapter; it is not a production million-record store or authentication service.
