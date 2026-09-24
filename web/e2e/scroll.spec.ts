import { expect, test, type Page } from "@playwright/test";
import { join } from "node:path";
import { FIXTURES } from "./global-setup";

const SRC = join(FIXTURES, "long.pdf");
const currentThumb = () => '[data-testid^="thumb-"][data-current="true"]';

/** The rendered page with the largest visible area inside the scroll container. */
async function mostVisibleThumb(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const viewer = document.querySelector('[data-testid="viewer"]');
    if (!viewer) return null;
    const vp = viewer.getBoundingClientRect();
    let best: string | null = null;
    let bestArea = -1;
    for (const el of document.querySelectorAll<HTMLElement>('[data-testid^="viewer-page-"]')) {
      const r = el.getBoundingClientRect();
      const top = Math.max(r.top, vp.top);
      const bottom = Math.min(r.bottom, vp.bottom);
      const area = Math.max(0, bottom - top) * r.width;
      if (area > bestArea) {
        bestArea = area;
        best = el.getAttribute("data-testid");
      }
    }
    return best ? best.replace("viewer-page-", "thumb-") : null;
  });
}

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

test("navigated page stays current on a tall viewport", async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 1800 });
  await page.goto(`/?open=${encodeURIComponent(SRC)}`);
  await expect(page.getByTestId("thumb-1")).toBeVisible();
  const viewer = page.getByTestId("viewer");
  await expect(viewer).toBeVisible();

  // Zoom out to 50% with the "Thu nhỏ" button.
  const zoomOut = page.getByRole("button", { name: "Thu nhỏ" });
  for (let i = 0; i < 8; i++) {
    if ((await page.getByRole("button", { name: /^\d+%$/ }).innerText()).trim() === "50%") break;
    await zoomOut.click();
    await page.waitForTimeout(100);
  }
  await expect(page.getByRole("button", { name: "50%" })).toBeVisible();

  // (a) typing a page number keeps that page current (spec §11.4 sticky navigation)
  const pageInput = page.getByRole("textbox", { name: "Số trang" });
  await pageInput.fill("40");
  await pageInput.press("Enter");
  await page.waitForTimeout(800);
  await expect(page.getByTestId("thumb-40")).toHaveAttribute("data-current", "true");
  await expect(page.getByTestId("thumb-40")).toHaveAttribute("aria-selected", "true");

  // (b) clicking a thumbnail keeps it current
  await page.getByTestId("thumb-39").click();
  await page.waitForTimeout(800);
  await expect(page.getByTestId("thumb-39")).toHaveAttribute("data-current", "true");

  // (c) wheel-scrolling releases the sticky page: current follows the most visible page
  await viewer.hover();
  await page.mouse.wheel(0, -2000);
  await page.waitForTimeout(300);
  const most = await mostVisibleThumb(page);
  expect(most).not.toBe("thumb-39");
  await expect
    .poll(() => page.locator(currentThumb()).getAttribute("data-testid"))
    .toBe(most);
});

test("overview tab survives scrolling", async ({ page }) => {
  await page.goto(`/?open=${encodeURIComponent(SRC)}`);
  await expect(page.getByTestId("thumb-1")).toBeVisible();

  await page.getByRole("tab", { name: "Tổng quan" }).click();
  await expect(page.getByRole("tab", { name: "Tổng quan" })).toHaveAttribute("aria-selected", "true");

  const viewer = page.getByTestId("viewer");
  await viewer.hover();
  await page.mouse.wheel(0, 3000);
  await page.waitForTimeout(400);
  await expect(page.getByRole("tab", { name: "Tổng quan" })).toHaveAttribute("aria-selected", "true");

  // a user page selection switches back to "Trang"
  await page.getByTestId("thumb-5").click();
  await expect(page.getByRole("tab", { name: "Trang" })).toHaveAttribute("aria-selected", "true");
});
