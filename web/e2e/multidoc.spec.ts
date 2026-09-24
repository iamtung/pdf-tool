import { expect, test, type Page } from "@playwright/test";
import { join } from "node:path";
import { ESTIMATE_DEBOUNCE_MS } from "../src/api/hooks";
import { FIXTURES } from "./global-setup";

const SRC = join(FIXTURES, "mixed.pdf");
const SECOND = join(FIXTURES, "second.pdf");
const PRESETS = ["email", "zalo", "balanced", "high"];

const settle = (page: Page) => page.waitForTimeout(ESTIMATE_DEBOUNCE_MS + 400);

test("instant estimates for a plan that mixes two documents", async ({ page }) => {
  // The insert dialog opens a native macOS picker; replace that one request with a fixture path.
  await page.route("**/api/system/pick-file", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ paths: [SECOND] }) }));

  await page.goto(`/?open=${encodeURIComponent(SRC)}`);
  await expect(page.getByTestId("thumb-1")).toBeVisible();
  await expect(page.getByTestId("profile-status")).toHaveAttribute("data-state", "ready", { timeout: 120_000 });

  // Insert both pages of the second PDF.
  await page.getByTestId("insert-gap-0").hover();
  await page.getByRole("button", { name: "+ Chèn" }).first().click();
  const insert = page.getByRole("dialog");
  await insert.getByRole("button", { name: "Chọn file PDF…" }).click();
  await expect(insert.getByText("second.pdf")).toBeVisible();
  await insert.getByRole("button", { name: "Chèn", exact: true }).click();
  await expect(page.getByTestId("thumb-7")).toBeVisible();

  // The cards only show a size once every document in the plan has a profile.
  await page.getByRole("button", { name: "Nén toàn file" }).click();
  const dialog = page.getByRole("dialog");
  for (const preset of PRESETS) {
    await expect(dialog.getByTestId(`preset-estimate-${preset}`)).toContainText(/~\d/, { timeout: 120_000 });
  }

  // From here on, instant estimates must not create any server estimate job.
  let estimates = 0;
  page.on("request", (r) => { if (r.url().includes("/api/estimate")) estimates += 1; });
  await settle(page);
  expect(estimates).toBe(0);

  await dialog.getByRole("button", { name: "Cân bằng" }).click();
  await settle(page);
  expect(estimates).toBe(0);
});
