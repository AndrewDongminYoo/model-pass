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
    "Are you at least 19 years old?",
    "Does your current hair length meet this opportunity's requirement?",
    "Does your current hairstyle meet this opportunity's requirement?",
    "Does your recent dye history meet this opportunity's requirement?",
    "Does your recent bleach history meet this opportunity's requirement?",
    "Does your recent perm history meet this opportunity's requirement?",
    "Can you receive the style described in this opportunity?",
    "Do you meet this opportunity's other requirements?",
    "Can you attend the scheduled time?",
  ]) {
    await page.getByRole("group", { name: question }).getByLabel("Yes").check();
  }
  await page.getByRole("button", { name: "Check eligibility" }).click();
  await expect(
    page.getByRole("heading", { name: "You can apply" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Complete application" }).click();

  await page
    .getByLabel("Name or preferred name")
    .fill("Eligible Hair Applicant");
  await page.getByLabel("Phone number").fill("01055556666");
  await page.getByLabel("Date of birth").fill("1990-01-01");
  await page
    .getByLabel("I consent to personal-data processing for this application.")
    .check();
  await page.getByRole("button", { name: "Submit application" }).click();

  await expect(
    page.getByRole("heading", { name: "Application received" }),
  ).toBeVisible();
  await expect(page.getByText(/^Application ID: /)).toBeVisible();
  await expect(page.getByText(/^Private management code: /)).toBeVisible();

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
  await expect(
    page.getByText("Attendance history has been updated."),
  ).toBeVisible();

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
