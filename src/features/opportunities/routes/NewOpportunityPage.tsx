import { useState } from "react";
import { publishOpportunity } from "../api/publish-opportunity";
import { OpportunityForm } from "../components/OpportunityForm";
import { OpportunityPreview } from "../components/OpportunityPreview";
import type { OpportunityDraft } from "../domain/opportunity";
import { makeupCertificationV1Metadata } from "../../eligibility/templates/makeup-certification-v1";

export function NewOpportunityPage() {
  const [draft, setDraft] = useState<OpportunityDraft>();

  return (
    <main className="app-shell">
      <header className="page-header">
        <p className="eyebrow">Model Pass · Recruiter</p>
        <h1>Create opportunity</h1>
        <p className="lede">
          Turn the requirements for one session into a clear, reviewable
          application flow.
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
