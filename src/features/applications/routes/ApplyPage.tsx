import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import {
  getPublicOpportunity,
  type PublicOpportunity,
} from "../api/get-public-opportunity";
import { ApplicationForm } from "../components/ApplicationForm";

export function ApplyPage() {
  const { opportunityId } = useParams<{ opportunityId: string }>();
  const [loaded, setLoaded] = useState<{
    opportunityId: string;
    opportunity?: PublicOpportunity;
    error?: string;
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
                  error: "This opportunity is unavailable.",
                },
          );
        }
      })
      .catch(() => {
        if (active) {
          setLoaded({
            opportunityId,
            error: "This opportunity is unavailable.",
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
        <p role="alert">This opportunity is unavailable.</p>
      </main>
    );
  }
  if (loaded?.opportunityId === opportunityId && loaded.error !== undefined) {
    return (
      <main className="app-shell app-shell--narrow auth-shell">
        <p role="alert">{loaded.error}</p>
      </main>
    );
  }
  if (
    loaded?.opportunityId !== opportunityId ||
    loaded.opportunity === undefined
  ) {
    return (
      <main className="app-shell app-shell--narrow auth-shell">
        <p role="status">Loading opportunity</p>
      </main>
    );
  }
  const opportunity = loaded.opportunity;

  return (
    <main className="app-shell">
      <header className="page-header">
        <p className="eyebrow">Model Pass · Application</p>
        <h1>{opportunity.title}</h1>
        <p className="lede">
          Check the session details and eligibility before sharing personal
          information.
        </p>
      </header>
      <dl className="summary-grid">
        <div>
          <dt>Schedule</dt>
          <dd>{new Date(opportunity.startsAt).toLocaleString()}</dd>
        </div>
        <div>
          <dt>Venue area</dt>
          <dd>{opportunity.venueDistrict}</dd>
        </div>
        <div>
          <dt>Expected duration</dt>
          <dd>{opportunity.expectedMinutes} minutes</dd>
        </div>
        <div>
          <dt>Benefit</dt>
          <dd>{formatBenefit(opportunity)}</dd>
        </div>
        <div>
          <dt>Applications close</dt>
          <dd>{new Date(opportunity.closesAt).toLocaleString()}</dd>
        </div>
      </dl>
      <ApplicationForm key={opportunity.id} opportunity={opportunity} />
    </main>
  );
}

function formatBenefit(opportunity: PublicOpportunity): string {
  if (opportunity.benefit.type === "cash") {
    return `${opportunity.benefit.amount.toLocaleString()} KRW — ${opportunity.benefit.description}`;
  }
  return opportunity.benefit.description;
}
