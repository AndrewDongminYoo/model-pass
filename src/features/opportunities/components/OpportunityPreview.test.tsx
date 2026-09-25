import { render, screen } from "@testing-library/react";
import { OpportunityPreview } from "./OpportunityPreview";
import type { OpportunityDraft } from "../domain/opportunity";

it("previews the exact published question instead of only its evaluation reason", () => {
  const draft: OpportunityDraft = {
    category: "hair_promotion",
    title: "레이어드 컷 모델",
    startsAt: "2099-06-01T10:00:00.000Z",
    closesAt: "2099-05-31T18:00:00.000Z",
    venueDistrict: "서울 강남구",
    expectedMinutes: 90,
    benefit: { type: "procedure", description: "무료 커트" },
    rulesetId: "hair-promotion",
    rulesetVersion: 2,
    rules: [
      {
        id: "adult-only",
        field: "isAdult",
        operator: "equals",
        expected: true,
        effect: "hard_fail",
        reason: "This pilot is available to adults only.",
        question: {
          en: "Are you at least 19 years old?",
          ko: "만 19세 이상인가요?",
        },
      },
    ],
  };

  render(<OpportunityPreview draft={draft} />);

  expect(screen.getByText("만 19세 이상인가요?")).toBeVisible();
  expect(
    screen.queryByText("만 19세 이상만 지원할 수 있습니다."),
  ).not.toBeInTheDocument();
});

it("shows the current exam year for a version 2 makeup preview", () => {
  const draft: OpportunityDraft = {
    category: "makeup_certification",
    title: "메이크업 시험 모델",
    startsAt: "2099-06-01T10:00:00.000Z",
    closesAt: "2099-05-31T18:00:00.000Z",
    venueDistrict: "서울 강남구",
    expectedMinutes: 120,
    benefit: { type: "cash", amount: 100000, description: "현금 지급" },
    rulesetId: "makeup-certification",
    rulesetVersion: 2,
    rules: [],
  };

  render(<OpportunityPreview draft={draft} />);

  expect(screen.getByText("적용 시험 연도: 2026년")).toBeVisible();
});
