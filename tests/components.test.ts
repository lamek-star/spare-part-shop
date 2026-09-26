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
import OEMFigureViewer from "../src/components/OEMFigureViewer";
import { normalizeNumber } from "../src/domain/models";
const viewerFigure = {
  figure_key: "MAB135F",
  catalog: { region: "EU", catalog_code: "1" },
  hotspots: [
    {
      label: "15690",
      pnc: "15690",
      resolved: true,
      rect: { x: 1, y: 1, width: 10, height: 5 },
    },
    {
      label: "90301",
      pnc: "90301",
      resolved: false,
      rect: { x: 2, y: 2, width: 4, height: 4 },
    },
  ],
  groups: [
    {
      callout: "15690",
      pnc: "15690",
      name: "VALVE ASSY, OIL COOLER RELIEF",
      rect: { x: 1, y: 1, width: 10, height: 5 },
      rows: [
        {
          part_number: "15690-65010",
          description: "VALVE ASSY, OIL COOLER RELIEF",
          valid_from: "1988-08",
          valid_to: "1989-08",
          is_current: false,
          fitment: ["3VZE", "VZN85,90", "HLF", "ATM", "X1", "X2"].map(
            (code) => ({
              code,
              meaning: null,
            }),
          ),
          has_remarks: true,
        },
        {
          part_number: "15690-65010",
          description: "VALVE ASSY, OIL COOLER RELIEF",
          valid_from: "1989-08",
          valid_to: null,
          is_current: true,
          fitment: [],
          has_remarks: false,
        },
      ],
    },
  ],
};
function renderViewer(imageUrl: string) {
  return renderToStaticMarkup(
    createElement(OEMFigureViewer, {
      figure: viewerFigure,
      diagramCode: "MAB135F",
      provider: "toyota-epc",
      imageUrl,
      stored: false,
      sourceImageUrl: "https://example.test/MAB135F.png",
      highlight: normalizeNumber("15690-65010"),
      normalize: normalizeNumber,
      onAdd: () => {},
      addedKeys: new Set<string>(),
      stockOf: () => null,
    }),
  );
}
test("figure viewer lists every part line under its callout, like a parts catalogue page", () => {
  const html = renderViewer("");
  assert.match(html, /2 parts on this figure/);
  assert.equal(html.match(/15690-65010/g)?.length, 2); // both production lines
  assert.match(html, /Valve Assy, Oil Cooler Relief/);
  assert.match(html, /1988-08 → 1989-08/);
  assert.match(html, /1989-08 → present/);
  assert.equal(html.match(/>ended</g)?.length, 1); // only the ended line
  assert.match(html, />note</);
  assert.match(html, />\+2</); // 6 fitment codes: 4 shown, +2
  assert.equal(html.match(/>Add</g)?.length, 2);
  assert.match(html, /1 callout, 1 unlisted/);
  assert.match(html, /standard fasteners/);
});
test("figure viewer withholds the drawing unless an image URL is supplied", () => {
  assert.doesNotMatch(renderViewer(""), /<img/);
  assert.match(renderViewer(""), /Drawing not shown/);
  assert.match(renderViewer("https://example.test/MAB135F.png"), /<img/);
});
