import { expect, test } from "@playwright/test";

test("defaults to Korean and keeps a manual language choice across navigation", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("lang", "ko");
  await expect(page.getByRole("heading", { name: "모델패스" })).toBeVisible();
  await expect(page.getByRole("button", { name: "한국어" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  await page.getByRole("button", { name: "English" }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.getByRole("heading", { name: "Model Pass" })).toBeVisible();
  await expect(page).toHaveTitle("Model Pass");

  await page.reload();
  await expect(page.getByRole("heading", { name: "Model Pass" })).toBeVisible();
  await page.getByRole("button", { name: "한국어" }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "ko");
  await expect(page.getByRole("heading", { name: "모델패스" })).toBeVisible();
});

test("wraps Korean copy between words on a narrow screen", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await page.goto("/");

  for (const selector of [".lede", ".home-card p"]) {
    const lines = await page
      .locator(selector)
      .first()
      .evaluate((element) => {
        const text = element.firstChild;
        if (text?.nodeType !== Node.TEXT_NODE) {
          throw new Error("Expected a text node.");
        }
        const lines = new Map<number, string>();
        for (let index = 0; index < text.textContent!.length; index += 1) {
          const range = document.createRange();
          range.setStart(text, index);
          range.setEnd(text, index + 1);
          const top = Math.round(range.getBoundingClientRect().top);
          lines.set(top, (lines.get(top) ?? "") + text.textContent![index]);
        }
        return [...lines.values()];
      });

    expect(lines.length).toBeGreaterThan(1);
    expect(lines.slice(0, -1).every((line) => line.endsWith(" "))).toBe(true);
  }

  await page.getByRole("button", { name: "English" }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  expect(
    await page
      .locator(".lede")
      .evaluate((element) => getComputedStyle(element).wordBreak),
  ).toBe("normal");
});
