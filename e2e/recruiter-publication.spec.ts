import { e2eBaseUrl, test, expect } from "./fixtures";

test("publishes an authenticated recruiter opportunity and returns private workflow links", async ({
  browser,
  pilotData,
}) => {
  const context = await browser.newContext({
    baseURL: e2eBaseUrl,
    storageState: pilotData.recruiterOne.storageState,
  });

  try {
    const page = await context.newPage();
    await page.goto("/opportunities/new");
    await expect(
      page.getByRole("heading", { name: "Create opportunity" }),
    ).toBeVisible();

    await page.getByLabel("Procedure").fill("Live publication verification");
    await page.getByLabel("Starts at").fill(localDateTime(8));
    await page.getByLabel("Closes at").fill(localDateTime(7));
    await page
      .getByLabel("Benefit description")
      .fill("Hair service at no charge");
    await page.getByRole("button", { name: "Preview opportunity" }).click();

    const hardRuleConfirmations = page.getByLabel(/^Confirm hard rule:/);
    const hardRuleCount = await hardRuleConfirmations.count();
    expect(hardRuleCount).toBeGreaterThan(0);
    for (let index = 0; index < hardRuleCount; index += 1) {
      await hardRuleConfirmations.nth(index).check();
    }

    await page.getByRole("button", { name: "Publish opportunity" }).click();
    await expect(page.getByText("Opportunity published.")).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Applicant link" }),
    ).toHaveAttribute("href", /^\/opportunities\/[0-9a-f-]+\/apply$/);
    await expect(
      page.getByRole("link", { name: "Recruiter review link" }),
    ).toHaveAttribute(
      "href",
      /^\/recruiter\/opportunities\/[0-9a-f-]+\/applications$/,
    );
  } finally {
    await context.close();
  }
});

function localDateTime(daysFromNow: number): string {
  const value = new Date(Date.now() + daysFromNow * 24 * 60 * 60 * 1_000);
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(
    value.getDate(),
  )}T${pad(value.getHours())}:${pad(value.getMinutes())}`;
}
