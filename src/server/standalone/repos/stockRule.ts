/**
 * The one rule for "this product needs ordering", shared by the dashboard's Low stock tile, the products list's
 * "Low stock only" filter, the low-stock report and the Stock status panel, so they always agree.
 *
 * Both fragments expect the products table to be aliased `p`. Available stock is on hand minus reserved, from the
 * stock ledger's balances (ADR-0016: never computed in the browser).
 */
export const AVAILABLE_SQL = `COALESCE((SELECT SUM(b.on_hand - b.reserved) FROM stock_balances b WHERE b.product_id = p.id), 0)`;

/**
 * An active product that is red or amber on the dashboard: none left, at or below its minimum, or at or below its
 * reorder level. A product with no levels set needs ordering only once it has none left.
 */
export const NEEDS_ORDERING_SQL = `p.status = 'ACTIVE' AND (
  ${AVAILABLE_SQL} <= 0
  OR (p.minimum_level > 0 AND ${AVAILABLE_SQL} <= p.minimum_level)
  OR (p.reorder_level > 0 AND ${AVAILABLE_SQL} <= p.reorder_level))`;
