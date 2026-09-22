import { test, expect } from "./fixtures";

test("submits an eligible hair procedure-benefit application", async ({
  browser,
  page,
  pilotData,
}) => {
  await page.goto(`/opportunities/${pilotData.hairOpportunityId}/apply`);

  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Gangnam hair promotion model",
  );
  await expect(page.getByText("Hair treatment at no charge")).toBeVisible();

  for (const question of [
    "Is adult",
    "Meets current length requirement",
    "Meets current style requirement",
    "Meets recent dye requirement",
    "Meets recent bleach requirement",
    "Meets recent perm requirement",
    "Accepts target style",
    "Meets recruiter constraints",
    "Is available",
  ]) {
    await page.getByRole("group", { name: question }).getByLabel("Yes").check();
  }
  await page.getByRole("button", { name: "Check eligibility" }).click();
  await expect(
    page.getByRole("heading", { name: "Eligible to continue" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Continue to application" }).click();

  await page.getByLabel("Display name").fill("Eligible Hair Applicant");
  await page.getByLabel("Phone number").fill("01055556666");
  await page.getByLabel("Birth date").fill("1990-01-01");
  await page.getByLabel("Consent to this application").check();
  await page.getByRole("button", { name: "Submit application" }).click();

  await expect(
    page.getByRole("heading", { name: "Application received" }),
  ).toBeVisible();
  await expect(page.getByText(/^Receipt: /)).toBeVisible();

  await expect(
    page.getByText("Waiting for recruiter selection."),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Confirm attendance" }),
  ).not.toBeVisible();

  const recruiterContext = await browser.newContext({
    storageState: pilotData.recruiterOne.storageState,
  });
  try {
    const recruiterPage = await recruiterContext.newPage();
    await recruiterPage.goto(
      `/recruiter/opportunities/${pilotData.hairOpportunityId}/applications`,
    );
    const applicationCard = recruiterPage
      .getByRole("article")
      .filter({ hasText: "Eligible Hair Applicant" });
    await applicationCard
      .getByRole("button", { name: "Select application" })
      .click();
    await expect(
      applicationCard.getByRole("button", { name: "Confirm attendance" }),
    ).toBeVisible();
  } finally {
    await recruiterContext.close();
  }

  await page.reload();

  await page.getByRole("button", { name: "Confirm attendance" }).click();
  await expect(page.getByText("Attendance updated.")).toBeVisible();

  await page
    .getByRole("button", { name: "Revoke future-opportunity consent" })
    .click();
  await expect(
    page.getByText("Future-opportunity consent has been revoked."),
  ).toBeVisible();

  await page.getByRole("button", { name: "Request deletion" }).click();
  await expect(
    page.getByText(
      "Your deletion request is pending. Records are not immediately erased.",
    ),
  ).toBeVisible();
});
