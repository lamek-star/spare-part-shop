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
