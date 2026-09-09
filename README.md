# Spare parts reference application

Separate development repository. IntraForge Core is neither imported nor modified.

## Run
Node 24 recommended. `npm install`, then `npm run dev`. Open http://localhost:3000.
Demo login is a local persona selector, not authentication. All catalogue references and fitments are unverified samples. Data is stored in this browser only.

## Architecture
React views → bounded typed services → demo adapter. Future integration lives in src/integrations/intraforge and needs an approved platform contract. No physical database assumptions or invented endpoints.

See docs/ARCHITECTURE.md, docs/BUSINESS_WORKFLOWS.md and docs/TESTING.md.
