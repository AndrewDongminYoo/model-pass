import { useState } from "react";
import { makeupCertificationV1Metadata } from "../../eligibility/templates/makeup-certification-v1";
import type { OpportunityDraft } from "../domain/opportunity";

interface OpportunityPreviewProps {
  draft: OpportunityDraft;
  applicableExamYear?: number;
}

function ruleReasons(
  draft: OpportunityDraft,
  effect: "hard_fail" | "needs_review" | "reminder",
) {
  return draft.rules
    .filter((rule) => rule.effect === effect)
    .map((rule) => rule.reason);
}

function formatBenefit(draft: OpportunityDraft) {
  if (draft.benefit.type === "cash") {
    return `KRW ${draft.benefit.amount.toLocaleString()}: ${draft.benefit.description}`;
  }

  return draft.benefit.description;
}

function previewText(draft: OpportunityDraft, applicableExamYear?: number) {
  return [
    draft.title,
    `Starts: ${draft.startsAt}`,
    `Closes: ${draft.closesAt}`,
    `Location: ${draft.venueDistrict}`,
    `Duration: ${draft.expectedMinutes} minutes`,
    `Benefit: ${formatBenefit(draft)}`,
    ...(draft.category === "makeup_certification" && applicableExamYear
      ? [`Applicable exam year: ${applicableExamYear}`]
      : []),
    `Hard rules: ${ruleReasons(draft, "hard_fail").join("; ")}`,
    `Review items: ${ruleReasons(draft, "needs_review").join("; ")}`,
    `Reminders: ${ruleReasons(draft, "reminder").join("; ")}`,
  ].join("\n");
}

export function OpportunityPreview({
  draft,
  applicableExamYear,
}: OpportunityPreviewProps) {
  const [confirmedDraft, setConfirmedDraft] = useState<OpportunityDraft>();
  const [copiedDraft, setCopiedDraft] = useState<OpportunityDraft>();
  const [copyErrorDraft, setCopyErrorDraft] = useState<OpportunityDraft>();
  const examYear =
    applicableExamYear ?? makeupCertificationV1Metadata.applicableExamYear;
  const confirmed = confirmedDraft === draft;

  async function copyOpportunity() {
    try {
      const clipboard = navigator.clipboard;
      if (!clipboard) throw new Error("Clipboard access is unavailable.");

      await clipboard.writeText(previewText(draft, examYear));
      setCopiedDraft(draft);
      setCopyErrorDraft(undefined);
    } catch {
      setCopyErrorDraft(draft);
    }
  }

  return (
    <section aria-labelledby="opportunity-preview-heading">
      <h2 id="opportunity-preview-heading">Opportunity preview</h2>
      <dl>
        <dt>Procedure</dt>
        <dd>{draft.title}</dd>
        <dt>Starts at</dt>
        <dd>{draft.startsAt}</dd>
        <dt>Closes at</dt>
        <dd>{draft.closesAt}</dd>
        <dt>Location</dt>
        <dd>{draft.venueDistrict}</dd>
        <dt>Duration</dt>
        <dd>{draft.expectedMinutes} minutes</dd>
        <dt>Benefit</dt>
        <dd>{formatBenefit(draft)}</dd>
      </dl>
      {draft.category === "makeup_certification" && (
        <p>Applicable exam year: {examYear}</p>
      )}
      <RuleList
        heading="Hard rules"
        reasons={ruleReasons(draft, "hard_fail")}
      />
      <RuleList
        heading="Review items"
        reasons={ruleReasons(draft, "needs_review")}
      />
      <RuleList heading="Reminders" reasons={ruleReasons(draft, "reminder")} />
      <label>
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(event) =>
            setConfirmedDraft(event.target.checked ? draft : undefined)
          }
        />
        I confirm this preview matches the intended opportunity.
      </label>
      <button type="button" disabled={!confirmed} onClick={copyOpportunity}>
        Copy opportunity
      </button>
      {copiedDraft === draft && <p role="status">Copied.</p>}
      {copyErrorDraft === draft && (
        <p role="alert">Could not copy the opportunity. Try again.</p>
      )}
    </section>
  );
}

function RuleList({
  heading,
  reasons,
}: {
  heading: string;
  reasons: string[];
}) {
  return (
    <section aria-label={heading}>
      <h3>{heading}</h3>
      {reasons.length > 0 ? (
        <ul>
          {reasons.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      ) : (
        <p>None.</p>
      )}
    </section>
  );
}
