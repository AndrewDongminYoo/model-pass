import { test, expect } from "./fixtures";

test("blocks a makeup hard failure while keeping lenses as a removable reminder", async ({
  page,
  pilotData,
}) => {
  await page.goto(`/opportunities/${pilotData.makeupOpportunityId}/apply`);

  for (const question of [
    "Is adult",
    "Matches required sex",
    "Is available",
    "Has identity document",
  ]) {
    await choose(page, question, "Yes");
  }
  await choose(page, "Has permanent or semi permanent eyebrow", "Yes");
  for (const question of [
    "Has permanent or semi permanent eyeliner",
    "Has permanent or semi permanent lip procedure",
    "Has eyelash extensions",
    "Has persistent visible marks",
    "Has visible tattoo or henna",
    "Has visible nail art",
    "Wears day of makeup",
    "Wears accessories",
  ]) {
    await choose(page, question, "No");
  }
  await choose(page, "Wears lenses", "Yes");

  await page.getByRole("button", { name: "Check eligibility" }).click();
  await expect(
    page.getByRole("heading", { name: "Not eligible" }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "Permanent or semi-permanent eyebrow procedures are incompatible with this exam.",
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Submit application" }),
  ).toHaveCount(0);

  await choose(page, "Has permanent or semi permanent eyebrow", "No");
  await page.getByRole("button", { name: "Check eligibility" }).click();
  await expect(
    page.getByRole("heading", { name: "Eligible to continue" }),
  ).toBeVisible();
  await expect(
    page.getByText("Remove lenses before the appointment."),
  ).toBeVisible();
  await page.getByRole("button", { name: "Continue to application" }).click();
  await expect(
    page.getByRole("button", { name: "Submit application" }),
  ).toBeVisible();

  await page.getByLabel("Display name").fill("Makeup Reminder Applicant");
  await page.getByLabel("Phone number").fill("01077778888");
  await page.getByLabel("Birth date").fill("1991-02-03");
  await page.getByLabel("Consent to this application").check();
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
