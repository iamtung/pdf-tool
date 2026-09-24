import { expect, test } from "@playwright/test";
import { join } from "node:path";
import { FIXTURES } from "./global-setup";

const SRC = join(FIXTURES, "mixed.pdf");
const PRESETS = ["email", "zalo", "balanced", "high"];

test("instant estimates from the profile, without /api/estimate", async ({ page }) => {
  await page.goto(`/?open=${encodeURIComponent(SRC)}`);
  await expect(page.getByTestId("thumb-1")).toBeVisible();
  await expect(page.getByTestId("profile-status")).toHaveAttribute("data-state", "ready", { timeout: 120_000 });

  // Count estimate requests only from now on: instant estimates must not trigger any.
  let estimates = 0;
  page.on("request", (r) => { if (r.url().includes("/api/estimate")) estimates += 1; });

  await page.getByRole("button", { name: "Nén toàn file" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();

  const started = Date.now();
  for (const preset of PRESETS) {
    const card = dialog.getByTestId(`preset-estimate-${preset}`);
    await expect(card).toContainText(/~\d/, { timeout: 1000 });
  }
  const openMs = Date.now() - started;

  // switching preset cards updates file-estimate instantly
  await dialog.getByRole("button", { name: "Chất lượng cao" }).click();
  const high = await page.getByTestId("file-estimate").innerText();
  await dialog.getByRole("button", { name: "Zalo / Mobile" }).click();
  await expect(page.getByTestId("file-estimate")).not.toHaveText(high);

  // typing a target updates the chosen rung + estimate
  await page.getByLabel("Hoặc nén về dưới (MB)").fill("5");
  await expect(page.getByTestId("file-estimate")).toContainText("→");
  await expect(dialog).toContainText("Bậc:");

  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);

  // per-page level switches update page-estimate instantly
  await page.getByTestId("thumb-1").click();
  const before = await page.getByTestId("page-estimate").innerText();
  await page.getByRole("radio", { name: "Mạnh" }).click();
  await expect(page.getByTestId("page-estimate")).not.toHaveText(before);

  expect(estimates).toBe(0);
  console.log(`compress dialog cards rendered in ${openMs}ms`);
});
