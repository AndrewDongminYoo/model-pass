import { expect, test } from "./fixtures";

test.skip(
  process.env.MODEL_PASS_E2E_SURFACE !== "ait",
  "Requires the Apps in Toss surface.",
);

test("opens a shared HTTPS opportunity link from the miniapp home", async ({
  page,
  pilotData,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Apply with an opportunity link" }),
  ).toBeVisible();
  await page
    .getByRole("textbox", { name: "Opportunity link" })
    .fill(
      `https://model-pass.vercel.app/opportunities/${pilotData.hairOpportunityId}/apply`,
    );
  await page.getByRole("button", { name: "View opportunity" }).click();

  await expect(page).toHaveURL(
    new RegExp(`/opportunities/${pilotData.hairOpportunityId}/apply$`),
  );
  await expect(
    page.getByRole("heading", { name: "Gangnam hair promotion model" }),
  ).toBeVisible();
});

test("opens a matching intoss deep link from the miniapp home", async ({
  page,
  pilotData,
}) => {
  await page.goto("/");
  await page
    .getByRole("textbox", { name: "Opportunity link" })
    .fill(
      `intoss://model-pass/opportunities/${pilotData.makeupOpportunityId}/apply`,
    );
  await page.getByRole("button", { name: "View opportunity" }).click();

  await expect(page).toHaveURL(
    new RegExp(`/opportunities/${pilotData.makeupOpportunityId}/apply$`),
  );
  await expect(
    page.getByRole("heading", { name: "Gangnam makeup certification model" }),
  ).toBeVisible();
});
