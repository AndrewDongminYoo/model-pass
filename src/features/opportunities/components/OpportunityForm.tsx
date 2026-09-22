import { useState, type FormEvent } from "react";
import { hairPromotionV1 } from "../../eligibility/templates/hair-promotion-v1";
import {
  makeupCertificationV1,
  makeupCertificationV1Metadata,
} from "../../eligibility/templates/makeup-certification-v1";
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
};

function rulesFor(category: OpportunityCategory) {
  const template =
    category === "hair_promotion" ? hairPromotionV1 : makeupCertificationV1;

  return template.map((rule) => ({ ...rule }));
}

export function OpportunityForm({ onSubmit }: OpportunityFormProps) {
  const { t } = useI18n();
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
  const [errors, setErrors] = useState<Record<string, string>>({});

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
      rulesetId: isMakeup ? makeupCertificationV1Metadata.id : "hair-promotion",
      rulesetVersion: isMakeup ? makeupCertificationV1Metadata.version : 1,
      rules: rulesFor(category),
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

    setErrors({});
    onSubmit(result.data);
  }

  return (
    <form className="surface form-stack" onSubmit={submit} noValidate>
      <h2>{t("Session details", "모집 일정과 혜택")}</h2>
      <div className="field">
        <label htmlFor="category">{t("Category", "모집 분야")}</label>
        <select
          id="category"
          value={category}
          onChange={(event) =>
            setCategory(event.target.value as OpportunityCategory)
          }
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
      <button type="submit">{t("Preview opportunity", "공고 미리보기")}</button>
    </form>
  );
}
