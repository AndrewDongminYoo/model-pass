import { useEffect, useRef, useState } from "react";
import {
  AttendanceRequestError,
  getAttendance,
  recordAttendance,
  type AttendanceCapability,
  type AttendanceStatus,
} from "../../applications/api/attendance";
import type {
  AttendanceEvent,
  AttendanceEventType,
  AttendanceParty,
} from "../domain/attendance";
import { AttendanceSummary } from "./AttendanceSummary";

interface AttendanceManagerProps {
  capability: AttendanceCapability;
  viewerParty: AttendanceParty;
  initialEvents?: AttendanceEvent[];
  onSelectionStatus?: (selected: boolean) => void;
}

const recruiterActions = new Set<AttendanceEventType>([
  "recruiter_confirmed",
  "completed",
  "recruiter_cancelled",
  "applicant_no_show",
]);
const applicantActions = new Set<AttendanceEventType>([
  "applicant_confirmed",
  "completed",
  "applicant_cancelled",
  "recruiter_no_show",
]);

export function AttendanceManager({
  capability,
  viewerParty,
  initialEvents = [],
  onSelectionStatus,
}: AttendanceManagerProps) {
  const { applicationId, opportunityId, submissionAttemptId } = capability;
  const [attendance, setAttendance] = useState<AttendanceStatus>();
  const [loading, setLoading] = useState(true);
  const [pendingAction, setPendingAction] = useState<string>();
  const [error, setError] = useState<string>();
  const [success, setSuccess] = useState<string>();
  const activeRef = useRef(true);

  async function load() {
    setLoading(true);
    setError(undefined);
    try {
      const loaded = await getAttendance({
        applicationId,
        opportunityId,
        ...(submissionAttemptId === undefined ? {} : { submissionAttemptId }),
      });
      if (loaded.viewerParty !== viewerParty) {
        throw new Error("Attendance viewer mismatch.");
      }
      if (activeRef.current) {
        setAttendance(loaded);
        onSelectionStatus?.(loaded.selected);
      }
    } catch {
      if (activeRef.current) {
        setError("Could not load attendance history.");
      }
    } finally {
      if (activeRef.current) setLoading(false);
    }
  }

  useEffect(() => {
    activeRef.current = true;
    void getAttendance({
      applicationId,
      opportunityId,
      ...(submissionAttemptId === undefined ? {} : { submissionAttemptId }),
    })
      .then((loaded) => {
        if (!activeRef.current) return;
        if (loaded.viewerParty !== viewerParty) {
          throw new Error("Attendance viewer mismatch.");
        }
        setAttendance(loaded);
        onSelectionStatus?.(loaded.selected);
      })
      .catch(() => {
        if (activeRef.current) {
          setError("Could not load attendance history.");
        }
      })
      .finally(() => {
        if (activeRef.current) setLoading(false);
      });
    return () => {
      activeRef.current = false;
    };
  }, [
    applicationId,
    opportunityId,
    onSelectionStatus,
    submissionAttemptId,
    viewerParty,
  ]);

  async function submit(
    eventType: AttendanceEventType,
    party: AttendanceParty,
    relatedEventId?: string,
  ) {
    if (pendingAction !== undefined) return;
    setPendingAction(relatedEventId ?? eventType);
    setError(undefined);
    setSuccess(undefined);
    try {
      await recordAttendance({
        applicationId,
        opportunityId,
        ...(submissionAttemptId === undefined ? {} : { submissionAttemptId }),
        eventType,
        party,
        ...(relatedEventId === undefined ? {} : { relatedEventId }),
      });
      const refreshed = await getAttendance({
        applicationId,
        opportunityId,
        ...(submissionAttemptId === undefined ? {} : { submissionAttemptId }),
      });
      if (refreshed.viewerParty !== viewerParty) {
        throw new Error("Attendance viewer mismatch.");
      }
      if (activeRef.current) {
        setAttendance(refreshed);
        onSelectionStatus?.(refreshed.selected);
        setSuccess("Attendance updated.");
      }
    } catch (submitError) {
      if (activeRef.current) {
        setError(
          submitError instanceof AttendanceRequestError
            ? submitError.message
            : "Could not update attendance. Try again.",
        );
      }
    } finally {
      if (activeRef.current) setPendingAction(undefined);
    }
  }

  const visibleEvents = attendance?.events ?? initialEvents;
  const allowedSet =
    viewerParty === "recruiter" ? recruiterActions : applicantActions;
  const allowedActions =
    attendance?.allowedActions.filter((action) => allowedSet.has(action)) ?? [];
  const disputedEventIds = new Set(
    visibleEvents
      .filter(
        (event) =>
          event.eventType === "dispute_opened" &&
          event.relatedEventId !== undefined,
      )
      .map((event) => event.relatedEventId),
  );
  const disputableNoShows = visibleEvents.filter(
    (event) =>
      event.party === viewerParty &&
      (event.eventType === "recruiter_no_show" ||
        event.eventType === "applicant_no_show") &&
      !disputedEventIds.has(event.id),
  );

  return (
    <section className="detail-section" aria-label="Attendance management">
      <AttendanceSummary events={visibleEvents} viewerParty={viewerParty} />
      {loading ? <p role="status">Loading attendance history.</p> : null}
      {!loading && attendance?.selected === false ? (
        <p role="status">Waiting for recruiter selection.</p>
      ) : null}
      {error ? <p role="alert">{error}</p> : null}
      {error === "Could not load attendance history." ? (
        <button
          className="button--secondary"
          type="button"
          disabled={loading}
          onClick={() => void load()}
        >
          Retry attendance
        </button>
      ) : null}
      {success ? (
        <p className="status--success" role="status">
          {success}
        </p>
      ) : null}
      {pendingAction !== undefined ? (
        <p role="status">Recording attendance.</p>
      ) : null}
      {!loading && attendance?.selected === true ? (
        <div
          className="button-row"
          role="group"
          aria-label="Attendance actions"
        >
          {allowedActions.map((action) => (
            <button
              className="button--secondary"
              key={action}
              type="button"
              disabled={pendingAction !== undefined}
              onClick={() =>
                void submit(action, partyForAction(action, viewerParty))
              }
            >
              {actionLabel(action)}
            </button>
          ))}
          {disputableNoShows.map((event) => (
            <button
              className="button--danger"
              key={`dispute-${event.id}`}
              type="button"
              disabled={pendingAction !== undefined}
              onClick={() =>
                void submit("dispute_opened", viewerParty, event.id)
              }
            >
              Dispute {event.party} no-show
            </button>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function partyForAction(
  action: AttendanceEventType,
  viewerParty: AttendanceParty,
): AttendanceParty {
  if (action.startsWith("recruiter_")) return "recruiter";
  if (action.startsWith("applicant_")) return "applicant";
  return viewerParty;
}

function actionLabel(action: AttendanceEventType): string {
  switch (action) {
    case "recruiter_confirmed":
    case "applicant_confirmed":
      return "Confirm attendance";
    case "completed":
      return "Mark completed";
    case "recruiter_cancelled":
      return "Record recruiter cancellation";
    case "applicant_cancelled":
      return "Record applicant cancellation";
    case "recruiter_no_show":
      return "Record recruiter no-show";
    case "applicant_no_show":
      return "Record applicant no-show";
    case "dispute_opened":
      return "Open dispute";
    case "dispute_resolved":
      return "Resolve dispute";
  }
}
