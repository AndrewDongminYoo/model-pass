import type { RuleDefinition } from "../domain/types";

export const hairPromotionV1 = [
  {
    id: "adult-only",
    field: "isAdult",
    operator: "equals",
    expected: true,
    effect: "hard_fail",
    reason: "This pilot is available to adults only.",
  },
  {
    id: "meets-current-length-requirement",
    field: "meetsCurrentLengthRequirement",
    operator: "equals",
    expected: true,
    effect: "hard_fail",
    reason:
      "The current hair length does not meet this opportunity's requirement.",
  },
  {
    id: "meets-current-style-requirement",
    field: "meetsCurrentStyleRequirement",
    operator: "equals",
    expected: true,
    effect: "hard_fail",
    reason:
      "The current hairstyle does not meet this opportunity's requirement.",
  },
  {
    id: "meets-recent-dye-requirement",
    field: "meetsRecentDyeRequirement",
    operator: "equals",
    expected: true,
    effect: "hard_fail",
    reason: "Recent dye history does not meet this opportunity's requirement.",
  },
  {
    id: "meets-recent-bleach-requirement",
    field: "meetsRecentBleachRequirement",
    operator: "equals",
    expected: true,
    effect: "hard_fail",
    reason:
      "Recent bleach history does not meet this opportunity's requirement.",
  },
  {
    id: "meets-recent-perm-requirement",
    field: "meetsRecentPermRequirement",
    operator: "equals",
    expected: true,
    effect: "hard_fail",
    reason: "Recent perm history does not meet this opportunity's requirement.",
  },
  {
    id: "accepts-target-style",
    field: "acceptsTargetStyle",
    operator: "equals",
    expected: true,
    effect: "hard_fail",
    reason: "This opportunity requires acceptance of the target style.",
  },
  {
    id: "meets-recruiter-constraints",
    field: "meetsRecruiterConstraints",
    operator: "equals",
    expected: true,
    effect: "hard_fail",
    reason: "This opportunity's recruiter constraints are not met.",
  },
  {
    id: "hair-condition-photo-clear",
    field: "hairConditionPhotoIsClear",
    operator: "equals",
    expected: true,
    effect: "needs_review",
    reason: "A recruiter must review the hair-condition photo.",
  },
  {
    id: "schedule-available",
    field: "isAvailable",
    operator: "equals",
    expected: true,
    effect: "hard_fail",
    reason: "This schedule is unavailable.",
  },
] satisfies readonly RuleDefinition[];
