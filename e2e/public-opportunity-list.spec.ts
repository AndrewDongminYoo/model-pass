import { expect, test } from "./fixtures";

test("opens a published opportunity from the home screen without a shared link", async ({
  page,
  pilotData,
}) => {
  void pilotData; // Seed at least one published opportunity on a fresh local database.
  await page.goto("/");

  await expect(
    page.getByRole("heading", { name: "Available opportunities" }),
  ).toBeVisible();
  const opportunityCard = page
    .getByRole("region", { name: "Available opportunities" })
    .getByRole("listitem")
    .first();
  await expect(opportunityCard).toBeVisible();
  const title = await opportunityCard
    .getByRole("heading", { level: 3 })
    .innerText();
  const applyLink = opportunityCard.getByRole("link", {
    name: "Check requirements and apply",
  });
  const href = await applyLink.getAttribute("href");
  expect(href).toMatch(/^\/opportunities\/[0-9a-f-]{36}\/apply$/);
  await applyLink.click();

  await expect(page).toHaveURL(new RegExp(`${href}$`));
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(title);
});
