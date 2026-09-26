import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

test.describe.configure({ mode: "serial" });

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
const OWNER = { email: "owner@e2e.test", password: "e2e-secret-passphrase-1", name: "Olivia Owner", shop: "E2E Auto Parts" };
let external: string[] = [];

async function signIn(page: Page, email: string, password: string) {
  await page.goto("/");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

test.beforeEach(({ page }) => {
  page.on("request", (r) => {
    const u = new URL(r.url());
    if (!["127.0.0.1", "localhost"].includes(u.hostname) && u.protocol.startsWith("http")) external.push(r.url());
  });
});
test.afterAll(() => {
  expect(external, "the app must not call any external host").toEqual([]);
});

test("first run: create the Owner account and the shop", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Set up your shop" })).toBeVisible();
  await page.getByLabel("Shop name").fill(OWNER.shop);
  await page.getByLabel("Your name").fill(OWNER.name);
  await page.getByLabel("Email").fill(OWNER.email);
  await page.getByLabel("Password").fill("short");
  await page.getByRole("button", { name: "Create Owner account" }).click();
  await expect(page.locator(".error")).toContainText(/password/i);
  await page.getByLabel("Password").fill(OWNER.password);
  await page.getByRole("button", { name: "Create Owner account" }).click();
  await expect(page.getByRole("heading", { name: "Business overview" })).toBeVisible();
  await expect(page.locator(".sidebar")).toContainText(OWNER.shop);
  await expect(page.getByText("Your shop is empty.")).toBeVisible();
});

test("sample data (dev only) fills the shop through the real services", async ({ page }) => {
  await signIn(page, OWNER.email, OWNER.password);
  await page.getByRole("button", { name: /Load sample data/ }).click();
  await expect(page.getByText("Your shop is empty.")).toHaveCount(0);
  await page.goto("/products");
  await expect(page.getByRole("link", { name: /Oil filter element \(Sample\)/ })).toBeVisible();
});

test("reference catalogue: search, part page, drawing viewer with hotspots", async ({ page }) => {
  await signIn(page, OWNER.email, OWNER.password);
  await page.goto("/catalogue");
  await page.getByLabel("Search the reference catalogue").fill("9091510009");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await page.getByRole("link", { name: "90915-10009" }).first().click();
  await expect(page.getByRole("heading", { name: "90915-10009" })).toBeVisible();
  await expect(page.getByText("Fitment (1)")).toBeVisible();
  await expect(page.getByRole("button", { name: "IMPORT TO MY PRODUCTS" })).toBeVisible();
  await page.getByRole("link", { name: /SMP-FIG-1/ }).click();
  const img = page.getByRole("img", { name: /Drawing SMP-FIG-1/ });
  await expect(img).toBeVisible();
  await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(100);
  const hotspots = page.getByRole("button", { name: /^Callout / });
  await expect(hotspots).toHaveCount(3);
  await hotspots.first().click();
  await expect(page.locator("tr.selected-table-row").first()).toBeVisible();
  await expect(page.getByText("3 part lines on this drawing")).toBeVisible();
  // the drawing area fits its card (no horizontal overflow)
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});

test("IMPORT TO MY PRODUCTS creates a linked product once, and the reference shows it", async ({ page }) => {
  await signIn(page, OWNER.email, OWNER.password);
  await page.goto("/catalogue?q=15690-65010");
  await page.getByRole("link", { name: "15690-65010" }).first().click();
  await page.getByRole("button", { name: "IMPORT TO MY PRODUCTS" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Your SKU").fill("BYPASS-VALVE-1");
  await dialog.getByLabel("Selling price").fill("35.50");
  await dialog.getByRole("button", { name: "IMPORT TO MY PRODUCTS" }).click();
  await expect(page.getByRole("heading", { name: /Valve Sub-Assy/ })).toBeVisible();
  await expect(page.getByText("Linked to the Reference Catalogue")).toBeVisible();
  await page.getByRole("tab", { name: "Fitment" }).click();
  await expect(page.getByText("Land Cruiser")).toBeVisible();
  await page.getByRole("tab", { name: "OEM Reference" }).click();
  await expect(page.getByRole("cell", { name: "15690-65010" }).first()).toBeVisible();
  await page.getByRole("link", { name: "15690-65010" }).first().click();
  await expect(page.getByText("✓ In My Products")).toBeVisible();
  await expect(page.getByRole("link", { name: "VIEW MY PRODUCT" })).toBeVisible();
  await expect(page.getByRole("button", { name: "IMPORT TO MY PRODUCTS" })).toHaveCount(0);
});

test("product page: photos are uploaded, shown and made primary", async ({ page }) => {
  await signIn(page, OWNER.email, OWNER.password);
  await page.goto("/products");
  await page.getByRole("link", { name: "Oil filter element (Sample)" }).click();
  await expect(page.getByRole("tab", { name: "Overview" })).toBeVisible();
  for (const name of ["front.png", "back.png"]) {
    await page.locator('input[type="file"]').setInputFiles({ name, mimeType: "image/png", buffer: PNG });
    await expect(page.getByText(`Uploaded ${name}`)).toBeVisible();
  }
  await expect(page.getByRole("button", { name: /^Photo \d/ })).toHaveCount(2);
  await page.getByRole("button", { name: "Photo 2" }).click();
  await page.getByRole("button", { name: "Make primary" }).click();
  await expect(page.getByText("Primary photo changed")).toBeVisible();
  await page.locator('input[type="file"]').setInputFiles({ name: "evil.png", mimeType: "image/png", buffer: Buffer.from("<script>alert(1)</script>") });
  await expect(page.locator(".error")).toContainText(/image/i);
  for (const tab of ["Fitment", "Stock", "Supplier", "OEM Reference", "Sales", "History"]) {
    await page.getByRole("tab", { name: tab }).click();
    await expect(page.getByRole("tab", { name: tab })).toHaveAttribute("aria-selected", "true");
  }
});

test("enquiry to quotation to order to invoice to payment", async ({ page }) => {
  await signIn(page, OWNER.email, OWNER.password);
  await page.goto("/customers");
  await page.getByRole("button", { name: "New customer" }).click();
  await page.getByRole("dialog").getByLabel("Name", { exact: true }).fill("Acme Garage");
  await page.getByRole("dialog").getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("link", { name: "Acme Garage" })).toBeVisible();

  await page.goto("/catalogue?q=90915-10009");
  await page.getByRole("button", { name: "Add to enquiry" }).first().click();
  await expect(page.getByText(/added to the enquiry cart/)).toBeVisible();
  await page.goto("/enquiries/cart");
  await page.getByLabel("Existing customer (optional)").selectOption({ label: "Acme Garage" });
  await page.getByLabel("Contact name").fill("Buyer Bob");
  await page.getByRole("button", { name: "Submit enquiry" }).click();
  await expect(page.getByRole("heading", { name: /^ENQ-/ })).toBeVisible();
  await page.getByRole("button", { name: "Create quotation" }).click();
  await expect(page.getByRole("heading", { name: /^QUO-/ })).toBeVisible();
  await page.getByRole("button", { name: "Edit lines" }).click();
  await page.getByRole("dialog").getByLabel("Price").first().fill("45.00");
  await page.getByRole("dialog").getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Quotation saved")).toBeVisible();
  await page.getByRole("button", { name: "Issue to customer" }).click();
  await expect(page.getByText("Quotation issued")).toBeVisible();
  const pdf = await page.request.get(page.url().replace("/quotations/", "/api/v1/quotations/") + "/pdf");
  expect(pdf.status()).toBe(200);
  expect((await pdf.body()).subarray(0, 5).toString()).toBe("%PDF-");
  await page.getByRole("button", { name: "Customer accepted" }).click();
  await page.getByRole("button", { name: "Create order" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Create order" }).click();
  await expect(page.getByRole("heading", { name: /^SO-|^ORD-/ })).toBeVisible();
  await page.getByRole("button", { name: "Record delivery" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Save delivery" }).click();
  await expect(page.getByText("Delivery recorded")).toBeVisible();
  await page.getByRole("button", { name: "Invoice delivered items" }).click();
  await expect(page.getByRole("heading", { name: /^INV-/ })).toBeVisible();
  await page.getByRole("button", { name: "Record payment" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Record payment" }).click();
  await expect(page.locator(".badge", { hasText: "Paid" }).first()).toBeVisible();
});

test("CSV import wizard: map, preview and import a catalogue file", async ({ page }) => {
  await signIn(page, OWNER.email, OWNER.password);
  await page.goto("/catalogue/import");
  const csv = readFileSync(join(process.cwd(), "tests/fixtures/catalogue/intraforge_reference_catalogue_batch_001.csv"));
  await page.locator('input[type="file"]').first().setInputFiles({ name: "batch.csv", mimeType: "text/csv", buffer: csv });
  await expect(page.getByText("Match your columns")).toBeVisible();
  await page.getByLabel(/I confirm that my organisation/).check();
  await page.getByRole("button", { name: "Validate and preview" }).click();
  await expect(page.getByText("Rows detected")).toBeVisible();
  await page.getByRole("button", { name: /^Import \d+ valid row/ }).click();
  await expect(page.locator(".badge", { hasText: /^Completed/ }).first()).toBeVisible({ timeout: 30000 });
  await page.goto("/catalogue?q=12204-15030");
  await expect(page.getByRole("link", { name: "12204-15030" }).first()).toBeVisible();
});

test("roles: a Viewer sees no admin or write actions and the server enforces it", async ({ page }) => {
  await signIn(page, OWNER.email, OWNER.password);
  await page.goto("/admin/users");
  await page.getByRole("button", { name: "Add user" }).click();
  const d = page.getByRole("dialog");
  await d.getByLabel("Name").fill("Vera Viewer");
  await d.getByLabel(/^Email/).fill("viewer@e2e.test");
  await d.getByLabel("Role").selectOption("VIEWER");
  await d.getByLabel("Temporary password").fill("temporary-pass-999");
  await d.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("viewer@e2e.test")).toBeVisible();
  await page.locator("details.account summary").click();
  await page.getByRole("button", { name: "Sign out" }).click();

  await signIn(page, "viewer@e2e.test", "temporary-pass-999");
  await expect(page.getByRole("heading", { name: "Choose a new password" })).toBeVisible();
  await page.getByLabel("Temporary password").fill("temporary-pass-999");
  await page.getByLabel("New password").fill("brand-new-passphrase-77");
  await page.getByRole("dialog").getByRole("button", { name: "Change password" }).click();
  await signIn(page, "viewer@e2e.test", "brand-new-passphrase-77");
  await expect(page.getByRole("heading", { name: "Business overview" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Users" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Customers" })).toHaveCount(0);
  await page.goto("/products");
  await expect(page.getByRole("button", { name: "New product" })).toHaveCount(0);
  await page.goto("/admin/users");
  await expect(page.locator(".error")).toContainText(/role/i);
  const res = await page.request.post("/api/v1/products", { data: { sku: "X", name: "X" } });
  expect(res.status()).toBe(403);
});

test("sign-in shows a clear error and sign-out ends the session", async ({ page }) => {
  await signIn(page, OWNER.email, "wrong-password-here");
  await expect(page.locator(".error")).toContainText(/incorrect|invalid/i);
  await signIn(page, OWNER.email, OWNER.password);
  await expect(page.getByRole("heading", { name: "Business overview" })).toBeVisible();
  await page.locator("details.account summary").click();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  const me = await page.request.get("/api/v1/auth/me");
  expect(me.status()).toBe(401);
});
