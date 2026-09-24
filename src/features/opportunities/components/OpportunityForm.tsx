import { useState, type FormEvent } from "react";
import {
  buildOpportunityRules,
  type EditableCondition,
} from "../../eligibility/domain/opportunity-conditions";
import {
  hairPromotionV2Locked,
  hairPromotionV2Metadata,
  hairPromotionV2Suggestions,
} from "../../eligibility/templates/hair-promotion-v2";
import {
  makeupCertificationV2Locked,
  makeupCertificationV2Metadata,
  makeupCertificationV2Suggestions,
  isWithinMakeupExamYear,
} from "../../eligibility/templates/makeup-certification-v2";
import { localizedRuleReason } from "../../eligibility/presentation/ko";
import {
  opportunityDraftSchema,
  type OpportunityCategory,
  type OpportunityDraft,
} from "../domain/opportunity";
import { useI18n } from "../../../i18n/locale";

interface OpportunityFormProps {
  onSubmit: (draft: OpportunityDraft) => void;
}

type BenefitType = "cash" | "procedure";

interface DraftCondition {
  id: string;
  field: string;
  label: { en: string; ko: string };
  example?: { en: string; ko: string };
  question: string;
  expected: "" | "yes" | "no";
  effect: "hard_fail" | "needs_review";
}

const validationMessages: Record<string, readonly [string, string]> = {
  rules_invalid: ["Check the eligibility rules.", "지원 조건을 확인해 주세요."],
  title_required: [
    "Enter the procedure.",
    "시술 또는 시험 내용을 입력해 주세요.",
  ],
  starts_at_required: ["Enter the start date.", "시작 일시를 입력해 주세요."],
  starts_at_future: [
    "Start date must be in the future.",
    "시작 일시는 현재 이후여야 합니다.",
  ],
  closes_at_required: [
    "Enter the closing date.",
    "지원 마감 일시를 입력해 주세요.",
  ],
  closes_at_future: [
    "Closing date must be in the future.",
    "지원 마감 일시는 현재 이후여야 합니다.",
  ],
  venue_district_required: [
    "Enter the venue district.",
    "장소 지역을 입력해 주세요.",
  ],
  expected_minutes_required: [
    "Enter the expected duration.",
    "예상 소요 시간을 입력해 주세요.",
  ],
  cash_amount_required: [
    "Enter the cash amount.",
    "지급 금액을 입력해 주세요.",
  ],
  benefit_description_required: [
    "Enter the benefit description.",
    "혜택을 설명해 주세요.",
  ],
  closes_at_before_starts_at: [
    "Closing date must be before the start date.",
    "지원 마감 일시는 시작 일시보다 빨라야 합니다.",
  ],
  condition_question_required: [
    "Enter the exact question applicants will see.",
    "지원자에게 보여줄 질문을 입력해 주세요.",
  ],
  condition_expected_required: [
    "Select the expected answer.",
    "기대 답변을 선택해 주세요.",
  ],
  conditions_invalid: [
    "Check the condition questions and identifiers.",
    "조건 질문과 식별자를 확인해 주세요.",
  ],
  required_model_sex: [
    "Select the required model sex.",
    "필요한 모델 성별을 선택해 주세요.",
  ],
  makeup_exam_year: [
    "Only 2026 exam dates can be published with this template.",
    "2026년 시험 일시만 등록할 수 있습니다.",
  ],
};

export function OpportunityForm({ onSubmit }: OpportunityFormProps) {
  const { locale, t } = useI18n();
  const [category, setCategory] =
    useState<OpportunityCategory>("hair_promotion");
  const [title, setTitle] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [closesAt, setClosesAt] = useState("");
  const [venueDistrict, setVenueDistrict] = useState("서울 강남구");
  const [expectedMinutes, setExpectedMinutes] = useState("60");
  const [benefitType, setBenefitType] = useState<BenefitType>("procedure");
  const [benefitDescription, setBenefitDescription] = useState("");
  const [cashAmount, setCashAmount] = useState("");
  const [conditions, setConditions] = useState<DraftCondition[]>([]);
  const [nextCustomId, setNextCustomId] = useState(1);
  const [requiredModelSex, setRequiredModelSex] = useState<
    "" | "female" | "male"
  >("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const suggestions =
    category === "hair_promotion"
      ? hairPromotionV2Suggestions
      : makeupCertificationV2Suggestions;

  function addSuggestion(suggestion: (typeof suggestions)[number]) {
    setConditions((current) => [
      ...current,
      {
        id: suggestion.id,
        field: suggestion.field,
        label: suggestion.label,
        example: suggestion.example,
        question: "",
        expected: "",
        effect: "hard_fail",
      },
    ]);
  }

  function addCustomCondition() {
    setConditions((current) => [
      ...current,
      {
        id: `custom-${nextCustomId}`,
        field: `customCondition${nextCustomId}`,
        label: {
          en: `Custom condition ${nextCustomId}`,
          ko: `직접 추가한 조건 ${nextCustomId}`,
        },
        question: "",
        expected: "",
        effect: "hard_fail",
      },
    ]);
    setNextCustomId((current) => current + 1);
  }

  function updateCondition(id: string, update: Partial<DraftCondition>) {
    setConditions((current) =>
      current.map((condition) =>
        condition.id === id ? { ...condition, ...update } : condition,
      ),
    );
    setErrors((current) => {
      const next = { ...current };
      delete next[`conditions.${id}.question`];
      delete next[`conditions.${id}.expected`];
      return next;
    });
  }

  function localizeValidationMessage(code: string) {
    const translation = validationMessages[code];
    return translation ? t(...translation) : code;
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const isMakeup = category === "makeup_certification";
    const result = opportunityDraftSchema.safeParse({
      category,
      title,
      startsAt,
      closesAt,
      venueDistrict,
      expectedMinutes,
      benefit:
        benefitType === "cash"
          ? {
              type: "cash",
              amount: cashAmount,
              description: benefitDescription,
            }
          : { type: "procedure", description: benefitDescription },
      rulesetId: isMakeup
        ? makeupCertificationV2Metadata.id
        : hairPromotionV2Metadata.id,
      rulesetVersion: 2,
      rules: [],
    });

    if (!result.success) {
      const nextErrors: Record<string, string> = {};
      for (const issue of result.error.issues) {
        const key = issue.path.join(".");
        if (!nextErrors[key]) nextErrors[key] = issue.message;
      }
      setErrors(nextErrors);
      return;
    }

    const nextErrors: Record<string, string> = {};
    if (isMakeup && !isWithinMakeupExamYear(result.data.startsAt)) {
      nextErrors.startsAt = "makeup_exam_year";
    }
    if (isMakeup && requiredModelSex === "") {
      nextErrors.requiredModelSex = "required_model_sex";
    }
    for (const condition of conditions) {
      if (condition.question.trim().length === 0) {
        nextErrors[`conditions.${condition.id}.question`] =
          "condition_question_required";
      }
      if (condition.expected === "") {
        nextErrors[`conditions.${condition.id}.expected`] =
          "condition_expected_required";
      }
    }
    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      return;
    }

    const editableConditions: EditableCondition[] = conditions.map(
      (condition) => ({
        id: condition.id,
        field: condition.field,
        question: {
          en: condition.question.trim(),
          ko: condition.question.trim(),
        },
        expected: condition.expected === "yes",
        effect: condition.effect,
      }),
    );

    let rules;
    try {
      rules = buildOpportunityRules({
        category,
        rulesetVersion: 2,
        conditions: editableConditions,
        requiredModelSex: requiredModelSex || undefined,
      });
    } catch {
      setErrors({ conditions: "conditions_invalid" });
      return;
    }

    setErrors({});
    onSubmit({
      ...result.data,
      rules,
      conditions: editableConditions,
      requiredModelSex: requiredModelSex || undefined,
    });
  }

  return (
    <form className="surface form-stack" onSubmit={submit} noValidate>
      <h2>{t("Session details", "모집 일정과 혜택")}</h2>
      <div className="field">
        <label htmlFor="category">{t("Category", "모집 분야")}</label>
        <select
          id="category"
          value={category}
          onChange={(event) => {
            setCategory(event.target.value as OpportunityCategory);
            setConditions([]);
            setRequiredModelSex("");
            setErrors({});
          }}
        >
          <option value="hair_promotion">
            {t("Hair promotion exam", "헤어 디자이너 승급 시험")}
          </option>
          <option value="makeup_certification">
            {t("Makeup certification exam", "메이크업 국가자격 실기시험")}
          </option>
        </select>
      </div>
      <div className="field">
        <label htmlFor="procedure">
          {t("Procedure", "시술 또는 시험 내용")}
        </label>
        <input
          id="procedure"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />
        {errors.title && (
          <p role="alert">{localizeValidationMessage(errors.title)}</p>
        )}
      </div>
      <div className="field">
        <label htmlFor="starts-at">{t("Starts at", "시작 일시")}</label>
        <input
          id="starts-at"
          type="datetime-local"
          value={startsAt}
          onChange={(event) => setStartsAt(event.target.value)}
        />
        {errors.startsAt && (
          <p role="alert">{localizeValidationMessage(errors.startsAt)}</p>
        )}
      </div>
      <div className="field">
        <label htmlFor="closes-at">{t("Closes at", "지원 마감 일시")}</label>
        <input
          id="closes-at"
          type="datetime-local"
          value={closesAt}
          onChange={(event) => setClosesAt(event.target.value)}
        />
        {errors.closesAt && (
          <p role="alert">{localizeValidationMessage(errors.closesAt)}</p>
        )}
      </div>
      <div className="field">
        <label htmlFor="venue-district">
          {t("Venue district", "장소 지역")}
        </label>
        <input
          id="venue-district"
          value={venueDistrict}
          onChange={(event) => setVenueDistrict(event.target.value)}
        />
        {errors.venueDistrict && (
          <p role="alert">{localizeValidationMessage(errors.venueDistrict)}</p>
        )}
      </div>
      <div className="field">
        <label htmlFor="expected-minutes">
          {t("Expected duration (minutes)", "예상 소요 시간(분)")}
        </label>
        <input
          id="expected-minutes"
          type="number"
          min="1"
          value={expectedMinutes}
          onChange={(event) => setExpectedMinutes(event.target.value)}
        />
        {errors.expectedMinutes && (
          <p role="alert">
            {localizeValidationMessage(errors.expectedMinutes)}
          </p>
        )}
      </div>
      <div className="field">
        <label htmlFor="benefit-type">{t("Benefit type", "제공 혜택")}</label>
        <select
          id="benefit-type"
          value={benefitType}
          onChange={(event) =>
            setBenefitType(event.target.value as BenefitType)
          }
        >
          <option value="procedure">
            {t("Free or nearly free procedure", "무료 또는 할인 시술")}
          </option>
          <option value="cash">{t("Cash", "현금 지급")}</option>
        </select>
      </div>
      <div className="field">
        <label htmlFor="benefit-description">
          {t("Benefit description", "혜택 설명")}
        </label>
        <input
          id="benefit-description"
          value={benefitDescription}
          onChange={(event) => setBenefitDescription(event.target.value)}
        />
        {errors["benefit.description"] && (
          <p role="alert">
            {localizeValidationMessage(errors["benefit.description"])}
          </p>
        )}
      </div>
      {benefitType === "cash" && (
        <div className="field">
          <label htmlFor="cash-amount">
            {t("Cash amount", "지급 금액(원)")}
          </label>
          <input
            id="cash-amount"
            type="number"
            min="1"
            value={cashAmount}
            onChange={(event) => setCashAmount(event.target.value)}
          />
          {errors["benefit.amount"] && (
            <p role="alert">
              {localizeValidationMessage(errors["benefit.amount"])}
            </p>
          )}
        </div>
      )}
      <section
        className="condition-editor"
        aria-labelledby="condition-editor-heading"
      >
        <div>
          <h3 id="condition-editor-heading">
            {t("Applicant conditions", "지원자 조건")}
          </h3>
          <p className="helper-text">
            {t(
              "Add only conditions you can state as a clear yes-or-no question.",
              "예 또는 아니요로 분명히 답할 수 있는 조건만 추가해 주세요.",
            )}
          </p>
        </div>
        {category === "hair_promotion" ? (
          <div className="condition-list">
            {hairPromotionV2Locked.map((rule) => (
              <div
                className="condition-card condition-card--locked"
                key={rule.id}
              >
                <span className="condition-card__badge">
                  {t("Fixed", "변경 불가")}
                </span>
                <p>
                  {rule.question?.[locale] ??
                    localizedRuleReason(rule.reason, locale)}
                </p>
              </div>
            ))}
          </div>
        ) : (
          <>
            <p className="helper-text">
              {t(
                "Based on the 2026 Q-net makeup exam notice. Score-deduction items are for recruiter review, not automatic rejection. Model sex is specified by the recruiter.",
                "2026년 큐넷 메이크업 시험 공고를 기준으로 합니다. 감점 가능 항목은 자동 탈락이 아닌 모집자 검토 항목이며, 모델 성별은 모집자가 지정합니다.",
              )}{" "}
              <a
                href={makeupCertificationV2Metadata.officialSourceUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                {t("2026 Q-net exam notice", "2026년 큐넷 시험 공고")}
              </a>
            </p>
            <div className="field">
              <label htmlFor="required-model-sex">
                {t("Required model sex", "필요한 모델 성별")}
              </label>
              <select
                id="required-model-sex"
                value={requiredModelSex}
                aria-invalid={errors.requiredModelSex ? true : undefined}
                onChange={(event) => {
                  setRequiredModelSex(
                    event.target.value as "" | "female" | "male",
                  );
                  setErrors((current) => ({
                    ...current,
                    requiredModelSex: "",
                  }));
                }}
              >
                <option value="">{t("Select", "선택해 주세요")}</option>
                <option value="female">{t("Female", "여성")}</option>
                <option value="male">{t("Male", "남성")}</option>
              </select>
              {errors.requiredModelSex && (
                <p role="alert">
                  {localizeValidationMessage(errors.requiredModelSex)}
                </p>
              )}
            </div>
            <div className="condition-list">
              {makeupCertificationV2Locked(requiredModelSex || "female")
                .filter(
                  (rule) =>
                    requiredModelSex !== "" ||
                    rule.id !== "matches-required-sex",
                )
                .map((rule) => (
                  <div
                    className="condition-card condition-card--locked"
                    key={rule.id}
                  >
                    <span className="condition-card__badge">
                      {rule.id === "matches-required-sex"
                        ? t("Recruiter-specified", "모집자 지정")
                        : rule.effect === "needs_review"
                          ? t("Review item", "검토 항목")
                          : rule.effect === "reminder"
                            ? t("Reminder", "방문 전 확인")
                            : t("Fixed", "변경 불가")}
                    </span>
                    <p>
                      {rule.question?.[locale] ??
                        localizedRuleReason(rule.reason, locale)}
                    </p>
                  </div>
                ))}
            </div>
          </>
        )}
        <div className="condition-suggestions">
          <h4>{t("Suggested conditions", "조건 제안")}</h4>
          <div className="button-row">
            {suggestions
              .filter((suggestion) =>
                conditions.every((condition) => condition.id !== suggestion.id),
              )
              .map((suggestion) => (
                <button
                  className="button--secondary"
                  type="button"
                  key={suggestion.id}
                  onClick={() => addSuggestion(suggestion)}
                >
                  {t(suggestion.label.en, suggestion.label.ko)}{" "}
                  {t("Add condition", "조건 추가")}
                </button>
              ))}
          </div>
        </div>
        <div className="condition-list">
          {conditions.map((condition) => {
            const label = t(condition.label.en, condition.label.ko);
            const questionError = errors[`conditions.${condition.id}.question`];
            const expectedError = errors[`conditions.${condition.id}.expected`];
            return (
              <div className="condition-card" key={condition.id}>
                <div className="condition-card__heading">
                  <h4>{label}</h4>
                  <button
                    className="button--secondary"
                    type="button"
                    onClick={() =>
                      setConditions((current) =>
                        current.filter((entry) => entry.id !== condition.id),
                      )
                    }
                  >
                    {t("Remove", "삭제")}
                  </button>
                </div>
                <div className="field">
                  <label htmlFor={`${condition.id}-question`}>
                    {t("Question", "질문")} · {label}
                  </label>
                  <input
                    id={`${condition.id}-question`}
                    value={condition.question}
                    maxLength={200}
                    placeholder={condition.example?.[locale]}
                    aria-invalid={questionError ? true : undefined}
                    onChange={(event) =>
                      updateCondition(condition.id, {
                        question: event.target.value,
                      })
                    }
                  />
                  {questionError && (
                    <p role="alert">
                      {localizeValidationMessage(questionError)}
                    </p>
                  )}
                </div>
                <div className="condition-card__controls">
                  <div className="field">
                    <label htmlFor={`${condition.id}-expected`}>
                      {t("Expected answer", "기대 답변")} · {label}
                    </label>
                    <select
                      id={`${condition.id}-expected`}
                      value={condition.expected}
                      aria-invalid={expectedError ? true : undefined}
                      onChange={(event) =>
                        updateCondition(condition.id, {
                          expected: event.target
                            .value as DraftCondition["expected"],
                        })
                      }
                    >
                      <option value="">{t("Select", "선택해 주세요")}</option>
                      <option value="yes">{t("Yes", "예")}</option>
                      <option value="no">{t("No", "아니요")}</option>
                    </select>
                    {expectedError && (
                      <p role="alert">
                        {localizeValidationMessage(expectedError)}
                      </p>
                    )}
                  </div>
                  <div className="field">
                    <label htmlFor={`${condition.id}-effect`}>
                      {t("Condition type", "조건 유형")} · {label}
                    </label>
                    <select
                      id={`${condition.id}-effect`}
                      value={
                        condition.effect === "hard_fail"
                          ? "required"
                          : "preferred"
                      }
                      onChange={(event) =>
                        updateCondition(condition.id, {
                          effect:
                            event.target.value === "preferred"
                              ? "needs_review"
                              : "hard_fail",
                        })
                      }
                    >
                      <option value="required">{t("Required", "필수")}</option>
                      <option value="preferred">
                        {t("Preferred", "우대")}
                      </option>
                    </select>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        <button
          className="button--secondary"
          type="button"
          onClick={addCustomCondition}
        >
          {t("Add custom condition", "직접 조건 추가")}
        </button>
        {errors.conditions && (
          <p role="alert">{localizeValidationMessage(errors.conditions)}</p>
        )}
      </section>
      <button type="submit">{t("Preview opportunity", "공고 미리보기")}</button>
    </form>
  );
}
