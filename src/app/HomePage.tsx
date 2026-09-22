import { Link } from "react-router-dom";
import { appNameFor } from "../i18n/brand";
import { useI18n } from "../i18n/locale";

export function HomePage() {
  const { locale, t } = useI18n();
  return (
    <main className="app-shell home-shell">
      <header className="page-header">
        <p className="eyebrow">
          {t("Hair and makeup exam models", "헤어·메이크업 시험 모델 모집")}
        </p>
        <h1 className="brand-name">{appNameFor(locale)}</h1>
        <p className="lede">
          {t(
            "Clear procedure and compensation details for models, and organized requirements for recruiters.",
            "모델에게는 시술과 보상 조건을 분명하게, 모집자에게는 확인할 조건을 빠짐없이 보여줍니다.",
          )}
        </p>
      </header>
      <div className="home-grid">
        <section
          className="surface home-card"
          aria-labelledby="applicant-heading"
        >
          <h2 id="applicant-heading">
            {t("Want to be a model?", "모델로 참여하고 싶나요?")}
          </h2>
          <p>
            {t(
              "Open a recruiter's opportunity link to check the schedule and benefits. Review the requirements before applying.",
              "모집자가 공유한 공고 링크에서 일정과 혜택을 확인하고 지원할 수 있습니다. 지원 전에 필요한 조건부터 확인해 보세요.",
            )}
          </p>
          <p className="home-note">
            {t(
              "For now, applications are available only through a shared opportunity link.",
              "지금은 공고 링크를 통해서만 지원할 수 있습니다.",
            )}
          </p>
        </section>
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
      </div>
    </main>
  );
}
