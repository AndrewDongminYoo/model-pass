import { test, expect } from "./fixtures";

test("keeps the applicant flow touch-friendly and motion-safe on mobile", async ({
  page,
  pilotData,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/opportunities/${pilotData.hairOpportunityId}/apply`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Gangnam hair promotion model",
  );

  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  const targets = await page
    .locator("button:visible, .choice:visible")
    .evaluateAll((elements) =>
      elements.map((element) => ({
        label: element.textContent?.trim(),
        height: element.getBoundingClientRect().height,
      })),
    );
  expect(targets.filter(({ height }) => height < 44)).toEqual([]);

  await page.getByText("Find an existing application").click();
  expect(
    await page
      .getByRole("button", { name: "View application" })
      .evaluate((control) => control.getBoundingClientRect().height),
  ).toBeGreaterThanOrEqual(44);
  const applicationId = page.getByLabel("Application ID");
  expect(
    await applicationId.evaluate((input) => getComputedStyle(input).boxShadow),
  ).toBe("none");
  await page.keyboard.press("Tab");
  await expect(applicationId).toBeFocused();
  expect(
    await applicationId.evaluate((input) => getComputedStyle(input).boxShadow),
  ).not.toBe("none");

  const button = page.getByRole("button", { name: "English" });
  expect(
    Number.parseFloat(
      await button.evaluate(
        (control) => getComputedStyle(control).transitionDuration,
      ),
    ),
  ).toBeGreaterThan(0.001);
  await page.emulateMedia({ reducedMotion: "reduce" });
  expect(
    Number.parseFloat(
      await button.evaluate(
        (control) => getComputedStyle(control).transitionDuration,
      ),
    ),
  ).toBeLessThan(0.001);
});

test("keeps wrapped Korean eligibility questions inside their cards", async ({
  page,
  pilotData,
}) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await page.goto(`/opportunities/${pilotData.hairOpportunityId}/apply`);
  await page.getByRole("button", { name: "한국어" }).click();
  await expect(page.locator(".choice-card").first()).toBeVisible();

  const legendsInsideCards = await page
    .locator(".choice-card")
    .evaluateAll((cards) =>
      cards.map((card) => {
        const legend = card.querySelector("legend");
        if (!legend) {
          return false;
        }
        const cardBounds = card.getBoundingClientRect();
        const legendBounds = legend.getBoundingClientRect();
        return legendBounds.top >= cardBounds.top + 8;
      }),
    );
  expect(legendsInsideCards.length).toBeGreaterThan(0);
  expect(legendsInsideCards.every(Boolean)).toBe(true);
});
