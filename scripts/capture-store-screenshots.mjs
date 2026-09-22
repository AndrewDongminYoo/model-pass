import { mkdir } from "node:fs/promises";
import { URL } from "node:url";
import { chromium } from "@playwright/test";

const outputDirectory = new URL("../assets/apps-in-toss/", import.meta.url);
const opportunityId = "00000000-0000-4000-8000-000000000001";
const opportunity = {
  id: opportunityId,
  category: "makeup_certification",
  title: "메이크업 국가자격 실기시험 모델",
  startsAt: "2026-10-15T10:00:00+09:00",
  closesAt: "2026-10-12T18:00:00+09:00",
  venueDistrict: "서울 강남구",
  expectedMinutes: 180,
  benefit: {
    type: "cash",
    amount: 80000,
    description: "시험 종료 후 현금 지급",
  },
  rulesetId: "makeup-certification",
  rulesetVersion: 1,
  rules: [
    {
      id: "adult-only",
      field: "isAdult",
      operator: "equals",
      expected: true,
      effect: "hard_fail",
      reason: "This pilot is available to adults only.",
    },
    {
      id: "schedule-available",
      field: "isAvailable",
      operator: "equals",
      expected: true,
      effect: "hard_fail",
      reason: "This schedule is unavailable.",
    },
  ],
};

await mkdir(outputDirectory, { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 636, height: 1048 },
    deviceScaleFactor: 1,
    locale: "ko-KR",
  });
  await page.route(
    "https://model-pass.example.invalid/functions/v1/get-public-opportunity",
    (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(opportunity),
      }),
  );

  await page.goto("http://127.0.0.1:5173/");
  await page.waitForLoadState("networkidle");
  await page.screenshot({
    path: new URL("screenshot-01-intro.png", outputDirectory).pathname,
    animations: "disabled",
  });

  await page.goto(`http://127.0.0.1:5173/opportunities/${opportunityId}/apply`);
  await page.getByRole("heading", { name: opportunity.title }).waitFor();
  await page.screenshot({
    path: new URL("screenshot-02-opportunity.png", outputDirectory).pathname,
    animations: "disabled",
  });

  for (const question of [
    "만 19세 이상인가요?",
    "모집 일정에 참여할 수 있나요?",
  ]) {
    await page.getByRole("group", { name: question }).getByLabel("예").check();
  }
  await page.getByRole("button", { name: "지원 조건 확인" }).click();
  await page.getByRole("button", { name: "지원서 작성하기" }).click();
  await page
    .getByRole("heading", { name: "지원자 정보" })
    .evaluate((heading) => {
      globalThis.scrollTo(
        0,
        heading.getBoundingClientRect().top + globalThis.scrollY - 28,
      );
    });
  await page.screenshot({
    path: new URL("screenshot-03-application.png", outputDirectory).pathname,
    animations: "disabled",
  });
} finally {
  await browser.close();
}
