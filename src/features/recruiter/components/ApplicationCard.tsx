import { useCallback, useState } from "react";
import { useParams } from "react-router-dom";
import {
  createPhotoViewUrl,
  type RecruiterApplication,
} from "../../applications/api/application-photos";
import { AttendanceSummary } from "../../attendance/components/AttendanceSummary";
import { AttendanceManager } from "../../attendance/components/AttendanceManager";
import { selectApplication } from "../../applications/api/attendance";

interface ApplicationCardProps {
  application: RecruiterApplication;
}

export function ApplicationCard({ application }: ApplicationCardProps) {
  const { opportunityId } = useParams<{ opportunityId: string }>();
  const [photoUrls, setPhotoUrls] = useState<Record<string, string>>({});
  const [photoErrors, setPhotoErrors] = useState<Record<string, string>>({});
  const [pendingPhotoId, setPendingPhotoId] = useState<string>();
  const [selected, setSelected] = useState<boolean>();
  const [selectionPending, setSelectionPending] = useState(false);
  const [selectionError, setSelectionError] = useState<string>();
  const handleSelectionStatus = useCallback((value: boolean) => {
    setSelected(value);
  }, []);

  async function requestPhoto(photoId: string) {
    setPendingPhotoId(photoId);
    setPhotoErrors((current) => ({ ...current, [photoId]: "" }));
    try {
      const viewUrl = await createPhotoViewUrl(application.id, photoId);
      setPhotoUrls((current) => ({ ...current, [photoId]: viewUrl }));
    } catch {
      setPhotoErrors((current) => ({
        ...current,
        [photoId]: "Could not open this private photo. Try again.",
      }));
    } finally {
      setPendingPhotoId(undefined);
    }
  }

  async function select() {
    if (opportunityId === undefined || selectionPending) return;
    setSelectionPending(true);
    setSelectionError(undefined);
    try {
      await selectApplication({ applicationId: application.id, opportunityId });
      setSelected(true);
    } catch {
      setSelectionError("Could not select this application. Try again.");
    } finally {
      setSelectionPending(false);
    }
  }

  const outcomes = [
    ...application.evaluation.failures,
    ...application.evaluation.reviews,
    ...application.evaluation.reminders,
  ];

  return (
    <article className="surface application-card">
      <header className="application-card__header">
        <div>
          <h2>{application.applicantDisplayName}</h2>
          <p>{application.applicantPhone}</p>
        </div>
        <p className="helper-text">
          Submitted{" "}
          <time dateTime={application.createdAt}>{application.createdAt}</time>
        </p>
      </header>
      <section className="detail-section" aria-label="Deterministic evaluation">
        <h3>Deterministic evaluation</h3>
        <p>{application.evaluation.eligible ? "Eligible" : "Not eligible"}</p>
        <p>
          Ruleset: {application.evaluation.rulesetId} v
          {application.evaluation.rulesetVersion}
        </p>
        {outcomes.length > 0 ? (
          <ul>
            {outcomes.map((outcome) => (
              <li key={`${outcome.effect}-${outcome.ruleId}`}>
                {outcome.ruleId} — input: {String(outcome.input)}; effect:{" "}
                {outcome.effect}; reason: {outcome.reason}
              </li>
            ))}
          </ul>
        ) : null}
      </section>
      <section className="detail-section" aria-label="Application answers">
        <h3>Answers</h3>
        <ul>
          {application.answers.map((answer) => (
            <li key={answer.field}>
              {answer.field}: {String(answer.value)}
            </li>
          ))}
        </ul>
      </section>
      <section className="detail-section" aria-label="Private photos">
        <h3>Private photos</h3>
        {application.photos.length === 0 ? <p>No photo uploaded.</p> : null}
        {application.photos.map((photo, index) => {
          const ordinal = index + 1;
          const error = photoErrors[photo.id];
          const viewUrl = photoUrls[photo.id];
          return (
            <div key={photo.id}>
              <p>
                Photo {ordinal}: {photo.contentType}, {photo.byteSize} bytes
              </p>
              <button
                className="button--secondary"
                type="button"
                disabled={pendingPhotoId === photo.id}
                onClick={() => void requestPhoto(photo.id)}
              >
                {pendingPhotoId === photo.id
                  ? `Opening private photo ${ordinal}`
                  : `View private photo ${ordinal}`}
              </button>
              {viewUrl !== undefined ? (
                <a
                  className="action-link"
                  href={viewUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open private photo {ordinal}
                </a>
              ) : null}
              {error ? <p role="alert">{error}</p> : null}
            </div>
          );
        })}
      </section>
      {opportunityId === undefined ? (
        <AttendanceSummary
          events={application.attendance}
          viewerParty="recruiter"
        />
      ) : (
        <>
          {selected === false ? (
            <div className="detail-section">
              <button
                type="button"
                disabled={selectionPending}
                onClick={() => void select()}
              >
                {selectionPending
                  ? "Selecting application"
                  : "Select application"}
              </button>
            </div>
          ) : null}
          {selectionError ? <p role="alert">{selectionError}</p> : null}
          <AttendanceManager
            key={selected === true ? "selected" : "pending"}
            capability={{ applicationId: application.id, opportunityId }}
            viewerParty="recruiter"
            initialEvents={application.attendance}
            onSelectionStatus={handleSelectionStatus}
          />
        </>
      )}
    </article>
  );
}
