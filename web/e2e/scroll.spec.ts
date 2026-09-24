import { expect, test } from "@playwright/test";
import { join } from "node:path";
import { FIXTURES } from "./global-setup";

const SRC = join(FIXTURES, "long.pdf");
const currentThumb = () => '[data-testid^="thumb-"][data-current="true"]';

test("continuous scroll tracks the current page and jumps on navigation", async ({ page }) => {
  await page.goto(`/?open=${encodeURIComponent(SRC)}`);
  await expect(page.getByTestId("thumb-1")).toBeVisible();
  const viewer = page.getByTestId("viewer");
  await expect(viewer).toBeVisible();

  // mouse-wheel scrolling changes the current thumbnail highlight
  await viewer.hover();
  await page.mouse.wheel(0, 3000);
  await expect(page.locator(currentThumb())).toHaveCount(1);
  await expect(page.locator(currentThumb())).not.toHaveAttribute("data-testid", "thumb-1");

  // clicking thumbnail 4 scrolls page 4 into view
  await page.getByTestId("thumb-4").click();
  await expect(page.getByTestId("viewer-page-4")).toBeInViewport({ ratio: 0.1 });

  // typing a page number jumps
  const pageInput = page.getByRole("textbox", { name: "Số trang" });
  await pageInput.fill("10");
  await pageInput.press("Enter");
  await expect(page.getByTestId("viewer-page-10")).toBeInViewport({ ratio: 0.1 });
  expect(await page.locator('[data-testid^="viewer-page-"] img').count()).toBeLessThanOrEqual(10);

  // navigating to the last page keeps it current and selected (no drift)
  await pageInput.fill("40");
  await pageInput.press("Enter");
  await expect(page.getByTestId("viewer-page-40")).toBeInViewport({ ratio: 0.1 });
  await expect(page.getByTestId("thumb-40")).toHaveAttribute("data-current", "true");
  await page.getByTestId("thumb-40").click();
  await expect(page.getByTestId("thumb-40")).toHaveAttribute("aria-selected", "true");
  await page.waitForTimeout(400);
  await expect(page.getByTestId("thumb-40")).toHaveAttribute("data-current", "true");
});
