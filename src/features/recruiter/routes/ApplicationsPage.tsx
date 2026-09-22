import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import {
  RecruiterAuthenticationError,
  getRecruiterApplications,
  type RecruiterApplication,
} from "../../applications/api/application-photos";
import { ApplicationCard } from "../components/ApplicationCard";

export function ApplicationsPage() {
  const { opportunityId } = useParams<{ opportunityId: string }>();
  const [result, setResult] = useState<{
    opportunityId: string;
    applications?: RecruiterApplication[];
    error?: string;
  }>();

  useEffect(() => {
    let active = true;
    if (opportunityId === undefined) {
      return () => {
        active = false;
      };
    }

    void getRecruiterApplications(opportunityId)
      .then((loaded) => {
        if (active) {
          setResult({
            opportunityId,
            applications: [...loaded].sort(
              (left, right) =>
                left.createdAt.localeCompare(right.createdAt) ||
                left.id.localeCompare(right.id),
            ),
          });
        }
      })
      .catch((loadError: unknown) => {
        if (active) {
          setResult({
            opportunityId,
            error:
              loadError instanceof RecruiterAuthenticationError
                ? loadError.message
                : "Could not load applications.",
          });
        }
      });

    return () => {
      active = false;
    };
  }, [opportunityId]);

  const currentResult =
    result?.opportunityId === opportunityId ? result : undefined;
  const error =
    opportunityId === undefined
      ? "This opportunity is unavailable."
      : currentResult?.error;
  const applications = currentResult?.applications;

  return (
    <main className="app-shell">
      <header className="page-header">
        <p className="eyebrow">Model Pass · Recruiter</p>
        <h1>Applications</h1>
        <p className="lede">
          Review rule outcomes and applicant details before making a selection.
        </p>
      </header>
      {error ? <p role="alert">{error}</p> : null}
      {applications === undefined && error === undefined ? (
        <p role="status">Loading applications</p>
      ) : null}
      {applications?.length === 0 ? <p>No applications yet.</p> : null}
      {applications?.map((application) => (
        <ApplicationCard key={application.id} application={application} />
      ))}
    </main>
  );
}
