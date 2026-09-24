import type { RuleDefinition } from "../domain/types.ts";

export const hairPromotionV2Metadata = {
  id: "hair-promotion",
  version: 2,
} as const;

export const hairPromotionV2Locked = [
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
    id: "hair-condition-photo-clear",
    field: "hairConditionPhotoIsClear",
    operator: "equals",
    expected: true,
    effect: "needs_review",
    reason: "A recruiter must review the hair-condition photo.",
  },
] satisfies readonly RuleDefinition[];

export const hairPromotionV2Suggestions = [
  {
    id: "current-length",
    field: "meetsCurrentLengthRequirement",
    label: { en: "Hair length", ko: "머리 길이" },
    example: {
      en: "Is your hair below your shoulders?",
      ko: "현재 머리가 어깨 아래까지 오나요?",
    },
  },
  {
    id: "current-style",
    field: "meetsCurrentStyleRequirement",
    label: { en: "Current style", ko: "현재 머리 모양" },
    example: {
      en: "Is your hair currently unpermed?",
      ko: "현재 펌을 하지 않은 머리인가요?",
    },
  },
  {
    id: "recent-dye",
    field: "meetsRecentDyeRequirement",
    label: { en: "Recent dye", ko: "최근 염색" },
    example: {
      en: "Have you avoided dyeing your hair in the last six months?",
      ko: "최근 6개월 동안 염색하지 않았나요?",
    },
  },
  {
    id: "recent-bleach",
    field: "meetsRecentBleachRequirement",
    label: { en: "Recent bleach", ko: "최근 탈색" },
    example: {
      en: "Have you avoided bleaching your hair in the last year?",
      ko: "최근 1년 동안 탈색하지 않았나요?",
    },
  },
  {
    id: "recent-perm",
    field: "meetsRecentPermRequirement",
    label: { en: "Recent perm", ko: "최근 펌" },
    example: {
      en: "Have you avoided a perm in the last six months?",
      ko: "최근 6개월 동안 펌을 하지 않았나요?",
    },
  },
  {
    id: "accepts-target-style",
    field: "acceptsTargetStyle",
    label: { en: "Target style", ko: "시술 스타일 동의" },
    example: {
      en: "Do you agree to receive the bob cut described above?",
      ko: "공고에 적힌 단발 커트를 받는 데 동의하나요?",
    },
  },
] as const;
