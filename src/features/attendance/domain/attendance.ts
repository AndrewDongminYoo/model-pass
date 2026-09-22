export type AttendanceEventType =
  | "recruiter_confirmed"
  | "applicant_confirmed"
  | "completed"
  | "recruiter_cancelled"
  | "applicant_cancelled"
  | "recruiter_no_show"
  | "applicant_no_show"
  | "dispute_opened"
  | "dispute_resolved";

export type AttendanceParty = "recruiter" | "applicant";
export type AttendanceResolution = "confirmed" | "rejected";

export interface AttendanceEvent {
  id: string;
  eventType: AttendanceEventType;
  party: AttendanceParty;
  occurredAt: string;
  relatedEventId?: string;
  resolution?: AttendanceResolution;
}

export interface AttendanceCounts {
  confirmed: number;
  completed: number;
  cancelled: number;
  noShow: number;
}

export interface AttendanceSummaryResult {
  recruiter: AttendanceCounts;
  applicant: AttendanceCounts;
  history: AttendanceEvent[];
}

export function reduceAttendance(
  events: AttendanceEvent[],
  viewerParty: AttendanceParty,
): AttendanceSummaryResult {
  const disputesByEvent = new Map<string, AttendanceEvent>();
  const resolutionsByDispute = new Map<string, AttendanceEvent>();
  const eventsById = new Map(events.map((event) => [event.id, event]));
  for (const event of events) {
    if (event.eventType === "dispute_opened" && event.relatedEventId) {
      disputesByEvent.set(event.relatedEventId, event);
    }
    if (event.eventType === "dispute_resolved" && event.relatedEventId) {
      resolutionsByDispute.set(event.relatedEventId, event);
    }
  }

  const result: AttendanceSummaryResult = {
    recruiter: emptyCounts(),
    applicant: emptyCounts(),
    history: events.filter((event) =>
      isHistoryEventVisible(
        event,
        viewerParty,
        eventsById,
        disputesByEvent,
        resolutionsByDispute,
      ),
    ),
  };
  for (const event of events) {
    const counts = result[event.party];
    switch (event.eventType) {
      case "recruiter_confirmed":
        counts.confirmed += 1;
        break;
      case "applicant_confirmed":
        counts.confirmed += 1;
        break;
      case "completed":
        counts.completed += 1;
        break;
      case "recruiter_cancelled":
      case "applicant_cancelled":
        counts.cancelled += 1;
        break;
      case "recruiter_no_show":
      case "applicant_no_show":
        if (
          isNoShowVisible(
            event,
            viewerParty,
            disputesByEvent,
            resolutionsByDispute,
          )
        ) {
          counts.noShow += 1;
        }
        break;
      case "dispute_opened":
      case "dispute_resolved":
        break;
    }
  }
  return result;
}

function isHistoryEventVisible(
  event: AttendanceEvent,
  viewerParty: AttendanceParty,
  eventsById: Map<string, AttendanceEvent>,
  disputesByEvent: Map<string, AttendanceEvent>,
  resolutionsByDispute: Map<string, AttendanceEvent>,
): boolean {
  if (
    event.eventType === "recruiter_no_show" ||
    event.eventType === "applicant_no_show"
  ) {
    return isNoShowVisible(
      event,
      viewerParty,
      disputesByEvent,
      resolutionsByDispute,
    );
  }
  if (event.eventType === "dispute_opened") {
    if (event.relatedEventId === undefined) return false;
    const noShow = eventsById.get(event.relatedEventId);
    if (noShow === undefined) return false;
    return isNoShowVisible(
      noShow,
      viewerParty,
      disputesByEvent,
      resolutionsByDispute,
    );
  }
  if (event.eventType === "dispute_resolved") {
    if (event.relatedEventId === undefined) return false;
    const dispute = eventsById.get(event.relatedEventId);
    if (dispute?.relatedEventId === undefined) return false;
    const noShow = eventsById.get(dispute.relatedEventId);
    if (noShow === undefined) return false;
    return isNoShowVisible(
      noShow,
      viewerParty,
      disputesByEvent,
      resolutionsByDispute,
    );
  }
  return true;
}

function emptyCounts(): AttendanceCounts {
  return { confirmed: 0, completed: 0, cancelled: 0, noShow: 0 };
}

function isNoShowVisible(
  event: AttendanceEvent,
  viewerParty: AttendanceParty,
  disputesByEvent: Map<string, AttendanceEvent>,
  resolutionsByDispute: Map<string, AttendanceEvent>,
): boolean {
  if (viewerParty === event.party) {
    return true;
  }
  const dispute = disputesByEvent.get(event.id);
  if (dispute === undefined) {
    return true;
  }
  return resolutionsByDispute.get(dispute.id)?.resolution === "confirmed";
}
