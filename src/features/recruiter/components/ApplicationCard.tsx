import { useCallback, useState } from "react";
import { useParams } from "react-router-dom";
import {
  createPhotoViewUrl,
  type RecruiterApplication,
} from "../../applications/api/application-photos";
import { AttendanceSummary } from "../../attendance/components/AttendanceSummary";
import { AttendanceManager } from "../../attendance/components/AttendanceManager";
import {
  selectApplication,
  unselectApplication,
} from "../../applications/api/attendance";
import { useI18n } from "../../../i18n/locale";
import { localizedRuleReason } from "../../eligibility/presentation/ko";
import type { RuleDefinition } from "../../eligibility/domain/types";

interface ApplicationCardProps {
  application: RecruiterApplication;
  selectionAllowed?: boolean;
  rules?: readonly RuleDefinition[];
}

export function ApplicationCard({
  application,
  selectionAllowed = true,
  rules = [],
}: ApplicationCardProps) {
  const { locale, t } = useI18n();
  const { opportunityId } = useParams<{ opportunityId: string }>();
  const [photoUrls, setPhotoUrls] = useState<Record<string, string>>({});
  const [photoErrors, setPhotoErrors] = useState<Record<string, boolean>>({});
  const [pendingPhotoId, setPendingPhotoId] = useState<string>();
  const [selected, setSelected] = useState<boolean>();
  const [canUnselect, setCanUnselect] = useState(false);
  const [selectionPending, setSelectionPending] = useState(false);
  const [selectionError, setSelectionError] = useState<
    "select" | "unselect" | null
  >(null);
  const handleSelectionStatus = useCallback(
    (value: boolean, allowed: boolean) => {
      setSelected(value);
      setCanUnselect(allowed);
    },
    [],
  );

  async function requestPhoto(photoId: string) {
    setPendingPhotoId(photoId);
    setPhotoErrors((current) => ({ ...current, [photoId]: false }));
    try {
      const viewUrl = await createPhotoViewUrl(application.id, photoId);
      setPhotoUrls((current) => ({ ...current, [photoId]: viewUrl }));
    } catch {
      setPhotoErrors((current) => ({ ...current, [photoId]: true }));
    } finally {
      setPendingPhotoId(undefined);
    }
  }

  async function select() {
    if (opportunityId === undefined || selectionPending || !selectionAllowed)
      return;
    setSelectionPending(true);
    setSelectionError(null);
    try {
      await selectApplication({ applicationId: application.id, opportunityId });
      setSelected(true);
      setCanUnselect(false);
    } catch {
      setSelectionError("select");
    } finally {
      setSelectionPending(false);
    }
  }

  async function unselect() {
    if (opportunityId === undefined || selectionPending || !selectionAllowed)
      return;
    setSelectionPending(true);
    setSelectionError(null);
    try {
      await unselectApplication({
        applicationId: application.id,
        opportunityId,
      });
      setSelected(false);
      setCanUnselect(false);
    } catch {
      setSelectionError("unselect");
    } finally {
      setSelectionPending(false);
    }
  }

  const outcomes = [
    ...application.evaluation.failures,
    ...application.evaluation.reviews,
    ...application.evaluation.reminders,
  ];
  const questionByField = new Map(
    rules
      .filter((rule) => rule.question)
      .map((rule) => [rule.field, rule.question]),
  );

  return (
    <article className="surface application-card">
      <header className="application-card__header">
        <div>
          <h2>{application.applicantDisplayName}</h2>
          <p>{application.applicantPhone}</p>
        </div>
        <p className="helper-text">
          {t("Submitted", "지원 일시")}{" "}
          <time dateTime={application.createdAt}>
            {new Date(application.createdAt).toLocaleString(
              locale === "ko" ? "ko-KR" : "en-US",
            )}
          </time>
        </p>
      </header>
      <section
        className="detail-section"
        aria-label={t("Deterministic evaluation", "지원 조건 확인 결과")}
      >
        <h3>{t("Deterministic evaluation", "지원 조건 확인 결과")}</h3>
        <p>
          {application.evaluation.eligible
            ? t("Eligible", "지원 가능")
            : t("Not eligible", "지원 불가")}
        </p>
        <p>
          {t("Ruleset", "규칙 버전")}: {application.evaluation.rulesetId} v
          {application.evaluation.rulesetVersion}
        </p>
        {outcomes.length > 0 ? (
          <ul>
            {outcomes.map((outcome) => (
              <li key={`${outcome.effect}-${outcome.ruleId}`}>
                {outcome.ruleId} · {t("Input", "입력")}:{" "}
                {displayValue(outcome.input, t)} · {t("Effect", "판정")}:{" "}
                {effectLabel(outcome.effect, t)} · {t("Reason", "이유")}:{" "}
                {localizedRuleReason(outcome.reason, locale)}
              </li>
            ))}
          </ul>
        ) : null}
      </section>
      <section
        className="detail-section"
        aria-label={t("Application answers", "지원자 답변")}
      >
        <h3>{t("Answers", "지원자 답변")}</h3>
        <ul>
          {application.answers.map((answer) => (
            <li key={answer.field}>
              {questionByField.get(answer.field)?.[locale] ??
                answerFieldLabel(answer.field, t)}
              : {displayValue(answer.value, t)}
            </li>
          ))}
        </ul>
      </section>
      <section
        className="detail-section"
        aria-label={t("Private photos", "비공개 사진")}
      >
        <h3>{t("Private photos", "비공개 사진")}</h3>
        {application.photos.length === 0 ? (
          <p>{t("No photo uploaded.", "올린 사진이 없습니다.")}</p>
        ) : null}
        {application.photos.map((photo, index) => {
          const ordinal = index + 1;
          const error = photoErrors[photo.id];
          const viewUrl = photoUrls[photo.id];
          return (
            <div key={photo.id}>
              <p>
                {t("Photo", "사진")} {ordinal}: {photo.contentType},{" "}
                {photo.byteSize}
                {t(" bytes", "바이트")}
              </p>
              <button
                className="button--secondary"
                type="button"
                disabled={pendingPhotoId === photo.id}
                onClick={() => void requestPhoto(photo.id)}
              >
                {pendingPhotoId === photo.id
                  ? t(
                      `Opening private photo ${ordinal}…`,
                      `비공개 사진 ${ordinal}을 열고 있습니다…`,
                    )
                  : t(
                      `View private photo ${ordinal}`,
                      `비공개 사진 ${ordinal} 보기`,
                    )}
              </button>
              {viewUrl !== undefined ? (
                <a
                  className="action-link"
                  href={viewUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  {t(
                    `Open private photo ${ordinal}`,
                    `비공개 사진 ${ordinal} 열기`,
                  )}
                </a>
              ) : null}
              {error ? (
                <p role="alert">
                  {t(
                    "Could not open this private photo. Try again.",
                    "비공개 사진을 열지 못했습니다. 다시 시도해 주세요.",
                  )}
                </p>
              ) : null}
            </div>
          );
        })}
      </section>
      {opportunityId === undefined ? (
        <AttendanceSummary
          events={application.attendance}
          viewerParty="recruiter"
        />
      ) : (
        <>
          {selectionAllowed && selected === false ? (
            <div className="detail-section">
              <button
                type="button"
                disabled={selectionPending}
                onClick={() => void select()}
              >
                {selectionPending
                  ? t("Selecting application…", "지원자를 선택하고 있습니다…")
                  : t("Select application", "지원자 선택")}
              </button>
            </div>
          ) : null}
          {selectionAllowed && selected === true && canUnselect ? (
            <div className="detail-section">
              <button
                className="button--secondary"
                type="button"
                disabled={selectionPending}
                onClick={() => void unselect()}
              >
                {selectionPending
                  ? t("Undoing selection…", "선택을 취소하고 있습니다…")
                  : t("Undo selection", "선택 취소")}
              </button>
            </div>
          ) : null}
          {selectionError ? (
            <p role="alert">
              {selectionError === "select"
                ? t(
                    "Could not select this application. Try again.",
                    "지원자를 선택하지 못했습니다. 다시 시도해 주세요.",
                  )
                : t(
                    "Could not undo selection. Attendance may already be recorded.",
                    "선택을 취소하지 못했습니다. 참여 기록이 이미 있을 수 있습니다.",
                  )}
            </p>
          ) : null}
          <AttendanceManager
            key={selected === true ? "selected" : "pending"}
            capability={{ applicationId: application.id, opportunityId }}
            viewerParty="recruiter"
            initialEvents={application.attendance}
            onSelectionStatus={handleSelectionStatus}
          />
        </>
      )}
    </article>
  );
}

const answerFieldLabels: Record<string, readonly [string, string]> = {
  isAdult: ["At least 19", "만 19세 이상"],
  isAvailable: ["Available at the scheduled time", "모집 일정 참여"],
  meetsCurrentLengthRequirement: [
    "Hair length meets requirement",
    "머리 길이 조건 충족",
  ],
  meetsCurrentStyleRequirement: [
    "Hairstyle meets requirement",
    "머리 모양 조건 충족",
  ],
  meetsRecentDyeRequirement: [
    "Dye history meets requirement",
    "염색 이력 조건 충족",
  ],
  meetsRecentBleachRequirement: [
    "Bleach history meets requirement",
    "탈색 이력 조건 충족",
  ],
  meetsRecentPermRequirement: [
    "Perm history meets requirement",
    "펌 이력 조건 충족",
  ],
  acceptsTargetStyle: ["Accepts target style", "요청 스타일 수락"],
  meetsRecruiterConstraints: ["Meets other requirements", "기타 조건 충족"],
  matchesRequiredSex: ["Meets sex requirement", "성별 조건 충족"],
  hasPermanentOrSemiPermanentEyebrow: ["Eyebrow procedure", "눈썹 반영구 시술"],
  hasPermanentOrSemiPermanentEyeliner: [
    "Eyeliner procedure",
    "아이라인 반영구 시술",
  ],
  hasPermanentOrSemiPermanentLipProcedure: [
    "Lip procedure",
    "입술 반영구 시술",
  ],
  hasEyelashExtensions: ["Eyelash extensions", "속눈썹 연장"],
  hasPersistentVisibleMarks: ["Visible identifying marks", "보이는 식별 표식"],
  hasVisibleTattooOrHenna: ["Visible tattoos or henna", "보이는 타투·헤나"],
  hasVisibleNailArt: ["Visible nail art", "보이는 네일아트"],
  wearsDayOfMakeup: ["Makeup on exam day", "시험 당일 메이크업"],
  wearsLenses: ["Lenses on exam day", "시험 당일 렌즈"],
  wearsAccessories: ["Accessories on exam day", "시험 당일 액세서리"],
  hasIdentityDocument: ["Can bring identity document", "신분증 지참 가능"],
};

function answerFieldLabel(
  field: string,
  t: (en: string, ko: string) => string,
): string {
  const label = answerFieldLabels[field];
  return label === undefined ? field : t(...label);
}

function displayValue(value: unknown, t: (en: string, ko: string) => string) {
  if (value === true) return t("Yes", "예");
  if (value === false) return t("No", "아니요");
  if (value === null) return t("None", "없음");
  return String(value);
}

function effectLabel(
  effect: "hard_fail" | "needs_review" | "reminder",
  t: (en: string, ko: string) => string,
) {
  switch (effect) {
    case "hard_fail":
      return t("Hard fail", "지원 불가");
    case "needs_review":
      return t("Needs review", "검토 필요");
    case "reminder":
      return t("Reminder", "안내");
  }
}
