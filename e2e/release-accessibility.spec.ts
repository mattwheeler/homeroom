import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("account entry has no serious accessibility violations or horizontal overflow", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Who is using Homeroom?" })).toBeVisible();

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);

  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(results.violations.filter((violation) => violation.impact === "critical" || violation.impact === "serious")).toEqual([]);
});

test("judge access remains keyboard-operable", async ({ page }) => {
  await page.goto("/");
  const toggle = page.getByRole("button", { name: "OpenAI Build Week judge access" });
  await expect(toggle).toBeEnabled();
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  const input = page.getByLabel("Review code");
  await expect(input).toBeVisible();
  await input.focus();
  await page.keyboard.type("example-review-code");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Open student view" })).toBeFocused();
});
