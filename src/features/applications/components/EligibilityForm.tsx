import type { FormEvent } from "react";
import { useState } from "react";
import { evaluateRules } from "../../eligibility/domain/evaluate-rules";
import { isAtLeast19 } from "../../eligibility/domain/age";
import { isWithinMakeupExamAgeLimit } from "../../eligibility/templates/makeup-certification-v2";
import type {
  AnswerValue,
  EvaluationContext,
  EvaluationResult,
  RuleDefinition,
} from "../../eligibility/domain/types";
import { useI18n } from "../../../i18n/locale";

interface EligibilityFormProps {
  rules: readonly RuleDefinition[];
  context: EvaluationContext;
  answers: Record<string, AnswerValue>;
  onAnswersChange: (answers: Record<string, AnswerValue>) => void;
  onEvaluate: (result: EvaluationResult) => void;
  birthDate?: string;
  onBirthDateChange?: (birthDate: string) => void;
}

interface Question {
  field: string;
  answerType: "boolean" | "number" | "text";
  label: { en: string; ko: string } | undefined;
}

export function EligibilityForm({
  rules,
  context,
  answers,
  onAnswersChange,
  onEvaluate,
  birthDate,
  onBirthDateChange,
}: EligibilityFormProps) {
  const { locale, t } = useI18n();
  const makeupAgeLimitRule = rules.find(
    (rule) => rule.field === "isWithinMakeupAgeLimit",
  );
  const hasMakeupAgeLimit = makeupAgeLimitRule !== undefined;
  const questions = questionsFor(rules, hasMakeupAgeLimit);
  const adultRule = hasMakeupAgeLimit
    ? rules.find((rule) => rule.field === "isAdult")
    : undefined;
  const [errors, setErrors] = useState<
    Record<string, "boolean" | "answer" | "date">
  >({});

  function setAnswer(field: string, value: AnswerValue) {
    setErrors((current) => {
      const next = { ...current };
      delete next[field];
      return next;
    });
    onAnswersChange({ ...answers, [field]: value });
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextErrors: Record<string, "boolean" | "answer" | "date"> =
      Object.fromEntries(
        questions
          .filter(({ field }) => answers[field] === undefined)
          .map(({ field, answerType }) => [
            field,
            answerType === "boolean" ? "boolean" : "answer",
          ]),
      ) as Record<string, "boolean" | "answer" | "date">;
    const isWithinAgeLimit = hasMakeupAgeLimit
      ? isWithinMakeupExamAgeLimit(birthDate ?? "")
      : undefined;
    if (isWithinAgeLimit === null) {
      nextErrors.birthDate = "date";
    }
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      return;
    }

    onEvaluate(
      evaluateRules(
        {
          ...answers,
          ...(isWithinAgeLimit !== undefined && isWithinAgeLimit !== null
            ? {
                isAdult: isAtLeast19(birthDate ?? "", new Date()),
                isWithinMakeupAgeLimit: isWithinAgeLimit,
              }
            : {}),
        },
        rules,
        context,
      ),
    );
  }

  return (
    <form className="surface form-stack" noValidate onSubmit={handleSubmit}>
      <h2>{t("Check eligibility", "지원 조건 확인")}</h2>
      {hasMakeupAgeLimit && (
        <div className="field">
          <p className="helper-text">
            {adultRule?.question?.[locale]}{" "}
            {makeupAgeLimitRule.question?.[locale]}{" "}
            {t(
              "We calculate this from your date of birth.",
              "생년월일로 자동 확인합니다.",
            )}
          </p>
          <label htmlFor="makeup-exam-birth-date">
            {t(
              "Date of birth (2026 exam age check)",
              "생년월일 (2026년 시험 연령 확인)",
            )}
          </label>
          <input
            id="makeup-exam-birth-date"
            type="date"
            value={birthDate ?? ""}
            aria-describedby={
              errors.birthDate ? "makeup-exam-birth-date-error" : undefined
            }
            aria-invalid={errors.birthDate ? true : undefined}
            onChange={(event) => {
              setErrors((current) => {
                const next = { ...current };
                delete next.birthDate;
                return next;
              });
              onBirthDateChange?.(event.currentTarget.value);
            }}
          />
          {errors.birthDate && (
            <p id="makeup-exam-birth-date-error">
              {t(
                "Enter a valid date of birth.",
                "올바른 생년월일을 입력해 주세요.",
              )}
            </p>
          )}
        </div>
      )}
      {questions.map((question) => {
        const errorId = `${question.field}-eligibility-error`;
        const error = errors[question.field];
        const errorMessage =
          error === "boolean"
            ? t("Select yes or no.", "예 또는 아니요를 선택해 주세요.")
            : error === "answer"
              ? t("Enter an answer.", "답변을 입력해 주세요.")
              : undefined;

        if (question.answerType === "boolean") {
          return (
            <fieldset
              className="choice-card"
              key={question.field}
              aria-describedby={error ? errorId : undefined}
              aria-invalid={error ? true : undefined}
            >
              <legend>
                {question.label?.[locale] ??
                  humanizeField(question.field, locale)}
              </legend>
              <div className="choice-options">
                <label className="choice">
                  <input
                    type="radio"
                    name={question.field}
                    value="yes"
                    checked={answers[question.field] === true}
                    onChange={() => setAnswer(question.field, true)}
                  />
                  {t("Yes", "예")}
                </label>
                <label className="choice">
                  <input
                    type="radio"
                    name={question.field}
                    value="no"
                    checked={answers[question.field] === false}
                    onChange={() => setAnswer(question.field, false)}
                  />
                  {t("No", "아니요")}
                </label>
              </div>
              {errorMessage ? <p id={errorId}>{errorMessage}</p> : null}
            </fieldset>
          );
        }

        const inputId = `${question.field}-answer`;
        return (
          <div className="field" key={question.field}>
            <label htmlFor={inputId}>
              {question.label?.[locale] ??
                humanizeField(question.field, locale)}
            </label>
            <input
              id={inputId}
              type={question.answerType === "number" ? "number" : "text"}
              value={String(answers[question.field] ?? "")}
              aria-describedby={error ? errorId : undefined}
              aria-invalid={error ? true : undefined}
              onChange={(event) =>
                setAnswer(
                  question.field,
                  question.answerType === "number"
                    ? event.currentTarget.valueAsNumber
                    : event.currentTarget.value,
                )
              }
            />
            {errorMessage ? <p id={errorId}>{errorMessage}</p> : null}
          </div>
        );
      })}
      <button type="submit">{t("Check eligibility", "지원 조건 확인")}</button>
    </form>
  );
}

function questionsFor(
  rules: readonly RuleDefinition[],
  deriveAdultFromBirthDate: boolean,
): Question[] {
  const questions = new Map<string, Question>();
  for (const rule of rules) {
    if (
      rule.field.toLowerCase().includes("photo") ||
      rule.field === "isWithinMakeupAgeLimit" ||
      (deriveAdultFromBirthDate && rule.field === "isAdult") ||
      questions.has(rule.field)
    ) {
      continue;
    }

    const expected = Array.isArray(rule.expected)
      ? rule.expected[0]
      : rule.expected;
    questions.set(rule.field, {
      field: rule.field,
      label: rule.question,
      answerType:
        typeof expected === "boolean"
          ? "boolean"
          : typeof expected === "number"
            ? "number"
            : "text",
    });
  }
  return [...questions.values()];
}

function humanizeField(field: string, locale: "en" | "ko"): string {
  const labels: Record<string, { en: string; ko: string }> = {
    isAdult: {
      en: "Are you at least 19 years old?",
      ko: "만 19세 이상인가요?",
    },
    isAvailable: {
      en: "Can you attend the scheduled time?",
      ko: "모집 일정에 참여할 수 있나요?",
    },
    meetsCurrentLengthRequirement: {
      en: "Does your current hair length meet this opportunity's requirement?",
      ko: "현재 머리 길이가 공고 조건에 맞나요?",
    },
    meetsCurrentStyleRequirement: {
      en: "Does your current hairstyle meet this opportunity's requirement?",
      ko: "현재 머리 모양이 공고 조건에 맞나요?",
    },
    meetsRecentDyeRequirement: {
      en: "Does your recent dye history meet this opportunity's requirement?",
      ko: "최근 염색 이력이 공고 조건에 맞나요?",
    },
    meetsRecentBleachRequirement: {
      en: "Does your recent bleach history meet this opportunity's requirement?",
      ko: "최근 탈색 이력이 공고 조건에 맞나요?",
    },
    meetsRecentPermRequirement: {
      en: "Does your recent perm history meet this opportunity's requirement?",
      ko: "최근 펌 이력이 공고 조건에 맞나요?",
    },
    acceptsTargetStyle: {
      en: "Can you receive the style described in this opportunity?",
      ko: "공고에 적힌 스타일로 시술받을 수 있나요?",
    },
    meetsRecruiterConstraints: {
      en: "Do you meet this opportunity's other requirements?",
      ko: "공고의 다른 조건에도 맞나요?",
    },
    matchesRequiredSex: {
      en: "Do you meet the sex requirement in this opportunity?",
      ko: "공고에서 요청한 성별 조건에 맞나요?",
    },
    hasPermanentOrSemiPermanentEyebrow: {
      en: "Have you had permanent or semi-permanent eyebrow procedures?",
      ko: "눈썹 문신이나 반영구 시술을 받은 적이 있나요?",
    },
    hasPermanentOrSemiPermanentEyeliner: {
      en: "Have you had permanent or semi-permanent eyeliner procedures?",
      ko: "아이라인 문신이나 반영구 시술을 받은 적이 있나요?",
    },
    hasPermanentOrSemiPermanentLipProcedure: {
      en: "Have you had permanent or semi-permanent lip procedures?",
      ko: "입술 문신이나 반영구 시술을 받은 적이 있나요?",
    },
    hasEyelashExtensions: {
      en: "Do you currently have eyelash extensions?",
      ko: "속눈썹 연장을 한 상태인가요?",
    },
    hasPersistentVisibleMarks: {
      en: "Do you have identifying marks visible while wearing exam attire?",
      ko: "시험복을 입어도 보이는 식별 표식이 있나요?",
    },
    hasVisibleTattooOrHenna: {
      en: "Do you have tattoos or henna visible while wearing exam attire?",
      ko: "시험복을 입어도 보이는 타투나 헤나가 있나요?",
    },
    hasVisibleNailArt: {
      en: "Do you have nail art visible while wearing exam attire?",
      ko: "시험복을 입어도 보이는 네일아트가 있나요?",
    },
    wearsDayOfMakeup: {
      en: "Will you arrive wearing makeup on the exam day?",
      ko: "시험 당일 메이크업을 한 채 방문할 예정인가요?",
    },
    wearsLenses: {
      en: "Will you wear lenses on the exam day?",
      ko: "시험 당일 렌즈를 착용할 예정인가요?",
    },
    wearsAccessories: {
      en: "Will you wear accessories on the exam day?",
      ko: "시험 당일 액세서리를 착용할 예정인가요?",
    },
    hasIdentityDocument: {
      en: "Can you bring an identity document on the exam day?",
      ko: "시험 당일 신분증을 가져올 수 있나요?",
    },
  };
  if (labels[field] !== undefined) return labels[field][locale];
  const words = field
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replaceAll("_", " ");
  return words.charAt(0).toUpperCase() + words.slice(1).toLowerCase();
}
