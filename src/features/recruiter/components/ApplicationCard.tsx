import { useState } from "react";
import {
  createPhotoViewUrl,
  type RecruiterApplication,
} from "../../applications/api/application-photos";
import { AttendanceSummary } from "../../attendance/components/AttendanceSummary";

interface ApplicationCardProps {
  application: RecruiterApplication;
}

export function ApplicationCard({ application }: ApplicationCardProps) {
  const [photoUrls, setPhotoUrls] = useState<Record<string, string>>({});
  const [photoErrors, setPhotoErrors] = useState<Record<string, string>>({});
  const [pendingPhotoId, setPendingPhotoId] = useState<string>();

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

  const outcomes = [
    ...application.evaluation.failures,
    ...application.evaluation.reviews,
    ...application.evaluation.reminders,
  ];

  return (
    <article>
      <h2>{application.applicantDisplayName}</h2>
      <p>{application.applicantPhone}</p>
      <p>
        Submission time:{" "}
        <time dateTime={application.createdAt}>{application.createdAt}</time>
      </p>
      <section aria-label="Deterministic evaluation">
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
      <section aria-label="Application answers">
        <h3>Answers</h3>
        <ul>
          {application.answers.map((answer) => (
            <li key={answer.field}>
              {answer.field}: {String(answer.value)}
            </li>
          ))}
        </ul>
      </section>
      <section aria-label="Private photos">
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
                type="button"
                disabled={pendingPhotoId === photo.id}
                onClick={() => void requestPhoto(photo.id)}
              >
                {pendingPhotoId === photo.id
                  ? `Opening private photo ${ordinal}`
                  : `View private photo ${ordinal}`}
              </button>
              {viewUrl !== undefined ? (
                <a href={viewUrl} target="_blank" rel="noreferrer">
                  Open private photo {ordinal}
                </a>
              ) : null}
              {error ? <p role="alert">{error}</p> : null}
            </div>
          );
        })}
      </section>
      <AttendanceSummary
        events={application.attendance}
        viewerParty="recruiter"
      />
    </article>
  );
}
