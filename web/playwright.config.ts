import { defineConfig } from "@playwright/test";
import { resolve } from "node:path";

const PORT = 8779;

export default defineConfig({
  testDir: "e2e",
  timeout: 120_000,
  globalSetup: "./e2e/global-setup.ts",
  use: {
    channel: "chrome", // the locally installed Google Chrome; no Playwright browser download
    baseURL: `http://127.0.0.1:${PORT}`,
    viewport: { width: 1400, height: 900 },
  },
  webServer: {
    command: `uv run pdftool --no-browser --port ${PORT}`,
    cwd: "..",
    url: `http://127.0.0.1:${PORT}/api/system/health`,
    // Isolated data dir (own single-instance lock); absolute so it doesn't depend on the server cwd.
    env: { PDFTOOL_HOME: resolve(import.meta.dirname, "e2e/.home") },
    reuseExistingServer: false,
  },
});
