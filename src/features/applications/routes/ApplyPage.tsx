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
    return <p role="alert">This opportunity is unavailable.</p>;
  }
  if (loaded?.opportunityId === opportunityId && loaded.error !== undefined) {
    return <p role="alert">{loaded.error}</p>;
  }
  if (
    loaded?.opportunityId !== opportunityId ||
    loaded.opportunity === undefined
  ) {
    return <p role="status">Loading opportunity</p>;
  }
  const opportunity = loaded.opportunity;

  return (
    <main>
      <h1>{opportunity.title}</h1>
      <dl>
        <dt>Schedule</dt>
        <dd>{new Date(opportunity.startsAt).toLocaleString()}</dd>
        <dt>Venue area</dt>
        <dd>{opportunity.venueDistrict}</dd>
        <dt>Expected duration</dt>
        <dd>{opportunity.expectedMinutes} minutes</dd>
        <dt>Benefit</dt>
        <dd>{formatBenefit(opportunity)}</dd>
        <dt>Applications close</dt>
        <dd>{new Date(opportunity.closesAt).toLocaleString()}</dd>
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
