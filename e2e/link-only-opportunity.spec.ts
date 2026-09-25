import { expect, test } from "./fixtures";

test("keeps discovery off while opening a shared opportunity link", async ({
  page,
  pilotData,
}) => {
  await page.goto("/");

  await expect(
    page.getByRole("heading", { name: "Available opportunities" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Want to be a model?" }),
  ).toBeVisible();

  await page.goto(`/opportunities/${pilotData.hairOpportunityId}/apply`);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
});
