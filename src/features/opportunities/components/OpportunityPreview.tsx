import { useState } from "react";
import { makeupCertificationV1Metadata } from "../../eligibility/templates/makeup-certification-v1";
import { koreanRuleReason } from "../../eligibility/presentation/ko";
import { useI18n } from "../../../i18n/locale";
import type { AppLocale } from "../../../i18n/brand";
import type { OpportunityPublicationResult } from "../api/publish-opportunity";
import type { OpportunityDraft } from "../domain/opportunity";

interface OpportunityPreviewProps {
  draft: OpportunityDraft;
  applicableExamYear?: number;
  onPublish?: (
    draft: OpportunityDraft,
    confirmedHardRuleIds: string[],
  ) => Promise<OpportunityPublicationResult>;
}

function ruleReasons(
  draft: OpportunityDraft,
  effect: "hard_fail" | "needs_review" | "reminder",
  locale: AppLocale,
) {
  return draft.rules
    .filter((rule) => rule.effect === effect)
    .map((rule) =>
      locale === "ko" ? koreanRuleReason(rule.reason) : rule.reason,
    );
}

function formatBenefit(draft: OpportunityDraft, locale: AppLocale) {
  if (draft.benefit.type === "cash") {
    return locale === "ko"
      ? `${draft.benefit.amount.toLocaleString("ko-KR")}원: ${draft.benefit.description}`
      : `KRW ${draft.benefit.amount.toLocaleString("en-US")}: ${draft.benefit.description}`;
  }

  return draft.benefit.description;
}

function formatDateTime(value: string, locale: AppLocale): string {
  return new Date(value).toLocaleString(locale === "ko" ? "ko-KR" : "en-US");
}

function previewText(
  draft: OpportunityDraft,
  applicableExamYear: number | undefined,
  locale: AppLocale,
) {
  const isKorean = locale === "ko";
  return [
    draft.title,
    `${isKorean ? "시작" : "Starts"}: ${formatDateTime(draft.startsAt, locale)}`,
    `${isKorean ? "마감" : "Closes"}: ${formatDateTime(draft.closesAt, locale)}`,
    `${isKorean ? "장소" : "Location"}: ${draft.venueDistrict}`,
    isKorean
      ? `소요 시간: ${draft.expectedMinutes}분`
      : `Duration: ${draft.expectedMinutes} minutes`,
    `${isKorean ? "혜택" : "Benefit"}: ${formatBenefit(draft, locale)}`,
    ...(draft.category === "makeup_certification" && applicableExamYear
      ? [
          isKorean
            ? `적용 시험 연도: ${applicableExamYear}년`
            : `Applicable exam year: ${applicableExamYear}`,
        ]
      : []),
    `${isKorean ? "필수 조건" : "Hard rules"}: ${ruleReasons(draft, "hard_fail", locale).join("; ")}`,
    `${isKorean ? "검토 항목" : "Review items"}: ${ruleReasons(draft, "needs_review", locale).join("; ")}`,
    `${isKorean ? "방문 전 확인" : "Reminders"}: ${ruleReasons(draft, "reminder", locale).join("; ")}`,
  ].join("\n");
}

export function OpportunityPreview({
  draft,
  applicableExamYear,
  onPublish,
}: OpportunityPreviewProps) {
  const { locale, t } = useI18n();
  const [confirmedDraft, setConfirmedDraft] = useState<OpportunityDraft>();
  const [copiedDraft, setCopiedDraft] = useState<OpportunityDraft>();
  const [copyErrorDraft, setCopyErrorDraft] = useState<OpportunityDraft>();
  const [hardRuleConfirmation, setHardRuleConfirmation] = useState<{
    draft: OpportunityDraft;
    ruleIds: string[];
  }>();
  const [publication, setPublication] = useState<{
    draft: OpportunityDraft;
    result: OpportunityPublicationResult;
  }>();
  const [publishErrorDraft, setPublishErrorDraft] =
    useState<OpportunityDraft>();
  const [publishingDraft, setPublishingDraft] = useState<OpportunityDraft>();
  const examYear =
    applicableExamYear ?? makeupCertificationV1Metadata.applicableExamYear;
  const confirmed = confirmedDraft === draft;
  const hardRules = draft.rules.filter((rule) => rule.effect === "hard_fail");
  const confirmedHardRuleIds =
    hardRuleConfirmation?.draft === draft ? hardRuleConfirmation.ruleIds : [];
  const allHardRulesConfirmed = hardRules.every((rule) =>
    confirmedHardRuleIds.includes(rule.id),
  );

  async function copyOpportunity() {
    try {
      const clipboard = navigator.clipboard;
      if (!clipboard) throw new Error("Clipboard access is unavailable.");

      await clipboard.writeText(previewText(draft, examYear, locale));
      setCopiedDraft(draft);
      setCopyErrorDraft(undefined);
    } catch {
      setCopyErrorDraft(draft);
    }
  }

  function setHardRuleConfirmed(ruleId: string, checked: boolean) {
    const currentIds =
      hardRuleConfirmation?.draft === draft ? hardRuleConfirmation.ruleIds : [];
    setHardRuleConfirmation({
      draft,
      ruleIds: checked
        ? [...currentIds, ruleId]
        : currentIds.filter((id) => id !== ruleId),
    });
  }

  async function publish() {
    if (onPublish === undefined || !allHardRulesConfirmed) return;
    setPublishingDraft(draft);
    setPublishErrorDraft(undefined);
    try {
      const result = await onPublish(draft, confirmedHardRuleIds);
      setPublication({ draft, result });
    } catch {
      setPublishErrorDraft(draft);
    } finally {
      setPublishingDraft(undefined);
    }
  }

  return (
    <section className="surface" aria-labelledby="opportunity-preview-heading">
      <h2 id="opportunity-preview-heading">
        {t("Opportunity preview", "공고 미리보기")}
      </h2>
      <dl className="summary-grid">
        <div>
          <dt>{t("Procedure", "시술 또는 시험 내용")}</dt>
          <dd>{draft.title}</dd>
        </div>
        <div>
          <dt>{t("Starts at", "시작 일시")}</dt>
          <dd>{formatDateTime(draft.startsAt, locale)}</dd>
        </div>
        <div>
          <dt>{t("Closes at", "지원 마감 일시")}</dt>
          <dd>{formatDateTime(draft.closesAt, locale)}</dd>
        </div>
        <div>
          <dt>{t("Location", "장소")}</dt>
          <dd>{draft.venueDistrict}</dd>
        </div>
        <div>
          <dt>{t("Duration", "소요 시간")}</dt>
          <dd>
            {locale === "ko"
              ? `${draft.expectedMinutes}분`
              : `${draft.expectedMinutes} minutes`}
          </dd>
        </div>
        <div>
          <dt>{t("Benefit", "혜택")}</dt>
          <dd>{formatBenefit(draft, locale)}</dd>
        </div>
      </dl>
      {draft.category === "makeup_certification" && (
        <p>
          {locale === "ko"
            ? `적용 시험 연도: ${examYear}년`
            : `Applicable exam year: ${examYear}`}
        </p>
      )}
      <div className="rule-grid">
        <RuleList
          heading={t("Hard rules", "필수 조건")}
          reasons={ruleReasons(draft, "hard_fail", locale)}
          emptyMessage={t("None.", "해당 항목이 없습니다.")}
        />
        <RuleList
          heading={t("Review items", "검토 항목")}
          reasons={ruleReasons(draft, "needs_review", locale)}
          emptyMessage={t("None.", "해당 항목이 없습니다.")}
        />
        <RuleList
          heading={t("Reminders", "방문 전 확인")}
          reasons={ruleReasons(draft, "reminder", locale)}
          emptyMessage={t("None.", "해당 항목이 없습니다.")}
        />
      </div>
      <label className="choice">
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(event) =>
            setConfirmedDraft(event.target.checked ? draft : undefined)
          }
        />
        {t(
          "I confirm this preview matches the intended opportunity.",
          "공고 내용이 모집 조건과 일치하는지 확인했습니다.",
        )}
      </label>
      <button
        className="button--secondary"
        type="button"
        disabled={!confirmed}
        onClick={copyOpportunity}
      >
        {t("Copy opportunity", "공고 내용 복사")}
      </button>
      {copiedDraft === draft && (
        <p className="status--success" role="status">
          {t("Copied.", "공고 내용을 복사했습니다.")}
        </p>
      )}
      {copyErrorDraft === draft && (
        <p role="alert">
          {t(
            "Could not copy the opportunity. Try again.",
            "공고 내용을 복사하지 못했습니다. 다시 시도해 주세요.",
          )}
        </p>
      )}
      {onPublish && (
        <section
          className="detail-section form-stack"
          aria-labelledby="hard-rule-confirmation-heading"
        >
          <h3 id="hard-rule-confirmation-heading">
            {t("Confirm every hard rule", "필수 조건 확인")}
          </h3>
          {hardRules.map((rule) => (
            <label className="choice" key={rule.id}>
              <input
                type="checkbox"
                checked={confirmedHardRuleIds.includes(rule.id)}
                onChange={(event) =>
                  setHardRuleConfirmed(rule.id, event.target.checked)
                }
              />
              {t("Confirm hard rule", "필수 조건 확인")}:{" "}
              {locale === "ko" ? koreanRuleReason(rule.reason) : rule.reason}
            </label>
          ))}
          <button
            type="button"
            disabled={!allHardRulesConfirmed || publishingDraft === draft}
            onClick={() => void publish()}
          >
            {publishingDraft === draft
              ? t("Publishing…", "공고를 게시하고 있습니다…")
              : t("Publish opportunity", "공고 게시")}
          </button>
          {publishErrorDraft === draft && (
            <p role="alert">
              {t(
                "Could not publish the opportunity. Try again.",
                "공고를 게시하지 못했습니다. 다시 시도해 주세요.",
              )}
            </p>
          )}
          {publication?.draft === draft && (
            <div className="link-row">
              <p className="status--success" role="status">
                {t("Opportunity published.", "공고를 게시했습니다.")}
              </p>
              <a
                className="action-link"
                href={publication.result.applicantPath}
              >
                {t("Applicant link", "모델 지원 링크")}
              </a>
              <a
                className="action-link"
                href={publication.result.recruiterReviewPath}
              >
                {t("Recruiter review link", "지원 내역 확인 링크")}
              </a>
            </div>
          )}
        </section>
      )}
    </section>
  );
}

function RuleList({
  heading,
  reasons,
  emptyMessage,
}: {
  heading: string;
  reasons: string[];
  emptyMessage: string;
}) {
  return (
    <section className="rule-card" aria-label={heading}>
      <h3>{heading}</h3>
      {reasons.length > 0 ? (
        <ul>
          {reasons.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      ) : (
        <p>{emptyMessage}</p>
      )}
    </section>
  );
}
