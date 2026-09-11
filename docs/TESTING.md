# Testing

## Commands

- `npm run typecheck`: strict TypeScript validation.
- `npm test`: Node test runner through tsx, service and component tests.
- `npm run test:e2e`: Playwright using installed Google Chrome, starts an isolated local Next.js server on port 3100.
- `npm run build`: production compilation and static route generation.
- `npm run format:check`: source formatting.

## Covered invariants

Normalized number matching without destructive display edits; duplicate OEM values across brands; circular supersession rejection; partial receipts; over-receipt rollback; stock reservation, fulfillment, invoicing and payment; return ceilings; conservation across transfers; protection of reserved stock; failed-persistence rollback; currency rounding; table empty state and visible status semantics; purchase/sales order cancellation boundaries (allowed before receipt/fulfillment, refused after, reservations released on sale cancellation); reference catalogue breadth across multiple makes/variants.

## Browser reference scenario

Enter demo persona → search 044650K290 → inspect reference chain → inspect compatibility → inspect stock → create/confirm purchase → receive 10 units → create customer → create/confirm/fulfill sale → invoice → reload and verify 9 units remain. Mobile test checks 390px layout and Escape dismissal of native dialogs.

## Boundaries

Automated tests use deterministic isolated seed state. Local browser storage is single-user, with no multi-client concurrency guarantees. Auth, remote API errors, platform permission enforcement, provider URLs and backend transactions need integration tests when the approved platform contract arrives. The generic error boundary and adapter error surfaces are implemented now. This is a reference app, not a production deployment certification.

The expanded browser suite also verifies transfer review preserves entered warehouse/quantity values, paired transfer records appear, the source balance changes correctly, purchasing navigation works at mobile width, and purchase cancellation requires an on-screen confirmation before taking effect. The current suite contains 31 unit/service tests and nine browser tests. Catalogue coverage includes CSV mapping, validation, conflicts, stale publication, retry/idempotence, source provenance, company separation, image rights, explicit cross references, paginated search, diagram callouts, adoption, persistent demo role restrictions, and multi-make/multi-variant browsing. Playwright uses .next-e2e and .catalogue-test-data; normal reference data is not used.
