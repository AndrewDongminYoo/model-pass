const knownReasons: Record<string, string> = {
  "This pilot is available to adults only.":
    "만 19세 이상만 지원할 수 있습니다.",
  "The current hair length does not meet this opportunity's requirement.":
    "현재 머리 길이가 공고 조건에 맞지 않습니다.",
  "The current hairstyle does not meet this opportunity's requirement.":
    "현재 머리 모양이 공고 조건에 맞지 않습니다.",
  "Recent dye history does not meet this opportunity's requirement.":
    "최근 염색 이력이 공고 조건에 맞지 않습니다.",
  "Recent bleach history does not meet this opportunity's requirement.":
    "최근 탈색 이력이 공고 조건에 맞지 않습니다.",
  "Recent perm history does not meet this opportunity's requirement.":
    "최근 펌 이력이 공고 조건에 맞지 않습니다.",
  "This opportunity requires acceptance of the target style.":
    "공고에 적힌 스타일로 시술받을 수 있어야 합니다.",
  "This opportunity's recruiter constraints are not met.":
    "공고의 다른 필수 조건에 맞지 않습니다.",
  "A recruiter must review the hair-condition photo.":
    "모집자가 현재 모발 사진을 확인해야 합니다.",
  "This schedule is unavailable.": "모집 일정에 참여할 수 있어야 합니다.",
  "This opportunity requires the recruiter's specified sex.":
    "공고에서 요청한 성별 조건에 맞아야 합니다.",
  "Permanent or semi-permanent eyebrow procedures are incompatible with this exam.":
    "눈썹 문신이나 반영구 시술을 받은 경우 참여할 수 없습니다.",
  "Permanent or semi-permanent eyeliner procedures are incompatible with this exam.":
    "아이라인 문신이나 반영구 시술을 받은 경우 참여할 수 없습니다.",
  "Permanent or semi-permanent lip procedures are incompatible with this exam.":
    "입술 문신이나 반영구 시술을 받은 경우 참여할 수 없습니다.",
  "Eyelash extensions are incompatible with this exam.":
    "속눈썹 연장 상태에서는 참여할 수 없습니다.",
  "Persistent visible marks are incompatible with this exam.":
    "시험복을 입어도 보이는 식별 표식이 있으면 참여할 수 없습니다.",
  "Visible tattoos or henna are incompatible with this exam.":
    "시험복을 입어도 보이는 타투나 헤나가 있으면 참여할 수 없습니다.",
  "Visible nail art is incompatible with this exam.":
    "시험복을 입어도 보이는 네일아트가 있으면 참여할 수 없습니다.",
  "Remove makeup before the appointment.":
    "시험 당일에는 메이크업을 하지 말고 방문해 주세요.",
  "Remove lenses before the appointment.":
    "시험 당일에는 렌즈를 착용하지 말고 방문해 주세요.",
  "Remove accessories before the appointment.":
    "시험 당일에는 액세서리를 착용하지 말고 방문해 주세요.",
  "Bring an identity document to the appointment.":
    "시험 당일 신분증을 지참해 주세요.",
};

export function koreanRuleReason(reason: string): string {
  return knownReasons[reason] ?? reason;
}

export function localizedRuleReason(reason: string, locale: AppLocale): string {
  return locale === "ko" ? koreanRuleReason(reason) : reason;
}
import type { AppLocale } from "../../../i18n/brand";
