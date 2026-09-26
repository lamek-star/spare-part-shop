import test from "node:test";
import assert from "node:assert/strict";
import {
  parseMoney,
  toDecimalString,
  lineTotal,
  taxOn,
  documentTotals,
  percentToBp,
  formatMoney,
} from "../../src/server/kernel/money";

test("parseMoney is exact and strict", () => {
  assert.equal(parseMoney("12.34"), 1234);
  assert.equal(parseMoney("0.1"), 10);
  assert.equal(parseMoney("1,234.50"), 123450);
  assert.equal(parseMoney(19.99), 1999);
  assert.equal(parseMoney("-5"), -500);
  for (const bad of ["1.234", "1e3", "abc", "", "1.", ".5", "--1", "12 34"])
    assert.throws(() => parseMoney(bad), RangeError, bad);
});

test("binary floating point drift never reaches totals", () => {
  assert.equal(
    lineTotal({ quantity: 3, unitPrice: parseMoney("0.10"), discountBp: 0 }),
    30,
  );
  assert.equal(
    toDecimalString(
      lineTotal({ quantity: 7, unitPrice: parseMoney("19.99"), discountBp: 0 }),
    ),
    "139.93",
  );
});

test("discount and tax round half away from zero, once per line and once for tax", () => {
  assert.equal(lineTotal({ quantity: 1, unitPrice: 5, discountBp: 1000 }), 5); // 0.045 -> 0.05
  assert.equal(lineTotal({ quantity: 1, unitPrice: 1, discountBp: 5000 }), 1); // 0.005 -> 0.01
  assert.equal(taxOn(10, 500), 1); // 5% of 0.10 = 0.005 -> 0.01
  const t = documentTotals(
    [
      { quantity: 2, unitPrice: parseMoney("33.33"), discountBp: 0 },
      {
        quantity: 1,
        unitPrice: parseMoney("10.00"),
        discountBp: percentToBp(12.5),
      },
    ],
    500,
  );
  assert.deepEqual(t, {
    subtotal: 6666 + 875,
    tax: 377,
    total: 6666 + 875 + 377,
  });
});

test("invalid inputs are rejected and formatting is exact", () => {
  assert.throws(
    () => lineTotal({ quantity: 1.5, unitPrice: 1, discountBp: 0 }),
    RangeError,
  );
  assert.throws(
    () => lineTotal({ quantity: 1, unitPrice: 1, discountBp: 10001 }),
    RangeError,
  );
  assert.throws(() => percentToBp(Number.NaN), RangeError);
  assert.throws(() => percentToBp(1.005), RangeError);
  assert.equal(formatMoney(123456789), "AED 1,234,567.89");
  assert.equal(formatMoney(-5), "-AED 0.05");
});
