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
    .locator("button, .choice")
    .evaluateAll((elements) =>
      elements.map((element) => ({
        label: element.textContent?.trim(),
        height: element.getBoundingClientRect().height,
      })),
    );
  expect(targets.filter(({ height }) => height < 44)).toEqual([]);

  await page.getByText("Find an existing application").click();
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
