import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import {
  getPublicOpportunity,
  type PublicOpportunity,
} from "../api/get-public-opportunity";
import { ApplicationForm } from "../components/ApplicationForm";

export function ApplyPage() {
  const { opportunityId } = useParams<{ opportunityId: string }>();
  const [opportunity, setOpportunity] = useState<PublicOpportunity>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    let active = true;
    if (opportunityId === undefined) {
      return;
    }

    void getPublicOpportunity(opportunityId)
      .then((result) => {
        if (active) {
          setOpportunity(result);
        }
      })
      .catch(() => {
        if (active) {
          setError("This opportunity is unavailable.");
        }
      });

    return () => {
      active = false;
    };
  }, [opportunityId]);

  if (opportunityId === undefined) {
    return <p role="alert">This opportunity is unavailable.</p>;
  }
  if (error !== undefined) {
    return <p role="alert">{error}</p>;
  }
  if (opportunity === undefined) {
    return <p role="status">Loading opportunity</p>;
  }

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
      <ApplicationForm opportunity={opportunity} />
    </main>
  );
}

function formatBenefit(opportunity: PublicOpportunity): string {
  if (opportunity.benefit.type === "cash") {
    return `${opportunity.benefit.amount.toLocaleString()} KRW — ${opportunity.benefit.description}`;
  }
  return opportunity.benefit.description;
}
