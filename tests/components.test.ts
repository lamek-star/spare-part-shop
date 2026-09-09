import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Table, Badge } from "../src/components/ui";
test("empty tables retain column headings and useful empty-state copy", () => {
  const html = renderToStaticMarkup(
    createElement(Table, { headers: ["Part", "Stock"], rows: [] }),
  );
  assert.match(html, /<th>Part<\/th>/);
  assert.match(html, /No matching records/);
});
test("status badge communicates its state in text", () => {
  const html = renderToStaticMarkup(
    createElement(Badge, { children: "Out of stock" }),
  );
  assert.match(html, /Out of stock/);
  assert.match(html, /red/);
});
