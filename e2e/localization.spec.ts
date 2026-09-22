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
