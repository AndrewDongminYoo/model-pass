import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { I18nContext } from "../../../i18n/locale";
import type { RuleDefinition } from "../../eligibility/domain/types";
import { EligibilityForm } from "./EligibilityForm";

const defaults = {
  context: { rulesetId: "hair-promotion", rulesetVersion: 2 },
  answers: {},
  onAnswersChange: vi.fn(),
  onEvaluate: vi.fn(),
};

it("shows the authored question from a published rule snapshot", () => {
  const rules: RuleDefinition[] = [
    {
      id: "hair-length",
      field: "hairLength",
      operator: "equals",
      expected: true,
      effect: "hard_fail",
      reason: "긴 머리 모델을 찾습니다.",
      question: {
        en: "Is your hair at least shoulder length?",
        ko: "현재 머리카락이 어깨 아래까지 내려오나요?",
      },
    },
  ];

  render(<EligibilityForm {...defaults} rules={rules} />);

  expect(
    screen.getByRole("group", {
      name: "현재 머리카락이 어깨 아래까지 내려오나요?",
    }),
  ).toBeVisible();
});

it("keeps legacy field labels when a stored rule has no authored question", () => {
  const rules: RuleDefinition[] = [
    {
      id: "adult-only",
      field: "isAdult",
      operator: "equals",
      expected: true,
      effect: "hard_fail",
      reason: "Adults only.",
    },
  ];

  render(<EligibilityForm {...defaults} rules={rules} />);

  expect(
    screen.getByRole("group", { name: "만 19세 이상인가요?" }),
  ).toBeVisible();
});

it("uses the English variant of a built-in question in English mode", () => {
  render(
    <I18nContext.Provider
      value={{ locale: "en", setLocale: vi.fn(), t: (en) => en }}
    >
      <EligibilityForm
        {...defaults}
        rules={[
          {
            id: "schedule-available",
            field: "isAvailable",
            operator: "equals",
            expected: true,
            effect: "hard_fail",
            reason: "This schedule is unavailable.",
            question: {
              en: "Can you attend at the listed time?",
              ko: "공고에 적힌 일시에 참여할 수 있나요?",
            },
          },
        ]}
      />
    </I18nContext.Provider>,
  );

  expect(
    screen.getByRole("group", { name: "Can you attend at the listed time?" }),
  ).toBeVisible();
});
