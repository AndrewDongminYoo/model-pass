import { useState } from "react";
import { OpportunityForm } from "../components/OpportunityForm";
import { OpportunityPreview } from "../components/OpportunityPreview";
import type { OpportunityDraft } from "../domain/opportunity";
import { makeupCertificationV1Metadata } from "../../eligibility/templates/makeup-certification-v1";

export function NewOpportunityPage() {
  const [draft, setDraft] = useState<OpportunityDraft>();

  return (
    <main>
      <h1>Model Pass</h1>
      <h2>Create opportunity</h2>
      <OpportunityForm onSubmit={setDraft} />
      {draft && (
        <OpportunityPreview
          draft={draft}
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
