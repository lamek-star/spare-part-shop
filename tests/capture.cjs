const { chromium } = require("@playwright/test");
(async () => {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  await page.goto("http://127.0.0.1:3000");
  await page.getByRole("button", { name: "Enter demo workspace" }).click();
  await page.screenshot({ path: "docs/dashboard.png", fullPage: true });
  await page.getByRole("button", { name: "Parts", exact: true }).click();
  await page.screenshot({ path: "docs/catalogue.png", fullPage: false });
  await browser.close();
})();
