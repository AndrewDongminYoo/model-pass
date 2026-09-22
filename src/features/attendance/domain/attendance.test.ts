import { describe, expect, it } from "vitest";
import {
  reduceAttendance,
  type AttendanceEvent,
  type AttendanceEventType,
} from "./attendance";

const exactEventTypes: AttendanceEventType[] = [
  "recruiter_confirmed",
  "applicant_confirmed",
  "completed",
  "recruiter_cancelled",
  "applicant_cancelled",
  "recruiter_no_show",
  "applicant_no_show",
  "dispute_opened",
  "dispute_resolved",
];

describe("reduceAttendance", () => {
  it("keeps separate factual counts and the original history", () => {
    // Production break: combining the parties into one score hides which factual events occurred to whom.
    const events: AttendanceEvent[] = [
      event("1", "recruiter_confirmed", "recruiter"),
      event("2", "applicant_confirmed", "applicant"),
      event("3", "completed", "recruiter"),
      event("4", "completed", "applicant"),
      event("5", "recruiter_cancelled", "recruiter"),
      event("6", "applicant_cancelled", "applicant"),
      event("7", "recruiter_no_show", "recruiter"),
      event("8", "applicant_no_show", "applicant"),
    ];

    expect(reduceAttendance(events, "recruiter")).toEqual({
      recruiter: { confirmed: 1, completed: 1, cancelled: 1, noShow: 1 },
      applicant: { confirmed: 1, completed: 1, cancelled: 1, noShow: 1 },
      history: events,
    });
    expect(exactEventTypes).toHaveLength(9);
  });

  it("hides a disputed no-show from the counterparty until confirmed", () => {
    // Production break: counting an unresolved accusation exposes disputed history as settled fact.
    const noShow = event("1", "applicant_no_show", "applicant");
    const dispute: AttendanceEvent = {
      ...event("2", "dispute_opened", "applicant"),
      relatedEventId: noShow.id,
    };

    const unresolved = reduceAttendance([noShow, dispute], "recruiter");
    const confirmed = reduceAttendance(
      [
        noShow,
        dispute,
        {
          ...event("3", "dispute_resolved", "applicant"),
          relatedEventId: dispute.id,
          resolution: "confirmed",
        },
      ],
      "recruiter",
    );

    expect(unresolved.applicant.noShow).toBe(0);
    expect(unresolved.history).toEqual([]);
    expect(confirmed.applicant.noShow).toBe(1);
    expect(confirmed.history).toEqual([
      noShow,
      dispute,
      expect.objectContaining({ id: "3", resolution: "confirmed" }),
    ]);
  });

  it("keeps a rejected no-show out of the counterparty count", () => {
    // Production break: treating every operator resolution as confirmation publishes a rejected no-show.
    const noShow = event("1", "recruiter_no_show", "recruiter");
    const dispute: AttendanceEvent = {
      ...event("2", "dispute_opened", "recruiter"),
      relatedEventId: noShow.id,
    };
    const resolution: AttendanceEvent = {
      ...event("3", "dispute_resolved", "recruiter"),
      relatedEventId: dispute.id,
      resolution: "rejected",
    };

    expect(
      reduceAttendance([noShow, dispute, resolution], "applicant").recruiter
        .noShow,
    ).toBe(0);
    expect(
      reduceAttendance([noShow, dispute, resolution], "applicant").history,
    ).toEqual([]);
    expect(
      reduceAttendance([noShow, dispute, resolution], "recruiter").history,
    ).toEqual([noShow, dispute, resolution]);
  });
});

function event(
  id: string,
  eventType: AttendanceEventType,
  party: "recruiter" | "applicant",
): AttendanceEvent {
  return {
    id,
    eventType,
    party,
    occurredAt: `2026-09-22T0${id}:00:00.000Z`,
  };
}
