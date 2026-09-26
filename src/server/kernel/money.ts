/**
 * Authoritative money arithmetic: integers in the currency's minor unit
 * (fils for AED), never binary floating point. Rates and discounts are
 * integer basis points (1% = 100 bp). Rounding is half away from zero,
 * applied once per line and once for tax, so totals are reproducible and
 * every printed document adds up exactly.
 */
export type Minor = number; // safe integer, minor units
export const MINOR_DIGITS = 2;
const FACTOR = 10 ** MINOR_DIGITS;

/** Parses "12", "12.3", "12.34" (also with a thousands comma) into minor
 * units. Rejects more than two decimals, exponents, signs other than a
 * leading minus, and anything that is not a plain decimal number. */
export function parseMoney(input: string | number): Minor {
  const text = typeof input === "number" ? String(input) : input.trim();
  if (typeof input === "number" && !Number.isFinite(input))
    throw new RangeError("Amount must be a finite number.");
  const cleaned = text.replace(/,/g, "");
  const match = /^(-)?(\d+)(?:\.(\d{1,2}))?$/.exec(cleaned);
  if (!match)
    throw new RangeError(
      `"${input}" is not a valid amount (use at most 2 decimals).`,
    );
  const whole = Number(match[2]);
  const cents = Number((match[3] ?? "").padEnd(MINOR_DIGITS, "0") || "0");
  const value = whole * FACTOR + cents;
  if (!Number.isSafeInteger(value))
    throw new RangeError("Amount is too large.");
  return match[1] ? -value : value;
}
export function formatMoney(minor: Minor, currency = "AED"): string {
  const sign = minor < 0 ? "-" : "";
  const abs = Math.abs(minor);
  const whole = Math.trunc(abs / FACTOR).toLocaleString("en-US");
  const cents = String(abs % FACTOR).padStart(MINOR_DIGITS, "0");
  return `${sign}${currency} ${whole}.${cents}`;
}
/** Decimal string with exactly two places, e.g. 1234 -> "12.34". */
export function toDecimalString(minor: Minor): string {
  const sign = minor < 0 ? "-" : "";
  const abs = Math.abs(minor);
  return `${sign}${Math.trunc(abs / FACTOR)}.${String(abs % FACTOR).padStart(MINOR_DIGITS, "0")}`;
}
/** Divides a BigInt numerator by a positive BigInt denominator, rounding
 * half away from zero. */
function divRound(numerator: bigint, denominator: bigint): bigint {
  const negative = numerator < 0n;
  const abs = negative ? -numerator : numerator;
  const q = (abs * 2n + denominator) / (denominator * 2n);
  return negative ? -q : q;
}
const toNumber = (v: bigint): number => {
  const n = Number(v);
  if (!Number.isSafeInteger(n)) throw new RangeError("Amount is too large.");
  return n;
};
export interface LineInput {
  quantity: number; // whole units
  unitPrice: Minor;
  discountBp: number; // 0..10000
}
export function lineTotal({
  quantity,
  unitPrice,
  discountBp,
}: LineInput): Minor {
  if (!Number.isInteger(quantity) || quantity < 0)
    throw new RangeError("Quantity must be a whole number.");
  if (!Number.isInteger(discountBp) || discountBp < 0 || discountBp > 10000)
    throw new RangeError("Discount must be between 0% and 100%.");
  const gross = BigInt(quantity) * BigInt(unitPrice);
  return toNumber(divRound(gross * BigInt(10000 - discountBp), 10000n));
}
export function taxOn(subtotal: Minor, taxBp: number): Minor {
  if (!Number.isInteger(taxBp) || taxBp < 0 || taxBp > 100000)
    throw new RangeError("Tax rate is out of range.");
  return toNumber(divRound(BigInt(subtotal) * BigInt(taxBp), 10000n));
}
export interface DocumentTotals {
  subtotal: Minor;
  tax: Minor;
  total: Minor;
}
export function documentTotals(
  lines: LineInput[],
  taxBp: number,
): DocumentTotals {
  const subtotal = lines.reduce((sum, l) => sum + lineTotal(l), 0);
  const tax = taxOn(subtotal, taxBp);
  return { subtotal, tax, total: subtotal + tax };
}
/** Whole-percent number a user types (e.g. 7.5) -> basis points. */
export function percentToBp(percent: number): number {
  if (!Number.isFinite(percent))
    throw new RangeError("Percent must be a number.");
  const bp = Math.round(percent * 100);
  if (Math.abs(bp / 100 - percent) > 1e-9)
    throw new RangeError("Use at most 2 decimals for a percentage.");
  return bp;
}
