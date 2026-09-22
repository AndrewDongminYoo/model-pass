import { useEffect, useRef, useState } from "react";
import {
  AttendanceRequestError,
  getAttendance,
  recordAttendance,
  type AttendanceCapability,
  type AttendanceStatus,
} from "../../applications/api/attendance";
import { useI18n } from "../../../i18n/locale";
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

type AttendanceError = { kind: "load" } | { kind: "submit"; message?: string };

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
  const { t } = useI18n();
  const { applicationId, opportunityId, submissionAttemptId } = capability;
  const [attendance, setAttendance] = useState<AttendanceStatus>();
  const [loading, setLoading] = useState(true);
  const [pendingAction, setPendingAction] = useState<string>();
  const [error, setError] = useState<AttendanceError>();
  const [success, setSuccess] = useState(false);
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
        setError({ kind: "load" });
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
          setError({ kind: "load" });
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
    setSuccess(false);
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
        setSuccess(true);
      }
    } catch (submitError) {
      if (activeRef.current) {
        setError({
          kind: "submit",
          ...(submitError instanceof AttendanceRequestError
            ? { message: submitError.message }
            : {}),
        });
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
    <section
      className="detail-section"
      aria-label={t("Manage attendance", "참여 기록 관리")}
    >
      <AttendanceSummary events={visibleEvents} viewerParty={viewerParty} />
      {loading ? (
        <p role="status">
          {t("Loading attendance history…", "참여 이력을 불러오고 있습니다…")}
        </p>
      ) : null}
      {!loading && attendance?.selected === false ? (
        <p role="status">
          {t(
            "Waiting for recruiter selection.",
            "모집자의 선택을 기다리고 있습니다.",
          )}
        </p>
      ) : null}
      {error ? <p role="alert">{attendanceErrorMessage(error, t)}</p> : null}
      {error?.kind === "load" ? (
        <button
          className="button--secondary"
          type="button"
          disabled={loading}
          onClick={() => void load()}
        >
          {t("Retry", "다시 시도")}
        </button>
      ) : null}
      {success ? (
        <p className="status--success" role="status">
          {t(
            "Attendance history has been updated.",
            "참여 기록을 업데이트했습니다.",
          )}
        </p>
      ) : null}
      {pendingAction !== undefined ? (
        <p role="status">
          {t("Saving attendance history…", "참여 기록을 저장하고 있습니다…")}
        </p>
      ) : null}
      {!loading && attendance?.selected === true ? (
        <div
          className="button-row"
          role="group"
          aria-label={t("Attendance actions", "참여 기록 작업")}
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
              {actionLabel(action, t)}
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
              {t(
                `Dispute ${event.party === "recruiter" ? "recruiter" : "applicant"} no-show`,
                `${event.party === "recruiter" ? "모집자" : "지원자"} 불참 이의 제기`,
              )}
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

function actionLabel(
  action: AttendanceEventType,
  t: (en: string, ko: string) => string,
): string {
  switch (action) {
    case "recruiter_confirmed":
    case "applicant_confirmed":
      return t("Confirm attendance", "참여 확정");
    case "completed":
      return t("Record completion", "일정 완료 기록");
    case "recruiter_cancelled":
      return t("Record recruiter cancellation", "모집자 취소 기록");
    case "applicant_cancelled":
      return t("Record applicant cancellation", "지원자 취소 기록");
    case "recruiter_no_show":
      return t("Record recruiter no-show", "모집자 불참 기록");
    case "applicant_no_show":
      return t("Record applicant no-show", "지원자 불참 기록");
    case "dispute_opened":
      return t("Dispute", "이의 제기");
    case "dispute_resolved":
      return t("Resolve dispute", "이의 제기 처리");
  }
}

function attendanceErrorMessage(
  error: AttendanceError,
  t: (en: string, ko: string) => string,
) {
  if (error.kind === "submit" && error.message !== undefined) {
    const koreanMessage: Record<string, string> = {
      "Attendance access denied.": "참여 기록에 접근할 수 없습니다.",
      "Attendance is unavailable until recruiter selection.":
        "모집자가 지원자를 선택한 뒤 참여 기록을 사용할 수 있습니다.",
      "Attendance confirmation is only available before the appointment.":
        "참여 확정은 약속 시간 전까지만 할 수 있습니다.",
      "Attendance outcomes are only available after the appointment starts.":
        "일정 결과는 약속 시간이 시작된 뒤 기록할 수 있습니다.",
      "Invalid attendance request.": "참여 기록 요청을 확인해 주세요.",
    };
    return t(
      error.message,
      koreanMessage[error.message] ??
        "참여 기록을 업데이트하지 못했습니다. 다시 시도해 주세요.",
    );
  }
  return error.kind === "load"
    ? t(
        "Could not load attendance history.",
        "참여 이력을 불러오지 못했습니다.",
      )
    : t(
        "Could not update attendance history. Please try again.",
        "참여 기록을 업데이트하지 못했습니다. 다시 시도해 주세요.",
      );
}
