import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import {
  getPublicOpportunity,
  type PublicOpportunity,
} from "../api/get-public-opportunity";
import { ApplicationForm } from "../components/ApplicationForm";
import { appNameFor } from "../../../i18n/brand";
import { useI18n } from "../../../i18n/locale";

export function ApplyPage() {
  const { locale, t } = useI18n();
  const { opportunityId } = useParams<{ opportunityId: string }>();
  const [loaded, setLoaded] = useState<{
    opportunityId: string;
    opportunity?: PublicOpportunity;
    error?: boolean;
  }>();

  useEffect(() => {
    let active = true;
    if (opportunityId === undefined) {
      return;
    }

    void getPublicOpportunity(opportunityId)
      .then((result) => {
        if (active) {
          setLoaded(
            result.id === opportunityId
              ? { opportunityId, opportunity: result }
              : {
                  opportunityId,
                  error: true,
                },
          );
        }
      })
      .catch(() => {
        if (active) {
          setLoaded({
            opportunityId,
            error: true,
          });
        }
      });

    return () => {
      active = false;
    };
  }, [opportunityId]);

  if (opportunityId === undefined) {
    return (
      <main className="app-shell app-shell--narrow auth-shell">
        <p role="alert">
          {t("This opportunity is unavailable.", "이 공고를 볼 수 없습니다.")}
        </p>
      </main>
    );
  }
  if (loaded?.opportunityId === opportunityId && loaded.error !== undefined) {
    return (
      <main className="app-shell app-shell--narrow auth-shell">
        <p role="alert">
          {t("This opportunity is unavailable.", "이 공고를 볼 수 없습니다.")}
        </p>
      </main>
    );
  }
  if (
    loaded?.opportunityId !== opportunityId ||
    loaded.opportunity === undefined
  ) {
    return (
      <main className="app-shell app-shell--narrow auth-shell">
        <p role="status">
          {t("Loading opportunity…", "공고를 불러오고 있습니다…")}
        </p>
      </main>
    );
  }
  const opportunity = loaded.opportunity;

  return (
    <main className="app-shell">
      <header className="page-header">
        <p className="eyebrow">
          {appNameFor(locale)} · {t("Model application", "모델 지원")}
        </p>
        <h1>{opportunity.title}</h1>
        <p className="lede">
          {t(
            "Review the schedule and eligibility requirements before entering personal information.",
            "개인정보를 입력하기 전에 일정과 지원 조건을 확인해 주세요.",
          )}
        </p>
      </header>
      <dl className="summary-grid">
        <div>
          <dt>{t("Schedule", "일정")}</dt>
          <dd>{formatDateTime(opportunity.startsAt, locale)}</dd>
        </div>
        <div>
          <dt>{t("Location", "장소")}</dt>
          <dd>{opportunity.venueDistrict}</dd>
        </div>
        <div>
          <dt>{t("Estimated duration", "예상 소요 시간")}</dt>
          <dd>
            {locale === "ko"
              ? `${opportunity.expectedMinutes}분`
              : `${opportunity.expectedMinutes} minutes`}
          </dd>
        </div>
        <div>
          <dt>{t("Benefit", "혜택")}</dt>
          <dd>{formatBenefit(opportunity, locale)}</dd>
        </div>
        <div>
          <dt>{t("Application deadline", "지원 마감")}</dt>
          <dd>{formatDateTime(opportunity.closesAt, locale)}</dd>
        </div>
      </dl>
      <ApplicationForm key={opportunity.id} opportunity={opportunity} />
    </main>
  );
}

function formatDateTime(value: string, locale: "en" | "ko"): string {
  return new Intl.DateTimeFormat(locale === "ko" ? "ko-KR" : "en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function formatBenefit(
  opportunity: PublicOpportunity,
  locale: "en" | "ko",
): string {
  if (opportunity.benefit.type === "cash") {
    const amount = new Intl.NumberFormat(locale === "ko" ? "ko-KR" : "en-US", {
      style: "currency",
      currency: "KRW",
      maximumFractionDigits: 0,
    }).format(opportunity.benefit.amount);
    return `${amount} · ${opportunity.benefit.description}`;
  }
  return opportunity.benefit.description;
}
