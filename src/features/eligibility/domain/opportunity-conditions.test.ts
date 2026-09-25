import { parseRuleDefinitions } from "./types";
import {
  isWithinMakeupExamAgeLimit,
  isWithinMakeupExamYear,
} from "../templates/makeup-certification-v2";
import {
  assertCanonicalOpportunityRules,
  buildOpportunityRules,
} from "./opportunity-conditions";

const lengthCondition = {
  id: "shoulder-length",
  field: "hasShoulderLength",
  question: {
    en: "현재 머리가 어깨 아래까지 오나요?",
    ko: "현재 머리가 어깨 아래까지 오나요?",
  },
  expected: true,
  effect: "hard_fail" as const,
};

it("uses the 2026 exam's birth-year and Seoul event-year boundaries", () => {
  expect(isWithinMakeupExamAgeLimit("1970-12-31")).toBe(false);
  expect(isWithinMakeupExamAgeLimit("1971-01-01")).toBe(true);
  expect(isWithinMakeupExamAgeLimit("not-a-date")).toBeNull();
  expect(isWithinMakeupExamYear("2026-12-31T23:00")).toBe(true);
  expect(isWithinMakeupExamYear("2026-12-31T15:00:00.000Z")).toBe(false);
  expect(isWithinMakeupExamYear("2027-01-01T00:00:00.000Z")).toBe(false);
});

it("keeps the published applicant question when a rule snapshot is parsed", () => {
  const rules = parseRuleDefinitions([
    {
      id: "current-length",
      field: "hasRequiredLength",
      operator: "equals",
      expected: true,
      effect: "hard_fail",
      reason: "어깨 아래 길이의 머리인가요?",
      question: {
        en: "어깨 아래 길이의 머리인가요?",
        ko: "어깨 아래 길이의 머리인가요?",
      },
    },
  ]);

  expect(rules[0]?.question).toEqual({
    en: "어깨 아래 길이의 머리인가요?",
    ko: "어깨 아래 길이의 머리인가요?",
  });
});

it("builds a hair snapshot with trusted platform rules and a concrete condition", () => {
  const rules = buildOpportunityRules({
    category: "hair_promotion",
    rulesetVersion: 2,
    conditions: [lengthCondition],
  });

  expect(rules.map((rule) => rule.id)).toEqual([
    "adult-only",
    "schedule-available",
    "hair-condition-photo-clear",
    "shoulder-length",
  ]);
  expect(rules[0]).toMatchObject({
    field: "isAdult",
    expected: true,
    effect: "hard_fail",
  });
  expect(rules[2]).toMatchObject({
    field: "hairConditionPhotoIsClear",
    effect: "needs_review",
  });
  expect("question" in (rules[2] ?? {})).toBe(false);
  expect(rules[3]).toEqual({
    ...lengthCondition,
    operator: "equals",
    reason: "현재 머리가 어깨 아래까지 오나요?",
  });
});

it("keeps an unmet preferred answer eligible for recruiter review", () => {
  const rules = buildOpportunityRules({
    category: "hair_promotion",
    rulesetVersion: 2,
    conditions: [{ ...lengthCondition, effect: "needs_review" }],
  });

  expect(rules.at(-1)).toMatchObject({
    id: "shoulder-length",
    effect: "needs_review",
    expected: true,
  });
});

it("rejects an empty or duplicated custom question before publication", () => {
  expect(() =>
    buildOpportunityRules({
      category: "hair_promotion",
      rulesetVersion: 2,
      conditions: [{ ...lengthCondition, question: { en: "", ko: "" } }],
    }),
  ).toThrow("Condition question is required.");
  expect(() =>
    buildOpportunityRules({
      category: "hair_promotion",
      rulesetVersion: 2,
      conditions: [lengthCondition, lengthCondition],
    }),
  ).toThrow("Duplicate condition ID.");
});

it("rejects a condition field that could read an inherited answer", () => {
  expect(() =>
    buildOpportunityRules({
      category: "hair_promotion",
      rulesetVersion: 2,
      conditions: [{ ...lengthCondition, field: "__proto__" }],
    }),
  ).toThrow("Condition field is invalid.");
});

it("rejects custom fields reserved for hidden photos or another template", () => {
  for (const field of ["customPhotoEvidence", "isWithinMakeupAgeLimit"]) {
    expect(() =>
      buildOpportunityRules({
        category: "hair_promotion",
        rulesetVersion: 2,
        conditions: [{ ...lengthCondition, field }],
      }),
    ).toThrow("Condition field is invalid.");
  }
});

it("rejects a caller that removes or edits a locked hair rule", () => {
  const rules = buildOpportunityRules({
    category: "hair_promotion",
    rulesetVersion: 2,
    conditions: [lengthCondition],
  });
  const input = {
    category: "hair_promotion" as const,
    rulesetId: "hair-promotion",
    rulesetVersion: 2,
    conditions: [lengthCondition],
  };

  expect(() =>
    assertCanonicalOpportunityRules({ ...input, rules: rules.slice(1) }),
  ).toThrow("Published rules do not match the preview.");
  expect(() =>
    assertCanonicalOpportunityRules({
      ...input,
      rules: [{ ...rules[0], expected: false }, ...rules.slice(1)],
    }),
  ).toThrow("Published rules do not match the preview.");
  expect(assertCanonicalOpportunityRules({ ...input, rules })).toEqual(rules);
});

it("requires a recruiter-specified makeup model sex", () => {
  expect(() =>
    buildOpportunityRules({
      category: "makeup_certification",
      rulesetVersion: 2,
      conditions: [],
    }),
  ).toThrow("Required model sex is missing.");
});

it("builds a source-aligned makeup template without tattoo or henna exclusions", () => {
  const rules = buildOpportunityRules({
    category: "makeup_certification",
    rulesetVersion: 2,
    requiredModelSex: "female",
    conditions: [],
  });

  expect(rules).toContainEqual(
    expect.objectContaining({
      field: "matchesRequiredSex",
      effect: "hard_fail",
      question: expect.objectContaining({
        ko: expect.stringContaining("여성"),
      }),
    }),
  );
  expect(rules).toContainEqual(
    expect.objectContaining({
      field: "hasEyelashExtensions",
      expected: false,
      effect: "needs_review",
    }),
  );
  expect(rules).toContainEqual(
    expect.objectContaining({
      field: "hasPermanentOrSemiPermanentEyebrow",
      expected: false,
      effect: "needs_review",
    }),
  );
  expect(rules).toContainEqual(
    expect.objectContaining({
      field: "isWithinMakeupAgeLimit",
      expected: true,
      effect: "hard_fail",
    }),
  );
  expect(rules.some((rule) => rule.field === "hasVisibleTattooOrHenna")).toBe(
    false,
  );
  expect(rules.some((rule) => rule.field === "hasPersistentVisibleMarks")).toBe(
    false,
  );
  expect(rules.every((rule) => rule.question !== undefined)).toBe(true);
});

it("rejects a makeup preview that changes a score-deduction review item", () => {
  const input = {
    category: "makeup_certification" as const,
    rulesetId: "makeup-certification",
    rulesetVersion: 2,
    requiredModelSex: "male" as const,
    conditions: [],
  };
  const rules = buildOpportunityRules({
    category: input.category,
    rulesetVersion: input.rulesetVersion,
    requiredModelSex: input.requiredModelSex,
    conditions: input.conditions,
  });
  const edited = rules.map((rule) =>
    rule.field === "hasEyelashExtensions"
      ? { ...rule, effect: "hard_fail" as const }
      : rule,
  );

  expect(() =>
    assertCanonicalOpportunityRules({ ...input, rules: edited }),
  ).toThrow("Published rules do not match the preview.");
});
