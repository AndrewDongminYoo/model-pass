import { expect, it } from "vitest";
import { koreanRuleReason, localizedRuleReason } from "./ko";

it("shows a known version-one reason in Korean without changing the stored reason", () => {
  const storedReason = "This pilot is available to adults only.";

  expect(koreanRuleReason(storedReason)).toBe(
    "만 19세 이상만 지원할 수 있습니다.",
  );
  expect(storedReason).toBe("This pilot is available to adults only.");
});

it("preserves recruiter-written reasons that do not have a translation", () => {
  expect(koreanRuleReason("Bring your own brush.")).toBe(
    "Bring your own brush.",
  );
});

it("returns the original versioned reason in English", () => {
  const reason = "This pilot is available to adults only.";
  expect(localizedRuleReason(reason, "en")).toBe(reason);
  expect(localizedRuleReason(reason, "ko")).toBe(
    "만 19세 이상만 지원할 수 있습니다.",
  );
});
