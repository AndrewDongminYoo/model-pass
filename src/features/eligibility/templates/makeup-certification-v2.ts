import type { RuleDefinition } from "../domain/types.ts";

export const makeupCertificationV2Metadata = {
  id: "makeup-certification",
  version: 2,
  applicableExamYear: 2026,
  officialSourceUrl:
    "https://www.q-net.or.kr/cst006.do?artlSeq=5250969&brdId=Q006&gSite=Q&id=cst00602",
  sourceAccessedAt: "2026-09-24",
} as const;

export function isWithinMakeupExamAgeLimit(birthDate: string): boolean | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(birthDate);
  if (match === null) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  )
    return null;
  return makeupCertificationV2Metadata.applicableExamYear - year <= 55;
}

export function isWithinMakeupExamYear(startsAt: string): boolean {
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(startsAt)) {
    return (
      Number(startsAt.slice(0, 4)) ===
      makeupCertificationV2Metadata.applicableExamYear
    );
  }
  const value = new Date(startsAt);
  return (
    !Number.isNaN(value.getTime()) &&
    Number(
      new Intl.DateTimeFormat("en-US", {
        timeZone: "Asia/Seoul",
        year: "numeric",
      }).format(value),
    ) === makeupCertificationV2Metadata.applicableExamYear
  );
}

export function makeupCertificationV2Locked(
  requiredModelSex: "female" | "male",
): RuleDefinition[] {
  const sex =
    requiredModelSex === "female"
      ? { en: "female", ko: "여성" }
      : { en: "male", ko: "남성" };

  return [
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
    {
      id: "makeup-exam-age-limit",
      field: "isWithinMakeupAgeLimit",
      operator: "equals",
      expected: true,
      effect: "hard_fail",
      reason:
        "The 2026 makeup exam requires models to be no older than 55 by birth year.",
      question: {
        en: "Are you 55 or younger under the 2026 exam's birth-year rule?",
        ko: "2026년 시험의 출생연도 기준으로 55세 이하인가요?",
      },
    },
    {
      id: "matches-required-sex",
      field: "matchesRequiredSex",
      operator: "equals",
      expected: true,
      effect: "hard_fail",
      reason: `This recruiter requested a ${sex.en} model for this opportunity.`,
      question: {
        en: `This opportunity requests a ${sex.en} model. Does that apply to you?`,
        ko: `이 공고는 ${sex.ko} 모델을 모집합니다. 해당하시나요?`,
      },
    },
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
    {
      id: "permanent-or-semi-permanent-eyebrow",
      field: "hasPermanentOrSemiPermanentEyebrow",
      operator: "equals",
      expected: false,
      effect: "needs_review",
      reason:
        "Eyebrow tattoo or semi-permanent makeup can cause an exam score deduction.",
      question: {
        en: "Do you currently have eyebrow tattoo or semi-permanent makeup?",
        ko: "현재 눈썹 문신이나 반영구 화장이 있나요?",
      },
    },
    {
      id: "permanent-or-semi-permanent-eyeliner",
      field: "hasPermanentOrSemiPermanentEyeliner",
      operator: "equals",
      expected: false,
      effect: "needs_review",
      reason:
        "Permanent or semi-permanent eyeliner can cause an exam score deduction.",
      question: {
        en: "Do you currently have permanent or semi-permanent eyeliner?",
        ko: "현재 아이라인 문신이나 반영구 화장이 있나요?",
      },
    },
    {
      id: "permanent-or-semi-permanent-lips",
      field: "hasPermanentOrSemiPermanentLipProcedure",
      operator: "equals",
      expected: false,
      effect: "needs_review",
      reason:
        "Permanent or semi-permanent lip makeup can cause an exam score deduction.",
      question: {
        en: "Do you currently have permanent or semi-permanent lip makeup?",
        ko: "현재 입술 문신이나 반영구 화장이 있나요?",
      },
    },
    {
      id: "eyelash-extensions",
      field: "hasEyelashExtensions",
      operator: "equals",
      expected: false,
      effect: "needs_review",
      reason: "Eyelash extensions can cause an exam score deduction.",
      question: {
        en: "Do you currently have eyelash extensions?",
        ko: "현재 속눈썹 연장을 하고 있나요?",
      },
    },
    {
      id: "eyebrow-dye-or-tint",
      field: "hasEyebrowDyeOrTint",
      operator: "equals",
      expected: false,
      effect: "needs_review",
      reason: "Eyebrow dye or tint can cause an exam score deduction.",
      question: {
        en: "Do you currently have dyed or tinted eyebrows?",
        ko: "현재 눈썹 염색이나 틴트를 한 상태인가요?",
      },
    },
    {
      id: "remove-day-of-makeup",
      field: "wearsDayOfMakeup",
      operator: "equals",
      expected: false,
      effect: "reminder",
      reason: "Arrive without makeup on exam day.",
      question: {
        en: "Will you arrive wearing makeup on exam day?",
        ko: "시험 당일 메이크업을 한 채 방문할 예정인가요?",
      },
    },
    {
      id: "remove-lenses",
      field: "wearsLenses",
      operator: "equals",
      expected: false,
      effect: "reminder",
      reason: "Remove colored or circle lenses before the exam.",
      question: {
        en: "Will you wear colored or circle lenses on exam day?",
        ko: "시험 당일 컬러렌즈나 서클렌즈를 착용할 예정인가요?",
      },
    },
    {
      id: "remove-accessories",
      field: "wearsAccessories",
      operator: "equals",
      expected: false,
      effect: "reminder",
      reason: "Remove identifying accessories before the exam.",
      question: {
        en: "Will you wear visible accessories on exam day?",
        ko: "시험 당일 눈에 띄는 액세서리를 착용할 예정인가요?",
      },
    },
    {
      id: "remove-visible-nail-art",
      field: "hasVisibleNailArt",
      operator: "equals",
      expected: false,
      effect: "reminder",
      reason: "Remove visible nail markings before the exam.",
      question: {
        en: "Will you have visible nail art on exam day?",
        ko: "시험 당일 보이는 네일아트가 남아 있을 예정인가요?",
      },
    },
    {
      id: "bring-identity-document",
      field: "hasIdentityDocument",
      operator: "equals",
      expected: true,
      effect: "reminder",
      reason: "Bring an accepted identity document to the exam.",
      question: {
        en: "Can you bring an accepted identity document on exam day?",
        ko: "시험 당일 인정되는 신분증을 가져올 수 있나요?",
      },
    },
  ];
}

export const makeupCertificationV2Suggestions = [
  {
    id: "target-look",
    field: "acceptsTargetLook",
    label: { en: "Target makeup", ko: "시험 메이크업" },
    example: {
      en: "Can you receive the makeup described in this opportunity?",
      ko: "공고에 적힌 메이크업을 받는 데 동의하나요?",
    },
  },
  {
    id: "full-session",
    field: "canStayForFullSession",
    label: { en: "Full session", ko: "전체 일정" },
    example: {
      en: "Can you stay for the full three-hour session described above?",
      ko: "공고에 적힌 3시간 전체 일정에 참여할 수 있나요?",
    },
  },
] as const;
