import {
  reduceAttendance,
  type AttendanceEvent,
  type AttendanceParty,
} from "../domain/attendance";

interface AttendanceSummaryProps {
  events: AttendanceEvent[];
  viewerParty: AttendanceParty;
}

export function AttendanceSummary({
  events,
  viewerParty,
}: AttendanceSummaryProps) {
  const summary = reduceAttendance(events, viewerParty);
  return (
    <section aria-label="Attendance history">
      <h3>Attendance history</h3>
      <FactCounts label="Recruiter facts" counts={summary.recruiter} />
      <FactCounts label="Applicant facts" counts={summary.applicant} />
      {summary.history.length === 0 ? (
        <p>No attendance events.</p>
      ) : (
        <ul>
          {summary.history.map((event) => (
            <li key={event.id}>
              {event.party}: {event.eventType}{" "}
              <time dateTime={event.occurredAt}>{event.occurredAt}</time>
              {event.resolution ? ` (${event.resolution})` : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function FactCounts({
  label,
  counts,
}: {
  label: string;
  counts: {
    confirmed: number;
    completed: number;
    cancelled: number;
    noShow: number;
  };
}) {
  return (
    <div role="group" aria-label={label}>
      <h4>{label}</h4>
      <ul>
        <li>Confirmed: {counts.confirmed}</li>
        <li>Completed: {counts.completed}</li>
        <li>Cancelled: {counts.cancelled}</li>
        <li>No-show: {counts.noShow}</li>
      </ul>
    </div>
  );
}
