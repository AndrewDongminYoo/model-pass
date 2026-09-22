import {
  reduceAttendance,
  type AttendanceEvent,
  type AttendanceParty,
} from "../domain/attendance";
import { useI18n } from "../../../i18n/locale";

interface AttendanceSummaryProps {
  events: AttendanceEvent[];
  viewerParty: AttendanceParty;
}

export function AttendanceSummary({
  events,
  viewerParty,
}: AttendanceSummaryProps) {
  const { locale, t } = useI18n();
  const summary = reduceAttendance(events, viewerParty);
  return (
    <section
      className="surface surface--subtle"
      aria-label={t("Attendance history", "참여 이력")}
    >
      <h3>{t("Attendance history", "참여 이력")}</h3>
      <FactCounts
        label={t("Recruiter facts", "모집자 기록")}
        counts={summary.recruiter}
        t={t}
      />
      <FactCounts
        label={t("Applicant facts", "지원자 기록")}
        counts={summary.applicant}
        t={t}
      />
      {summary.history.length === 0 ? (
        <p>{t("No attendance history yet.", "아직 참여 기록이 없습니다.")}</p>
      ) : (
        <ul>
          {summary.history.map((event) => (
            <li key={event.id}>
              {partyLabel(event.party, t)}: {eventLabel(event.eventType, t)}{" "}
              <time dateTime={event.occurredAt}>
                {new Date(event.occurredAt).toLocaleString(
                  locale === "ko" ? "ko-KR" : "en-US",
                )}
              </time>
              {event.resolution
                ? ` (${resolutionLabel(event.resolution, t)})`
                : null}
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
  t,
}: {
  label: string;
  counts: {
    confirmed: number;
    completed: number;
    cancelled: number;
    noShow: number;
  };
  t: (en: string, ko: string) => string;
}) {
  return (
    <div className="detail-section" role="group" aria-label={label}>
      <h4>{label}</h4>
      <ul>
        <li>
          {t("Confirmed", "참여 확정")}: {counts.confirmed}
        </li>
        <li>
          {t("Completed", "일정 완료")}: {counts.completed}
        </li>
        <li>
          {t("Cancelled", "취소")}: {counts.cancelled}
        </li>
        <li>
          {t("No-show", "불참")}: {counts.noShow}
        </li>
      </ul>
    </div>
  );
}

function partyLabel(
  party: AttendanceParty,
  t: (en: string, ko: string) => string,
) {
  return party === "recruiter"
    ? t("Recruiter", "모집자")
    : t("Applicant", "지원자");
}

function eventLabel(
  eventType: AttendanceEvent["eventType"],
  t: (en: string, ko: string) => string,
) {
  switch (eventType) {
    case "recruiter_confirmed":
      return t("Recruiter confirmed attendance", "모집자 참여 확정");
    case "applicant_confirmed":
      return t("Applicant confirmed attendance", "지원자 참여 확정");
    case "completed":
      return t("Schedule completed", "일정 완료");
    case "recruiter_cancelled":
      return t("Recruiter cancelled", "모집자 취소");
    case "applicant_cancelled":
      return t("Applicant cancelled", "지원자 취소");
    case "recruiter_no_show":
      return t("Recruiter no-show", "모집자 불참");
    case "applicant_no_show":
      return t("Applicant no-show", "지원자 불참");
    case "dispute_opened":
      return t("Dispute opened", "이의 제기");
    case "dispute_resolved":
      return t("Dispute resolved", "이의 제기 처리");
  }
}

function resolutionLabel(
  resolution: NonNullable<AttendanceEvent["resolution"]>,
  t: (en: string, ko: string) => string,
) {
  return resolution === "confirmed"
    ? t("Confirmed", "확정")
    : t("Rejected", "기각");
}
