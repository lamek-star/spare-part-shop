# Testing

## Commands

- `npm run typecheck`: strict TypeScript validation.
- `npm test`: Node test runner through tsx, service and component tests.
- `npm run test:e2e`: Playwright using installed Google Chrome, starts a local Next.js server when needed.
- `npm run build`: production compilation and static route generation.
- `npm run format:check`: source formatting.

## Covered invariants

Normalized number matching without destructive display edits; duplicate OEM values across brands; circular supersession rejection; partial receipts; over-receipt rollback; stock reservation, fulfillment, invoicing and payment; return ceilings; conservation across transfers; protection of reserved stock; failed-persistence rollback; currency rounding; table empty state and visible status semantics.

## Browser reference scenario

Enter demo persona → search 044650K290 → inspect reference chain → inspect compatibility → inspect stock → create/confirm purchase → receive 10 units → create customer → create/confirm/fulfill sale → invoice → reload and verify 9 units remain. Mobile test checks 390px layout and Escape dismissal of native dialogs.

## Boundaries

Automated tests use deterministic isolated seed state. Local browser storage is single-user, with no multi-client concurrency guarantees. Auth, remote API errors, platform permission enforcement, provider URLs and backend transactions need integration tests when the approved platform contract arrives. The generic error boundary and adapter error surfaces are implemented now. This is a reference app, not a production deployment certification.

The expanded browser suite also verifies transfer review preserves entered warehouse/quantity values, paired transfer records appear, the source balance changes correctly, and purchasing navigation works at mobile width. The current suite contains 13 component/service tests and four browser tests. All passed on 9 September 2026.
