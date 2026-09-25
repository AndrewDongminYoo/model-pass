import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  listPublicOpportunities,
  type PublicOpportunitySummary,
} from "../features/opportunities/api/list-public-opportunities";
import { appNameFor } from "../i18n/brand";
import { useI18n } from "../i18n/locale";
import { applicantPathFromLink } from "./opportunity-link";

export function HomePage() {
  const { locale, t } = useI18n();
  const navigate = useNavigate();
  const isAit = import.meta.env.VITE_APP_SURFACE === "ait";
  const [opportunityLink, setOpportunityLink] = useState("");
  const [invalidLink, setInvalidLink] = useState(false);
  const [refreshIndex, setRefreshIndex] = useState(0);
  const [opportunities, setOpportunities] = useState<
    | { status: "loading" }
    | { status: "error" }
    | { status: "loaded"; items: PublicOpportunitySummary[] }
  >({ status: "loading" });

  useEffect(() => {
    let active = true;
    void listPublicOpportunities()
      .then((items) => {
        if (active) setOpportunities({ status: "loaded", items });
      })
      .catch(() => {
        if (active) setOpportunities({ status: "error" });
      });
    return () => {
      active = false;
    };
  }, [refreshIndex]);

  function openOpportunity(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const path = applicantPathFromLink(opportunityLink);
    if (path === null) {
      setInvalidLink(true);
      return;
    }
    setInvalidLink(false);
    navigate(path);
  }

  return (
    <main className="app-shell home-shell">
      <header className="page-header">
        <p className="eyebrow">
          {t("Hair and makeup exam models", "헤어·메이크업 시험 모델 모집")}
        </p>
        <h1 className="brand-name">{appNameFor(locale)}</h1>
        <p className="lede">
          {t(
            "Explore current model opportunities and check the exact requirements before applying.",
            "진행 중인 시험 모델 공고를 보고, 조건을 확인한 뒤 지원하세요.",
          )}
        </p>
      </header>
      <section
        className="opportunity-feed"
        aria-labelledby="available-opportunities-heading"
      >
        <div className="opportunity-feed__heading">
          <div>
            <p className="eyebrow">{t("Open now", "지금 참여 가능")}</p>
            <h2 id="available-opportunities-heading">
              {t("Available opportunities", "지금 지원 가능한 공고")}
            </h2>
          </div>
          <p>
            {t(
              "Each opportunity sets its own requirements and benefits.",
              "공고마다 지원 조건과 혜택이 다릅니다.",
            )}
          </p>
        </div>
        {opportunities.status === "loading" && (
          <p className="surface opportunity-feed__message" role="status">
            {t("Loading opportunities…", "공고를 불러오고 있습니다…")}
          </p>
        )}
        {opportunities.status === "error" && (
          <div className="surface opportunity-feed__message">
            <p role="alert">
              {t(
                "Could not load opportunities.",
                "공고 목록을 불러오지 못했습니다.",
              )}
            </p>
            <button
              type="button"
              onClick={() => {
                setOpportunities({ status: "loading" });
                setRefreshIndex((current) => current + 1);
              }}
            >
              {t("Try again", "다시 시도")}
            </button>
          </div>
        )}
        {opportunities.status === "loaded" &&
          (opportunities.items.length === 0 ? (
            <p className="surface opportunity-feed__message" role="status">
              {t(
                "There are no open opportunities right now.",
                "지금 열려 있는 공고가 없습니다.",
              )}
            </p>
          ) : (
            <ul className="opportunity-list">
              {opportunities.items.map((opportunity) => (
                <li className="opportunity-card" key={opportunity.id}>
                  <p className="opportunity-card__category">
                    {opportunity.category === "hair_promotion"
                      ? t("Hair promotion exam", "헤어 승급 시험")
                      : t("Makeup certification exam", "메이크업 자격 시험")}
                  </p>
                  <h3>{opportunity.title}</h3>
                  <p className="opportunity-card__details">
                    <span>{opportunity.venueDistrict}</span>
                    <span aria-hidden="true">·</span>
                    <time dateTime={opportunity.startsAt}>
                      {formatDateTime(opportunity.startsAt, locale)}
                    </time>
                  </p>
                  <p className="opportunity-card__benefit">
                    {formatBenefit(opportunity, locale)}
                  </p>
                  <Link
                    className="button-link"
                    to={`/opportunities/${opportunity.id}/apply`}
                  >
                    {t("Check requirements and apply", "지원 조건 확인하기")}
                  </Link>
                </li>
              ))}
            </ul>
          ))}
      </section>
      <div className="home-grid">
        <section
          className="surface home-card"
          aria-labelledby="applicant-heading"
        >
          <h2 id="applicant-heading">
            {isAit
              ? t("Have a shared link?", "공유받은 공고 링크가 있나요?")
              : t("Have an opportunity link?", "공고 링크를 받으셨나요?")}
          </h2>
          <p>
            {isAit
              ? t(
                  "Open a specific opportunity using the link your recruiter shared.",
                  "모집자가 공유한 링크로 해당 공고를 바로 확인할 수 있습니다.",
                )
              : t(
                  "A shared link also opens a specific opportunity directly.",
                  "공유받은 링크가 있다면 해당 공고를 바로 열 수 있습니다.",
                )}
          </p>
          {!isAit && (
            <p className="home-note">
              {t(
                "You can also choose from the opportunities above.",
                "위 공고에서도 지원 조건을 확인할 수 있습니다.",
              )}
            </p>
          )}
          {isAit && (
            <form className="form-stack" onSubmit={openOpportunity}>
              <div className="field">
                <label htmlFor="opportunity-link">
                  {t("Opportunity link", "공고 링크")}
                </label>
                <input
                  id="opportunity-link"
                  type="text"
                  value={opportunityLink}
                  placeholder={t(
                    "Paste a shared opportunity link",
                    "공유받은 공고 링크를 붙여넣어 주세요",
                  )}
                  aria-invalid={invalidLink}
                  onChange={(event) => {
                    setOpportunityLink(event.target.value);
                    setInvalidLink(false);
                  }}
                />
              </div>
              {invalidLink && (
                <p role="alert">
                  {t(
                    "Check the Model Pass opportunity link.",
                    "모델패스 공고 링크를 확인해 주세요.",
                  )}
                </p>
              )}
              <button type="submit">
                {t("View opportunity", "공고 확인하기")}
              </button>
            </form>
          )}
        </section>
        {!isAit && (
          <section
            className="surface home-card"
            aria-labelledby="recruiter-heading"
          >
            <h2 id="recruiter-heading">
              {t("Recruiting a model?", "모델을 모집하고 있나요?")}
            </h2>
            <p>
              {t(
                "Create an opportunity with the exam requirements and review applications in one place.",
                "시험에 필요한 조건을 정리한 공고를 만들고, 지원 내용을 한곳에서 확인하세요.",
              )}
            </p>
            <Link className="button-link" to="/opportunities/new">
              {t("Create opportunity", "모집 공고 만들기")}
            </Link>
          </section>
        )}
      </div>
    </main>
  );
}

function formatDateTime(value: string, locale: "ko" | "en"): string {
  return new Intl.DateTimeFormat(locale === "ko" ? "ko-KR" : "en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function formatBenefit(
  opportunity: PublicOpportunitySummary,
  locale: "ko" | "en",
): string {
  if (opportunity.benefit.type === "cash") {
    const amount = opportunity.benefit.amount.toLocaleString(
      locale === "ko" ? "ko-KR" : "en-US",
    );
    return locale === "ko"
      ? `${amount}원 · ${opportunity.benefit.description}`
      : `KRW ${amount} · ${opportunity.benefit.description}`;
  }
  return opportunity.benefit.description;
}
