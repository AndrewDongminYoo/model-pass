import { useState } from "react";
import { makeupCertificationV1Metadata } from "../../eligibility/templates/makeup-certification-v1";
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
  onPublish,
}: OpportunityPreviewProps) {
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

      await clipboard.writeText(previewText(draft, examYear));
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
      <h2 id="opportunity-preview-heading">Opportunity preview</h2>
      <dl className="summary-grid">
        <div>
          <dt>Procedure</dt>
          <dd>{draft.title}</dd>
        </div>
        <div>
          <dt>Starts at</dt>
          <dd>{draft.startsAt}</dd>
        </div>
        <div>
          <dt>Closes at</dt>
          <dd>{draft.closesAt}</dd>
        </div>
        <div>
          <dt>Location</dt>
          <dd>{draft.venueDistrict}</dd>
        </div>
        <div>
          <dt>Duration</dt>
          <dd>{draft.expectedMinutes} minutes</dd>
        </div>
        <div>
          <dt>Benefit</dt>
          <dd>{formatBenefit(draft)}</dd>
        </div>
      </dl>
      {draft.category === "makeup_certification" && (
        <p>Applicable exam year: {examYear}</p>
      )}
      <div className="rule-grid">
        <RuleList
          heading="Hard rules"
          reasons={ruleReasons(draft, "hard_fail")}
        />
        <RuleList
          heading="Review items"
          reasons={ruleReasons(draft, "needs_review")}
        />
        <RuleList
          heading="Reminders"
          reasons={ruleReasons(draft, "reminder")}
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
        I confirm this preview matches the intended opportunity.
      </label>
      <button
        className="button--secondary"
        type="button"
        disabled={!confirmed}
        onClick={copyOpportunity}
      >
        Copy opportunity
      </button>
      {copiedDraft === draft && (
        <p className="status--success" role="status">
          Copied.
        </p>
      )}
      {copyErrorDraft === draft && (
        <p role="alert">Could not copy the opportunity. Try again.</p>
      )}
      {onPublish && (
        <section
          className="detail-section form-stack"
          aria-labelledby="hard-rule-confirmation-heading"
        >
          <h3 id="hard-rule-confirmation-heading">Confirm every hard rule</h3>
          {hardRules.map((rule) => (
            <label className="choice" key={rule.id}>
              <input
                type="checkbox"
                checked={confirmedHardRuleIds.includes(rule.id)}
                onChange={(event) =>
                  setHardRuleConfirmed(rule.id, event.target.checked)
                }
              />
              Confirm hard rule: {rule.reason}
            </label>
          ))}
          <button
            type="button"
            disabled={!allHardRulesConfirmed || publishingDraft === draft}
            onClick={() => void publish()}
          >
            {publishingDraft === draft ? "Publishing…" : "Publish opportunity"}
          </button>
          {publishErrorDraft === draft && (
            <p role="alert">Could not publish the opportunity. Try again.</p>
          )}
          {publication?.draft === draft && (
            <div className="link-row">
              <p className="status--success" role="status">
                Opportunity published.
              </p>
              <a
                className="action-link"
                href={publication.result.applicantPath}
              >
                Applicant link
              </a>
              <a
                className="action-link"
                href={publication.result.recruiterReviewPath}
              >
                Recruiter review link
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
}: {
  heading: string;
  reasons: string[];
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
        <p>None.</p>
      )}
    </section>
  );
}
