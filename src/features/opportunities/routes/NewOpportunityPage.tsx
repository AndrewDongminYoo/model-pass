import { useState } from "react";
import { publishOpportunity } from "../api/publish-opportunity";
import { OpportunityForm } from "../components/OpportunityForm";
import { OpportunityPreview } from "../components/OpportunityPreview";
import type { OpportunityDraft } from "../domain/opportunity";
import { makeupCertificationV1Metadata } from "../../eligibility/templates/makeup-certification-v1";
import { appNameFor } from "../../../i18n/brand";
import { useI18n } from "../../../i18n/locale";

export function NewOpportunityPage() {
  const { locale, t } = useI18n();
  const [draft, setDraft] = useState<OpportunityDraft>();

  return (
    <main className="app-shell">
      <header className="page-header">
        <p className="eyebrow">
          {appNameFor(locale)} · {t("Recruiter", "모집자")}
        </p>
        <h1>{t("Create opportunity", "모집 공고 만들기")}</h1>
        <p className="lede">
          {t(
            "Turn the requirements for one session into a clear, reviewable application flow.",
            "한 번의 시험이나 시술에 필요한 조건을 정리하고, 지원자가 확인하기 쉬운 공고를 만드세요.",
          )}
        </p>
      </header>
      <OpportunityForm onSubmit={setDraft} />
      {draft && (
        <OpportunityPreview
          draft={draft}
          onPublish={publishOpportunity}
          applicableExamYear={
            draft.category === "makeup_certification"
              ? makeupCertificationV1Metadata.applicableExamYear
              : undefined
          }
        />
      )}
    </main>
  );
}
