import { expect, test } from "@playwright/test";
import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { FIXTURES } from "./global-setup";

const SRC = join(FIXTURES, "mixed.pdf");

test("open → delete → insert blank → per-page → file compression → export", async ({ page }) => {
  await page.goto(`/?open=${encodeURIComponent(SRC)}`);
  await expect(page.getByText("mixed.pdf")).toBeVisible();
  await expect(page.getByTestId("thumb-5")).toBeVisible();

  // delete page 2
  await page.getByTestId("thumb-2").click();
  await page.getByRole("button", { name: "Xóa" }).click();
  await expect(page.getByTestId("thumb-5")).toHaveCount(0);

  // insert a blank page before page 1
  await page.locator(".gap").first().hover(); // the button only shows while the gap is hovered
  await page.getByRole("button", { name: "+ Chèn" }).first().click();
  await page.getByRole("button", { name: "Trang trắng" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Chèn", exact: true }).click();
  await expect(page.getByTestId("thumb-5")).toBeVisible();

  // per-page compression on page 2 (the scan)
  await page.getByTestId("thumb-2").click();
  await page.getByRole("button", { name: "Mạnh" }).click();
  await expect(page.getByTestId("page-estimate")).toContainText("→", { timeout: 60_000 });
  await page.getByRole("button", { name: "Áp dụng" }).click();
  await expect(page.getByTestId("thumb-2")).toContainText("Mạnh");

  // whole-file compression replaces it (spec 4.5) — warning shown
  await page.getByRole("button", { name: "Nén toàn file" }).click();
  await page.getByRole("button", { name: "Cân bằng" }).click();
  await expect(page.getByTestId("override-warning")).toContainText("1 trang");
  await page.getByRole("dialog").getByRole("button", { name: "Áp dụng", exact: true }).click();
  await expect(page.getByTestId("thumb-2")).not.toContainText("Mạnh");
  await expect(page.getByText("Nén: Cân bằng")).toBeVisible();

  // a page level set afterwards survives
  await page.getByTestId("thumb-3").click();
  await page.getByRole("button", { name: "Nhẹ" }).click();
  await page.getByRole("button", { name: "Áp dụng" }).click();
  await expect(page.getByTestId("thumb-3")).toContainText("Nhẹ");

  // export
  await page.getByRole("button", { name: "Xuất file" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Xuất", exact: true }).click();
  await expect(page.getByText("Đã xuất file")).toBeVisible({ timeout: 90_000 });
  const out = join(FIXTURES, "mixed_compressed.pdf");
  expect(existsSync(out)).toBe(true);
  expect(statSync(out).size).toBeLessThan(statSync(SRC).size);
});
