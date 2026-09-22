import type { EvaluationResult } from "../../eligibility/domain/types";
import { localizedRuleReason } from "../../eligibility/presentation/ko";
import { useI18n } from "../../../i18n/locale";

interface EligibilityResultProps {
  result: EvaluationResult;
  onContinue: () => void;
}

export function EligibilityResult({
  result,
  onContinue,
}: EligibilityResultProps) {
  const { locale, t } = useI18n();
  if (!result.eligible) {
    return (
      <section className="surface" aria-labelledby="eligibility-failed-heading">
        <h2 id="eligibility-failed-heading">
          {t(
            "You do not meet the eligibility requirements",
            "지원 조건에 맞지 않습니다",
          )}
        </h2>
        <div role="alert">
          <p>
            {t(
              "The answers below do not meet this opportunity's required conditions.",
              "아래 답변은 이 공고의 필수 조건과 맞지 않습니다.",
            )}
          </p>
          <ul>
            {result.failures.map((failure) => (
              <li key={failure.ruleId}>
                {localizedRuleReason(failure.reason, locale)}
              </li>
            ))}
          </ul>
        </div>
      </section>
    );
  }

  return (
    <section className="surface" aria-labelledby="eligibility-passed-heading">
      <h2 id="eligibility-passed-heading">
        {t("You can apply", "지원할 수 있습니다")}
      </h2>
      {result.reminders.length > 0 ? (
        <div>
          <h3>{t("Before your visit", "방문 전 확인")}</h3>
          <ul>
            {result.reminders.map((reminder) => (
              <li key={reminder.ruleId}>
                {localizedRuleReason(reminder.reason, locale)}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <p className="helper-text">
        {t(
          "You cannot upload a photo at this step. We will request one only when needed after you submit your application.",
          "이 단계에서는 사진을 올릴 수 없습니다. 지원서 제출 후 필요한 경우에만 사진을 요청합니다.",
        )}
      </p>
      <button type="button" onClick={onContinue}>
        {t("Complete application", "지원서 작성하기")}
      </button>
    </section>
  );
}
