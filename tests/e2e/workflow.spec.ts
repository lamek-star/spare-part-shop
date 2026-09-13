import { test, expect } from "@playwright/test";
test("number search to purchase receipt, customer sale and invoice", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Enter demo workspace" }).click();
  await page.getByRole("textbox", { name: "Global search" }).fill("044650K290");
  await page
    .locator(".search-results")
    .getByRole("button", { name: /Front brake pad set/ })
    .click();
  await page
    .getByRole("button", { name: "Cross References", exact: true })
    .last()
    .click();
  await expect(
    page.getByRole("cell", { name: "DEMO-OLD-001", exact: false }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Compatibility", exact: true })
    .click();
  await expect(page.getByRole("cell", { name: "Toyota Hilux" })).toBeVisible();
  await page
    .locator(".tabs")
    .getByRole("button", { name: "Inventory", exact: true })
    .click();
  await expect(
    page.getByRole("cell", { name: "Main Warehouse", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Purchasing", exact: true }).click();
  await page
    .getByRole("button", { name: "Purchase Orders", exact: true })
    .click();
  await page.getByRole("button", { name: "New purchase", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByLabel("quantity", { exact: true })
    .fill("10");
  await page.getByRole("button", { name: "Save draft" }).click();
  await page.locator("tbody tr").first().getByRole("button").first().click();
  await page.getByRole("button", { name: "Confirm purchase" }).click();
  await page
    .getByRole("button", { name: "Receive goods", exact: true })
    .click();
  await page.getByRole("button", { name: "Post goods receipt" }).click();
  await expect(page.locator(".order-detail .badge").first()).toHaveText(
    "Received",
  );
  await page.getByRole("button", { name: "Sales", exact: true }).click();
  await page.getByRole("button", { name: "Customers", exact: true }).click();
  await page.getByRole("button", { name: "New customer" }).click();
  await page.getByLabel("Company name").fill("Workflow Customer");
  await page.getByLabel("Email", { exact: true }).fill("workflow@example.com");
  await page.getByRole("button", { name: "Save customer" }).click();
  await expect(
    page.getByRole("cell", { name: "Workflow Customer", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Sales Orders", exact: true }).click();
  await page.getByRole("button", { name: "New sale" }).click();
  await page
    .getByRole("dialog")
    .getByLabel("Customer", { exact: true })
    .selectOption({ label: "Workflow Customer" });
  await page.getByRole("button", { name: "Save draft" }).click();
  await page.locator("tbody tr").first().getByRole("button").first().click();
  await page.getByRole("button", { name: "Confirm sales order" }).click();
  await page.getByRole("button", { name: "Fulfill order" }).click();
  await page.getByRole("button", { name: "Create invoice" }).click();
  await expect(
    page.getByRole("button", { name: "Print invoice" }),
  ).toBeVisible();
  await page.reload();
  await page.getByRole("textbox", { name: "Global search" }).fill("044650K290");
  await page
    .locator(".search-results")
    .getByRole("button", { name: /Front brake pad set/ })
    .click();
  await page
    .locator(".tabs")
    .getByRole("button", { name: "Inventory", exact: true })
    .click();
  const row = page.getByRole("row").filter({
    has: page.getByRole("cell", { name: "Main Warehouse", exact: true }),
  });
  await expect(row.getByRole("cell").nth(3)).toHaveText("9");
});
test("mobile navigation and dialog keyboard dismissal", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: "Enter demo workspace" }).click();
  await page.getByRole("button", { name: "New sale" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

test("transfer review preserves warehouse and quantity before posting", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Enter demo workspace" }).click();
  await page.getByRole("button", { name: "Inventory", exact: true }).click();
  await page.getByRole("button", { name: "Transfers", exact: true }).click();
  await page.getByRole("button", { name: "New transfer", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Part", { exact: true }).selectOption("part-2");
  await dialog.getByLabel("Destination warehouse").selectOption("wh-2");
  await dialog.getByLabel("Transfer quantity").fill("3");
  await dialog.getByLabel("Reason / notes").fill("Rebalance demo stock");
  await dialog.getByRole("button", { name: "Review transfer" }).click();
  await expect(dialog.getByLabel("Destination warehouse")).toHaveValue("wh-2");
  await expect(dialog.getByLabel("Transfer quantity")).toHaveValue("3");
  await dialog.getByRole("button", { name: "Confirm transfer" }).click();
  await expect(
    page.getByRole("cell", { name: "Rebalance demo stock" }),
  ).toHaveCount(2);
  await page.getByRole("button", { name: "Stock", exact: true }).click();
  const row = page
    .getByRole("row")
    .filter({
      has: page.getByRole("cell", { name: "Oil filter cartridge SP-00002" }),
    })
    .filter({
      has: page.getByRole("cell", { name: "Main Warehouse", exact: true }),
    });
  await expect(row.getByRole("cell").nth(3)).toHaveText("12");
});

test("mobile purchasing navigation exposes the operational screens", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: "Enter demo workspace" }).click();
  await page.getByRole("button", { name: "Purchasing", exact: true }).click();
  await page
    .getByRole("button", { name: "Purchase Orders", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Purchase Orders", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "New purchase" }).click();
  await expect(
    page.getByRole("dialog", { name: "Purchase", exact: true }),
  ).toBeVisible();
});

test("item image add, replace, primary selection and item edit persist", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Enter demo workspace" }).click();
  await page.getByRole("textbox", { name: "Global search" }).fill("SP-00001");
  await page.locator(".search-results button").first().click();
  await page.getByRole("button", { name: "Open item images" }).click();
  await page.getByRole("button", { name: "Zoom in", exact: true }).click();
  await expect(page.locator(".diagram-toolbar")).toContainText("150%");
  await page.getByRole("button", { name: "Fit image", exact: true }).click();
  const png = {
    name: "item.png",
    mimeType: "image/png",
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
      "base64",
    ),
  };
  const add = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Add image", exact: true }).click();
  await (await add).setFiles(png);
  await expect(
    page.getByRole("button", { name: "View image 2", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Make primary", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Make primary", exact: true }),
  ).toBeDisabled();
  const replace = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Replace selected image" }).click();
  await (await replace).setFiles({ ...png, name: "replacement.png" });
  await expect(page.locator(".diagram-canvas img")).toHaveAttribute(
    "src",
    /^data:image\/png/,
  );
  await page
    .getByRole("button", { name: "Edit item information", exact: true })
    .click();
  await page
    .getByLabel("Part name", { exact: true })
    .fill("Editable headlamp item");
  await page.getByRole("button", { name: "Save part", exact: true }).click();
  await expect(page.locator(".diagram-caption")).toContainText(
    "Editable headlamp item",
  );
  await page.reload();
  await page.getByRole("textbox", { name: "Global search" }).fill("SP-00001");
  await page.locator(".search-results button").first().click();
  await page.getByRole("button", { name: "Open item images" }).click();
  await expect(page.locator(".diagram-canvas img")).toHaveAttribute(
    "src",
    /^data:image\/png/,
  );
  await expect(page.locator(".diagram-caption")).toContainText(
    "Editable headlamp item",
  );
  await page.getByRole("button", { name: "Remove selected image" }).click();
  await expect(
    page.getByRole("button", { name: "Confirm remove image" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Confirm remove image" }).click();
  await expect(page.locator(".image-thumbnails button")).toHaveCount(1);
});

test("vehicle catalogue diagram adoption and OEM company search", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Enter demo workspace" }).click();
  await page
    .getByRole("button", { name: "Reference Catalogue", exact: true })
    .click();
  await page
    .getByLabel("Make", { exact: true })
    .selectOption({ label: "Mitsubishi" });
  await page
    .getByLabel("Model", { exact: true })
    .selectOption({ label: "Lancer Evolution IX" });
  await page
    .getByLabel("Variant", { exact: true })
    .selectOption("variant-ct9a");
  await page.getByLabel("Year", { exact: true }).fill("2006");
  await page.getByLabel("Engine", { exact: true }).selectOption("4G63");
  await page.getByLabel("Category", { exact: true }).selectOption("lighting");
  await page
    .getByRole("button", { name: /Open diagram: Headlamp assembly/ })
    .click();
  await page.getByRole("button", { name: "Callout C01", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Callout C01", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page
    .getByRole("button", { name: "View reference part", exact: true })
    .first()
    .click();
  await page
    .locator(".tabs")
    .getByRole("button", { name: "Part Numbers", exact: true })
    .click();
  await expect(
    page.getByRole("cell", { name: "DEMO-OE-HL-1", exact: true }),
  ).toBeVisible();
  await page
    .locator(".tabs")
    .getByRole("button", { name: "Cross References", exact: true })
    .click();
  await expect(
    page.getByRole("cell", { name: "ALTERNATIVE", exact: true }),
  ).toBeVisible();
  await page
    .locator(".tabs")
    .getByRole("button", { name: "Vehicle Compatibility", exact: true })
    .click();
  await expect(
    page.getByRole("cell", { name: /Mitsubishi Lancer Evolution IX/ }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Add to My Products", exact: true })
    .click();
  await page.getByLabel("Internal SKU", { exact: true }).fill("CAT-E2E-LENS");
  await page.getByLabel("Cost (AED)", { exact: true }).fill("80");
  await page.getByLabel("Selling price (AED)", { exact: true }).fill("140");
  await page
    .getByRole("button", { name: "Create My Product", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Open My Product", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Open reference catalogue record" }),
  ).toBeVisible();
  await page
    .getByRole("textbox", { name: "Global search" })
    .fill("DEMO OE HL 1");
  await expect(
    page
      .locator(".search-results")
      .getByRole("button")
      .filter({ hasText: "CAT-E2E-LENS" }),
  ).toBeVisible();
  await expect(
    page
      .locator(".search-results")
      .getByRole("button")
      .filter({ hasText: "Reference part" }),
  ).toBeVisible();
});

test("EPC diagram panel shows callout details, quick adoption and fullscreen", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Enter demo workspace" }).click();
  await page
    .getByRole("button", { name: "Reference Catalogue", exact: true })
    .click();
  await page
    .getByRole("button", { name: /Open diagram: Headlamp assembly/ })
    .click();
  await expect(
    page.getByRole("columnheader", { name: "Qty", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Callout C02", exact: true }).click();
  const panel = page.locator(".epc-selected-callout");
  await expect(panel).toContainText("Callout C02");
  await expect(panel).toContainText("Headlamp housing");
  await expect(panel).toContainText("DEMO-OE-HL-2");
  await expect(panel).toContainText("UNVERIFIED");
  await expect(
    panel.getByRole("button", { name: "Add to My Products", exact: true }),
  ).toBeVisible();
  const fullscreenButton = page.getByRole("button", {
    name: "Fullscreen",
    exact: true,
  });
  await fullscreenButton.click();
  await expect(
    page.getByRole("button", { name: "Exit fullscreen", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".epc-fullscreen")).toBeVisible();
  await page
    .getByRole("button", { name: "Exit fullscreen", exact: true })
    .click();
  await expect(page.locator(".epc-fullscreen")).toHaveCount(0);
  await panel
    .getByRole("button", { name: "Add to My Products", exact: true })
    .click();
  await page
    .getByLabel("Internal SKU", { exact: true })
    .fill("CAT-E2E-HOUSING");
  await page.getByLabel("Cost (AED)", { exact: true }).fill("60");
  await page.getByLabel("Selling price (AED)", { exact: true }).fill("110");
  await page
    .getByRole("button", { name: "Create My Product", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Open My Product", exact: true }),
  ).toBeVisible();
});
test("EPC part-number linked catalogue: diagram/list sync, zoom alignment and number search", async ({
  page,
}) => {
  // 1-2. Open Reference Catalogue, choose Toyota.
  await page.goto("/");
  await page.getByRole("button", { name: "Enter demo workspace" }).click();
  await page
    .getByRole("button", { name: "Reference Catalogue", exact: true })
    .click();
  await page
    .getByLabel("Make", { exact: true })
    .selectOption({ label: "Toyota" });
  // 3. Choose Corolla.
  await page
    .getByLabel("Model", { exact: true })
    .selectOption({ label: "Corolla" });
  // 4. Open Engine Filtration diagram.
  await expect(
    page.getByRole("button", { name: /Open diagram: Engine filtration/ }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: /Open diagram: Engine filtration/ })
    .click();
  // 5. See at least 6 diagram callouts.
  const hotspots = page.locator(".diagram-hotspot");
  await expect(hotspots).toHaveCount(8);
  // 6. Click callout 15601.
  await page
    .getByRole("button", { name: "Callout 15601", exact: true })
    .click();
  const panel = page.locator(".epc-selected-callout");
  await expect(panel).toContainText("Callout 15601");
  await expect(panel).toContainText("Engine oil filter");
  // 7. Verify corresponding part row highlights.
  const partsPanel = page.locator(".epc-parts-column");
  const oilFilterRow = partsPanel
    .getByRole("row")
    .filter({ has: page.getByRole("cell", { name: "Engine oil filter" }) });
  await expect(oilFilterRow).toHaveClass(/selected-table-row/);
  // 8. Verify OEM/demo part number is shown separately from the callout.
  await expect(panel).toContainText("DEMO-15601-0T001");
  await expect(
    page.getByRole("cell", { name: "DEMO-15601-0T001", exact: true }),
  ).toBeVisible();
  // 9. Click another part row (the bracket, which has multiple numbers).
  const bracketRow = partsPanel
    .getByRole("row")
    .filter({ has: page.getByRole("cell", { name: "Engine bracket" }) });
  await bracketRow.getByRole("cell", { name: "Engine bracket" }).click();
  // 10. Verify diagram selection changes to that callout.
  await expect(
    page.getByRole("button", { name: "Callout 12315", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Callout 15601", exact: true }),
  ).toHaveAttribute("aria-pressed", "false");
  const calloutHotspot = page.getByRole("button", {
    name: "Callout 12315",
    exact: true,
  });
  await expect(calloutHotspot).toHaveAttribute("aria-pressed", "true");
  await expect(panel).toContainText("DEMO-12315-0T001");
  await expect(panel).toContainText("Production 01/2019–12/2020");
  await expect(panel).toContainText("DEMO-12315-0T011");
  await expect(panel).toContainText("Production 01/2021–12/2023");
  // 11. Zoom.
  await page.getByRole("button", { name: "Zoom in", exact: true }).click();
  await expect(page.locator(".epc-diagram-panel .panel-head")).toContainText(
    "150%",
  );
  // 12. Verify callouts remain aligned/clickable after zoom.
  await page
    .getByRole("button", { name: "Callout 90080A", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Callout 90080A", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(panel).toContainText("Callout 90080A");
  await expect(panel).toContainText("Engine grommet");
  await page.getByRole("button", { name: "Fit", exact: true }).click();
  // 13. Search by the OEM part number, not the callout.
  await page
    .getByLabel("Search OEM, reference or description", { exact: true })
    .fill("DEMO-15601-0T001");
  await expect(
    page.getByRole("button", { name: "Open reference" }).first(),
  ).toBeVisible();
  await page.getByRole("button", { name: "Open reference" }).first().click();
  // 14. Verify the correct diagram/callout can be reached from the part.
  await page
    .locator(".tabs")
    .getByRole("button", { name: "Diagrams", exact: true })
    .click();
  const diagramLink = page.getByRole("button", {
    name: /Found in diagram: Engine filtration/,
  });
  await expect(diagramLink).toContainText("Callout: 15601");
  await diagramLink.click();
  await expect(
    page.getByRole("button", { name: "Callout 15601", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
});
test("CSV mapping staging publish and import permission boundary", async ({
  page,
  request,
}) => {
  const denied = await request.post("/api/catalogue", {
    headers: { "x-demo-role": "Sales" },
    data: { action: "stage", csv: "a\n1", mapping: {}, attested: true },
  });
  expect(denied.status()).toBe(403);
  await page.goto("/");
  await page.getByRole("button", { name: "Enter demo workspace" }).click();
  await page
    .getByRole("button", { name: "Catalogue Administration", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Import Batches", exact: true })
    .click();
  const number = "E2E-CSV-" + Date.now();
  const content =
    "maker,number,description,make,model,from,to\nDemo," +
    number +
    ",Imported fixture,Mitsubishi,Example,2005,2007";
  await page.getByLabel("Upload CSV").setInputFiles({
    name: "example.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(content),
  });
  for (const [field, column] of [
    ["manufacturer", "maker"],
    ["part_number", "number"],
    ["description", "description"],
    ["vehicle_make", "make"],
    ["vehicle_model", "model"],
    ["year_from", "from"],
    ["year_to", "to"],
  ])
    await page.getByLabel(field, { exact: true }).selectOption(column);
  await page
    .getByRole("checkbox", {
      name: "My organization may use this data internally.",
    })
    .check();
  await page.getByRole("button", { name: "Validate and stage" }).click();
  await expect(
    page.getByRole("cell").filter({ hasText: number }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Approve import — publish valid rows" })
    .click();
  await expect(page.locator(".batch-review")).toContainText("COMPLETED");
  await page.getByRole("textbox", { name: "Global search" }).fill(number);
  await expect(
    page
      .locator(".search-results")
      .getByRole("button")
      .filter({ hasText: "Reference part" }),
  ).toBeVisible();
});

test("purchase cancellation requires confirmation and blocks further receiving", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Enter demo workspace" }).click();
  await page.getByRole("button", { name: "Purchasing", exact: true }).click();
  await page
    .getByRole("button", { name: "Purchase Orders", exact: true })
    .click();
  await page.getByRole("button", { name: "New purchase", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByLabel("quantity", { exact: true })
    .fill("5");
  await page.getByRole("button", { name: "Save draft" }).click();
  await page.locator("tbody tr").first().getByRole("button").first().click();
  await page.getByRole("button", { name: "Cancel purchase" }).click();
  await page.getByRole("button", { name: "Keep order" }).click();
  await expect(page.locator(".order-detail .badge").first()).toHaveText(
    "Draft",
  );
  await page.getByRole("button", { name: "Cancel purchase" }).click();
  await page.getByRole("button", { name: "Yes, cancel order" }).click();
  await expect(page.locator(".order-detail .badge").first()).toHaveText(
    "Cancelled",
  );
  await expect(
    page.getByRole("button", { name: "Confirm purchase" }),
  ).toHaveCount(0);
});
test("sales persona remains outside import administration after reload", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("Demo persona").selectOption("Sales");
  await page.getByRole("button", { name: "Enter demo workspace" }).click();
  await expect(
    page.getByRole("button", { name: "Catalogue Administration", exact: true }),
  ).toHaveCount(0);
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Catalogue Administration", exact: true }),
  ).toHaveCount(0);
  await page.goto("/#catalogue-administration");
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Permission denied", exact: true }),
  ).toBeVisible();
});

test("Toyota EPC is disabled by default, makes no live data visible, and the admin governance panel is truthful", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Enter demo workspace" }).click();
  await page.getByRole("button", { name: "Toyota EPC", exact: true }).click();
  // Production default: TOYOTA_EPC_ENABLED is unset, so the page must show
  // a clean disabled state — never a crash, a raw error, or fabricated data.
  await expect(page.getByText("DISABLED", { exact: true })).toBeVisible();
  await expect(
    page.getByText("unverified redistribution permission required"),
  ).toBeVisible();
  await expect(page.getByText("Adapter status:")).toContainText("Ready");
  await expect(
    page.getByRole("link", { name: "Source terms" }),
  ).toHaveAttribute("href", "https://toyota-epc.aftermarketcatalog.com/legal");
  // No vehicle picker, search box or VIN box should render while disabled —
  // there is nothing legitimate to search or browse yet.
  await expect(page.getByPlaceholder("Search models…")).toHaveCount(0);
  await expect(page.getByPlaceholder("e.g. JTDKB20U903100000")).toHaveCount(0);
  // The admin governance panel must independently confirm the same
  // disabled/no-redistribution posture, server-enforced, not just this
  // page's own copy.
  await page
    .getByRole("button", { name: "Catalogue Administration", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Catalogue Providers", exact: true })
    .click();
  const toyotaRow = page
    .getByRole("row")
    .filter({ hasText: "Toyota parts catalogue" });
  await expect(toyotaRow).toContainText(
    "UNVERIFIED_REDISTRIBUTION_PERMISSION_REQUIRED",
  );
  await expect(toyotaRow).toContainText("Bulk sync no");
  await expect(toyotaRow).toContainText("Persistent no");
  await expect(toyotaRow).toContainText("VIN lookup");
  await expect(toyotaRow.getByRole("cell").nth(5)).toHaveText("No");
});
