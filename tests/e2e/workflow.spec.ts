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
