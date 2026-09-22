import { describe, expect, it } from "vitest";
import { parsePilotEvent, type PilotEvent } from "./events";

describe("parsePilotEvent", () => {
  it("accepts only the five pilot event payload shapes", () => {
    // Production break: adding required personal or free-text fields would make operational metrics depend on applicant content.
    const events = [
      { name: "opportunity_previewed", category: "hair_promotion" },
      { name: "application_started", opportunityId: "opportunity-1" },
      {
        name: "eligibility_checked",
        opportunityId: "opportunity-1",
        eligible: true,
      },
      { name: "application_submitted", opportunityId: "opportunity-1" },
      {
        name: "attendance_recorded",
        opportunityId: "opportunity-1",
        outcome: "completed",
      },
    ] satisfies readonly PilotEvent[];

    expect(events.map((event) => parsePilotEvent(event))).toEqual(events);
    expect(events.map((event) => event.name)).toEqual([
      "opportunity_previewed",
      "application_started",
      "eligibility_checked",
      "application_submitted",
      "attendance_recorded",
    ]);
  });

  it.each(["answers", "phoneNumber", "photoUrl", "freeText"])(
    "rejects the sensitive or free-text field %s",
    (field) => {
      // Production break: a non-strict schema could silently admit personal application data into operational events.
      expect(() =>
        parsePilotEvent({
          name: "application_submitted",
          opportunityId: "opportunity-1",
          [field]: "must not be collected",
        }),
      ).toThrow();
    },
  );
});
