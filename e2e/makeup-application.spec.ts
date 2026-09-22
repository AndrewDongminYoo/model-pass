import { test, expect } from "./fixtures";

test("blocks a makeup hard failure while keeping lenses as a removable reminder", async ({
  page,
  pilotData,
}) => {
  await page.goto(`/opportunities/${pilotData.makeupOpportunityId}/apply`);

  for (const question of [
    "Are you at least 19 years old?",
    "Do you meet the sex requirement in this opportunity?",
    "Can you attend the scheduled time?",
    "Can you bring an identity document on the exam day?",
  ]) {
    await choose(page, question, "Yes");
  }
  await choose(
    page,
    "Have you had permanent or semi-permanent eyebrow procedures?",
    "Yes",
  );
  for (const question of [
    "Have you had permanent or semi-permanent eyeliner procedures?",
    "Have you had permanent or semi-permanent lip procedures?",
    "Do you currently have eyelash extensions?",
    "Do you have identifying marks visible while wearing exam attire?",
    "Do you have tattoos or henna visible while wearing exam attire?",
    "Do you have nail art visible while wearing exam attire?",
    "Will you arrive wearing makeup on the exam day?",
    "Will you wear accessories on the exam day?",
  ]) {
    await choose(page, question, "No");
  }
  await choose(page, "Will you wear lenses on the exam day?", "Yes");

  await page.getByRole("button", { name: "Check eligibility" }).click();
  await expect(
    page.getByRole("heading", {
      name: "You do not meet the eligibility requirements",
    }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "Permanent or semi-permanent eyebrow procedures are incompatible with this exam.",
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Submit application" }),
  ).toHaveCount(0);

  await choose(
    page,
    "Have you had permanent or semi-permanent eyebrow procedures?",
    "No",
  );
  await page.getByRole("button", { name: "Check eligibility" }).click();
  await expect(
    page.getByRole("heading", { name: "You can apply" }),
  ).toBeVisible();
  await expect(
    page.getByText("Remove lenses before the appointment."),
  ).toBeVisible();
  await page.getByRole("button", { name: "Complete application" }).click();
  await expect(
    page.getByRole("button", { name: "Submit application" }),
  ).toBeVisible();

  await page
    .getByLabel("Name or preferred name")
    .fill("Makeup Reminder Applicant");
  await page.getByLabel("Phone number").fill("01077778888");
  await page.getByLabel("Date of birth").fill("1991-02-03");
  await page
    .getByLabel("I consent to personal-data processing for this application.")
    .check();
  await page.getByRole("button", { name: "Submit application" }).click();

  await expect(
    page.getByRole("heading", { name: "Application received" }),
  ).toBeVisible();
  await expect(page.getByText(/^Receipt: /)).toBeVisible();
});

async function choose(
  page: import("@playwright/test").Page,
  question: string,
  answer: "Yes" | "No",
): Promise<void> {
  await page.getByRole("group", { name: question }).getByLabel(answer).check();
}
