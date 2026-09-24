import { expect, test, type Page } from "@playwright/test";
import { join } from "node:path";
import { ESTIMATE_DEBOUNCE_MS } from "../src/api/hooks";
import { FIXTURES } from "./global-setup";

const SRC = join(FIXTURES, "mixed.pdf");
const PRESETS = ["email", "zalo", "balanced", "high"];

/** Wait long enough that any debounced server estimate would have been requested. */
const settle = (page: Page) => page.waitForTimeout(ESTIMATE_DEBOUNCE_MS + 400);

test("instant estimates from the profile, without /api/estimate", async ({ page }) => {
  await page.goto(`/?open=${encodeURIComponent(SRC)}`);
  await expect(page.getByTestId("thumb-1")).toBeVisible();
  await expect(page.getByTestId("profile-status")).toHaveAttribute("data-state", "ready", { timeout: 120_000 });

  // Count estimate requests only from now on: instant estimates must not trigger any.
  let estimates = 0;
  page.on("request", (r) => { if (r.url().includes("/api/estimate")) estimates += 1; });

  // M4: measure from the click, not from the dialog becoming visible.
  const started = Date.now();
  await page.getByRole("button", { name: "Nén toàn file" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  for (const preset of PRESETS) {
    await expect(dialog.getByTestId(`preset-estimate-${preset}`)).toContainText(/~\d/, { timeout: 1000 });
  }
  const openMs = Date.now() - started;

  // No debounced request after the cards render.
  await settle(page);
  expect(estimates).toBe(0);

  // switching preset cards updates file-estimate instantly, still without requests
  await dialog.getByRole("button", { name: "Chất lượng cao" }).click();
  const high = await page.getByTestId("file-estimate").innerText();
  await dialog.getByRole("button", { name: "Zalo / Mobile" }).click();
  await expect(page.getByTestId("file-estimate")).not.toHaveText(high);
  await settle(page);
  expect(estimates).toBe(0);

  // typing a target updates the chosen rung + estimate, still without requests
  await page.getByLabel("Hoặc nén về dưới (MB)").fill("5");
  await expect(page.getByTestId("file-estimate")).toContainText("→");
  await expect(dialog).toContainText("Bậc:");
  await settle(page);
  expect(estimates).toBe(0);

  // Positive control: a manual DPI has no instant estimate, so the server fallback is used.
  await dialog.getByRole("button", { name: "Tùy chỉnh nâng cao" }).click();
  await dialog.getByLabel("DPI tối đa").fill("90");
  await settle(page);
  expect(estimates).toBeGreaterThanOrEqual(1);
  await expect(page.getByTestId("file-estimate")).toContainText(/Đang tính…|→/);
  const afterPositive = estimates;

  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);

  // per-page level switches update page-estimate instantly, adding no requests
  await page.getByTestId("thumb-1").click();
  const before = await page.getByTestId("page-estimate").innerText();
  await page.getByRole("radio", { name: "Mạnh" }).click();
  await expect(page.getByTestId("page-estimate")).not.toHaveText(before);
  await settle(page);
  expect(estimates).toBe(afterPositive);

  console.log(`click→cards ${openMs}ms`);
});
