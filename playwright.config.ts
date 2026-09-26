import { defineConfig } from "@playwright/test";
export default defineConfig({
  timeout: 120000,
  expect: { timeout: 20000 },
  testDir: "./tests/e2e",
  workers: 1,
  reporter: [["list"]],
  use: { baseURL: "http://127.0.0.1:3100", headless: true, channel: "chrome" },
  webServer: {
    command:
      "node -e \"require('fs').rmSync('.data-e2e',{recursive:true,force:true})\" && node node_modules/next/dist/bin/next dev --hostname 127.0.0.1 --port 3100",
    env: {
      SPAREPARTS_DATA_DIR: ".data-e2e",
      SPAREPARTS_ENABLE_SAMPLE_DATA: "1",
    },
    url: "http://127.0.0.1:3100/api/v1/health",
    reuseExistingServer: false,
    timeout: 180000,
  },
});
