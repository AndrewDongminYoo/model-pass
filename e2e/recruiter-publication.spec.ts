import { e2eBaseUrl, test, expect } from "./fixtures";
import { makeupCertificationV2Locked } from "../src/features/eligibility/templates/makeup-certification-v2";

test("publishes an authenticated recruiter opportunity and returns private workflow links", async ({
  browser,
  pilotData,
}) => {
  const longProcedure = "LivePublicationVerification".repeat(5);
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

    await page.getByLabel("Procedure").fill(longProcedure);
    await page.getByLabel("Starts at").fill(localDateTime(8));
    await page.getByLabel("Closes at").fill(localDateTime(7));
    await page
      .getByLabel("Benefit description")
      .fill("Hair service at no charge");
    await page
      .getByRole("button", { name: "Hair length Add condition" })
      .click();
    const applicantQuestion = "현재 머리카락이 어깨 아래까지 내려오나요?";
    await page.getByLabel("Question · Hair length").fill(applicantQuestion);
    await page.getByLabel("Expected answer · Hair length").selectOption("yes");
    await page
      .getByLabel("Condition type · Hair length")
      .selectOption("preferred");
    await page.getByRole("button", { name: "Preview opportunity" }).click();
    await expect(
      page
        .getByRole("region", { name: "Review items" })
        .getByText(applicantQuestion),
    ).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      await page.getByText(longProcedure, { exact: true }).evaluate((value) => {
        const grid = value.closest("dl");
        if (grid === null) return false;
        const text = document.createRange();
        text.selectNodeContents(value);
        return (
          text.getBoundingClientRect().right <=
          grid.getBoundingClientRect().right
        );
      }),
    ).toBe(true);

    const hardRuleConfirmations = page.getByLabel(/^Confirm hard rule:/);
    const hardRuleCount = await hardRuleConfirmations.count();
    expect(hardRuleCount).toBeGreaterThan(0);
    for (let index = 0; index < hardRuleCount; index += 1) {
      await hardRuleConfirmations.nth(index).check();
    }

    await page.getByRole("button", { name: "Publish opportunity" }).click();
    await expect(page.getByText("Opportunity published.")).toBeVisible();
    const applicantLink = page.getByRole("link", { name: "Applicant link" });
    const recruiterLink = page.getByRole("link", {
      name: "Recruiter review link",
    });
    await expect(applicantLink).toHaveAttribute(
      "href",
      /^\/opportunities\/[0-9a-f-]+\/apply$/,
    );
    await expect(recruiterLink).toHaveAttribute(
      "href",
      /^\/recruiter\/opportunities\/[0-9a-f-]+\/applications$/,
    );
    expect((await applicantLink.boundingBox())?.height).toBeGreaterThanOrEqual(
      44,
    );
    expect((await recruiterLink.boundingBox())?.height).toBeGreaterThanOrEqual(
      44,
    );
    const applicantPath = await applicantLink.getAttribute("href");
    expect(applicantPath).not.toBeNull();
    await page.goto(applicantPath!);
    await expect(
      page.getByRole("group", { name: applicantQuestion }),
    ).toBeVisible();
    await page
      .getByRole("group", { name: "Are you at least 19 years old?" })
      .getByLabel("Yes")
      .check();
    await page
      .getByRole("group", { name: "Can you attend at the listed time?" })
      .getByLabel("Yes")
      .check();
    await page
      .getByRole("group", { name: applicantQuestion })
      .getByLabel("No")
      .check();
    await page.getByRole("button", { name: "Check eligibility" }).click();
    await expect(
      page.getByRole("heading", { name: "You can apply" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Complete application" }).click();
    await page
      .getByLabel("Name or preferred name")
      .fill("Preferred Review Applicant");
    await page.getByLabel("Phone number").fill("01055556666");
    await page.getByLabel("Date of birth").fill("1990-01-01");
    await page
      .getByLabel("I consent to personal-data processing for this application.")
      .check();
    await page.getByRole("button", { name: "Submit application" }).click();
    await expect(
      page.getByRole("heading", {
        name: "Upload a photo to complete your application",
      }),
    ).toBeVisible();
  } finally {
    await context.close();
  }
});

test("publishes a source-aligned makeup opportunity with recruiter-selected model sex", async ({
  browser,
  pilotData,
}) => {
  const context = await browser.newContext({
    baseURL: e2eBaseUrl,
    storageState: pilotData.recruiterOne.storageState,
  });

  try {
    const preferredQuestion =
      "Can you receive the bridal eye makeup described here?";
    const page = await context.newPage();
    await page.goto("/opportunities/new");
    await page.getByLabel("Category").selectOption("makeup_certification");
    await page.getByLabel("Procedure").fill("2026 makeup practical exam model");
    await page.getByLabel("Starts at").fill(localDateTime(8));
    await page.getByLabel("Closes at").fill(localDateTime(7));
    await page.getByLabel("Benefit type").selectOption("cash");
    await page.getByLabel("Cash amount").fill("100000");
    await page.getByLabel("Benefit description").fill("Cash after the exam");
    await page.getByRole("button", { name: "Preview opportunity" }).click();
    await expect(
      page.getByText("Select the required model sex."),
    ).toBeVisible();

    await page.getByLabel("Required model sex").selectOption("female");
    await page
      .getByRole("button", { name: "Target makeup Add condition" })
      .click();
    await page.getByLabel("Question · Target makeup").fill(preferredQuestion);
    await page
      .getByLabel("Expected answer · Target makeup")
      .selectOption("yes");
    await page
      .getByLabel("Condition type · Target makeup")
      .selectOption("preferred");
    await expect(
      page.getByText("Do you currently have eyelash extensions?"),
    ).toBeVisible();
    await expect(page.getByText(/tattoo or henna/i)).toHaveCount(0);
    await page.setViewportSize({ width: 320, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.getByRole("button", { name: "Preview opportunity" }).click();
    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await expect(page.getByText("Applicable exam year: 2026")).toBeVisible();
    await expect(
      page
        .getByRole("region", { name: "Review items" })
        .getByText("Do you currently have eyelash extensions?"),
    ).toBeVisible();
    const hardRuleConfirmations = page.getByLabel(/^Confirm hard rule:/);
    const hardRuleCount = await hardRuleConfirmations.count();
    for (let index = 0; index < hardRuleCount; index += 1) {
      await hardRuleConfirmations.nth(index).check();
    }
    await page.getByRole("button", { name: "Publish opportunity" }).click();
    await expect(page.getByText("Opportunity published.")).toBeVisible();
    const recruiterPath = await page
      .getByRole("link", { name: "Recruiter review link" })
      .getAttribute("href");
    expect(recruiterPath).not.toBeNull();
    const applicantPath = await page
      .getByRole("link", { name: "Applicant link" })
      .getAttribute("href");
    expect(applicantPath).not.toBeNull();
    await page.goto(applicantPath!);
    await expect(
      page.getByRole("group", {
        name: "This opportunity requests a female model. Does that apply to you?",
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("group", {
        name: "Do you currently have eyelash extensions?",
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("group", { name: preferredQuestion }),
    ).toBeVisible();
    await expect(
      page.getByRole("group", {
        name: "Are you 55 or younger under the 2026 exam's birth-year rule?",
      }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("group", { name: "Are you at least 19 years old?" }),
    ).toHaveCount(0);
    const birthDate = page.getByLabel("Date of birth (2026 exam age check)");
    await page.setViewportSize({ width: 320, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    for (const rule of makeupCertificationV2Locked("female")) {
      if (rule.field === "isWithinMakeupAgeLimit" || rule.field === "isAdult")
        continue;
      const question = rule.question?.en;
      if (question === undefined || typeof rule.expected !== "boolean") {
        throw new Error(`Makeup rule ${rule.id} lacks a yes/no question.`);
      }
      await page
        .getByRole("group", { name: question })
        .getByLabel(rule.expected ? "Yes" : "No")
        .check();
    }
    await page
      .getByRole("group", { name: preferredQuestion })
      .getByLabel("No")
      .check();
    await birthDate.fill("2010-01-01");
    await page.getByRole("button", { name: "Check eligibility" }).click();
    await expect(
      page.getByRole("heading", {
        name: "You do not meet the eligibility requirements",
      }),
    ).toBeVisible();
    await birthDate.fill("1970-12-31");
    await page.getByRole("button", { name: "Check eligibility" }).click();
    await expect(
      page.getByRole("heading", {
        name: "You do not meet the eligibility requirements",
      }),
    ).toBeVisible();
    await birthDate.fill("1971-01-01");
    await page.getByRole("button", { name: "Check eligibility" }).click();
    await expect(
      page.getByRole("heading", { name: "You can apply" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Complete application" }).click();
    await page
      .getByLabel("Name or preferred name")
      .fill("2026 Makeup Applicant");
    await page.getByLabel("Phone number").fill("01055557777");
    await page
      .getByLabel("I consent to personal-data processing for this application.")
      .check();
    await page.getByRole("button", { name: "Submit application" }).click();
    await expect(
      page.getByRole("heading", { name: "Application received" }),
    ).toBeVisible();
    await page.goto(recruiterPath!);
    await expect(
      page.getByRole("heading", { name: "2026 Makeup Applicant" }),
    ).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await expect(
      page
        .getByRole("region", { name: "Application answers" })
        .getByText(`${preferredQuestion}: No`),
    ).toBeVisible();
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
