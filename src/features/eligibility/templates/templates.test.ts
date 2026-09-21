import type { RuleDefinition, RuleEffect } from "../domain/types";
import { hairPromotionV1 } from "./hair-promotion-v1";
import { makeupCertificationV1 } from "./makeup-certification-v1";

function expectRuleEffect(
  rules: readonly RuleDefinition[],
  id: string,
  field: string,
  effect: RuleEffect,
): void {
  expect(rules).toContainEqual(expect.objectContaining({ id, field, effect }));
}

describe("makeupCertificationV1", () => {
  // Production break: downgrading permanent procedures or persistent visible marks from hard rules.
  it("makes permanent procedures and persistent visible marks hard rules", () => {
    expectRuleEffect(
      makeupCertificationV1,
      "permanent-or-semi-permanent-eyebrow",
      "hasPermanentOrSemiPermanentEyebrow",
      "hard_fail",
    );
    expectRuleEffect(
      makeupCertificationV1,
      "permanent-or-semi-permanent-eyeliner",
      "hasPermanentOrSemiPermanentEyeliner",
      "hard_fail",
    );
    expectRuleEffect(
      makeupCertificationV1,
      "permanent-or-semi-permanent-lips",
      "hasPermanentOrSemiPermanentLipProcedure",
      "hard_fail",
    );
    expectRuleEffect(
      makeupCertificationV1,
      "persistent-visible-marks",
      "hasPersistentVisibleMarks",
      "hard_fail",
    );
  });

  // Production break: blocking an applicant for a day-of condition they can remove before the appointment.
  it("makes removable day-of conditions reminders", () => {
    expectRuleEffect(
      makeupCertificationV1,
      "remove-day-of-makeup",
      "wearsDayOfMakeup",
      "reminder",
    );
    expectRuleEffect(
      makeupCertificationV1,
      "remove-lenses",
      "wearsLenses",
      "reminder",
    );
    expectRuleEffect(
      makeupCertificationV1,
      "remove-accessories",
      "wearsAccessories",
      "reminder",
    );
  });
});

describe("hairPromotionV1", () => {
  // Production break: allowing an applicant who rejects the target style or recruiter constraints to remain eligible.
  it("makes target-style acceptance and recruiter constraints hard rules", () => {
    expectRuleEffect(
      hairPromotionV1,
      "accepts-target-style",
      "acceptsTargetStyle",
      "hard_fail",
    );
    expectRuleEffect(
      hairPromotionV1,
      "meets-recruiter-constraints",
      "meetsRecruiterConstraints",
      "hard_fail",
    );
  });

  // Production break: automatically rejecting an ambiguous hair-condition photo instead of routing it to review.
  it("routes an ambiguous hair-condition photo to recruiter review", () => {
    expectRuleEffect(
      hairPromotionV1,
      "hair-condition-photo-clear",
      "hairConditionPhotoIsClear",
      "needs_review",
    );
  });
});
