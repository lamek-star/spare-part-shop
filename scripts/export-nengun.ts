import { writeFileSync } from "node:fs";
import { seed } from "../src/adapters/seed";
import {
  mergeNengunCatalogue,
  rows,
  sourceUrl,
  diagramUrl,
  observedAt,
} from "../src/data/nengun-headlamp";
const s = mergeNengunCatalogue(seed());
const parts = s.parts.filter((p) => p.catalogueSource);
const numbers = s.numbers.filter((n) => n.verification === "Supplier listed");
const ids = new Set(parts.map((p) => p.id));
const fitments = s.compatibility.filter((c) => ids.has(c.partId));
writeFileSync(
  "public/catalogue/nengun-headlamp.json",
  JSON.stringify(
    {
      sourceUrl,
      diagramUrl,
      observedAt,
      parts,
      numbers,
      fitments,
      vehicles: s.vehicles.filter((v) =>
        fitments.some((c) => c.vehicleId === v.id),
      ),
    },
    null,
    2,
  ),
);
const headers = [
  "OEM number",
  "Diagram code",
  "Description",
  "JPY quote",
  "Supplier status",
  "Quantity required",
  "Applicability as published",
  "Specification",
  "Replacement",
  "Captured",
  "Source",
];
const records = parts.map((p) => {
  const source = p.catalogueSource!;
  const number = p.sku.replace("MIT-", "");
  return [
    number,
    source.diagramCode,
    p.name,
    source.priceJpy ?? "",
    source.availability,
    source.quantityRequired ?? "",
    source.applicability,
    source.specification,
    rows.find((r) => r[0] === number)?.[8] ?? "",
    observedAt,
    source.diagramUrl,
  ];
});
writeFileSync(
  "public/catalogue/nengun-headlamp.csv",
  "\uFEFF" +
    [headers, ...records]
      .map((r) =>
        r.map((c) => '"' + String(c).replaceAll('"', '""') + '"').join(","),
      )
      .join("\r\n"),
);
