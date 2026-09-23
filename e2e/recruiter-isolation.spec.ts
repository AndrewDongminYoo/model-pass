import { e2eBaseUrl, test, expect } from "./fixtures";

test("enforces recruiter application isolation through local Supabase RLS", async ({
  browser,
  pilotData,
}) => {
  const recruiterOneContext = await browser.newContext({
    baseURL: e2eBaseUrl,
    storageState: pilotData.recruiterOne.storageState,
  });
  const recruiterTwoContext = await browser.newContext({
    baseURL: e2eBaseUrl,
    storageState: pilotData.recruiterTwo.storageState,
  });

  try {
    const recruiterOnePage = await recruiterOneContext.newPage();
    await recruiterOnePage.goto(
      `/recruiter/opportunities/${pilotData.recruiterOne.opportunityId}/applications`,
    );
    await expect(
      recruiterOnePage.getByRole("heading", {
        name: "Recruiter One Applicant",
      }),
    ).toBeVisible();
    await recruiterOnePage.goto(
      `/recruiter/opportunities/${pilotData.recruiterTwo.opportunityId}/applications`,
    );
    await expect(
      recruiterOnePage
        .getByRole("alert")
        .getByText("Could not load applications."),
    ).toBeVisible();
    await expect(
      recruiterOnePage.getByRole("heading", {
        name: "Recruiter Two Applicant",
      }),
    ).toHaveCount(0);

    const recruiterTwoPage = await recruiterTwoContext.newPage();
    await recruiterTwoPage.goto(
      `/recruiter/opportunities/${pilotData.recruiterTwo.opportunityId}/applications`,
    );
    await expect(
      recruiterTwoPage.getByRole("heading", {
        name: "Recruiter Two Applicant",
      }),
    ).toBeVisible();
    await recruiterTwoPage.goto(
      `/recruiter/opportunities/${pilotData.recruiterOne.opportunityId}/applications`,
    );
    await expect(
      recruiterTwoPage
        .getByRole("alert")
        .getByText("Could not load applications."),
    ).toBeVisible();
    await expect(
      recruiterTwoPage.getByRole("heading", {
        name: "Recruiter One Applicant",
      }),
    ).toHaveCount(0);
  } finally {
    await recruiterOneContext.close();
    await recruiterTwoContext.close();
  }
});
