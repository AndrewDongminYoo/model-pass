import { FunctionsHttpError } from "@supabase/supabase-js";
import { afterEach, expect, it, vi } from "vitest";
import {
  AttendanceRequestError,
  getAttendance,
  recordAttendance,
  selectApplication,
} from "./attendance";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));

vi.mock("../../../lib/supabase/client", () => ({
  getSupabaseClient: () => ({ functions: { invoke: invokeMock } }),
}));

const applicationId = "00000000-0000-4000-8000-000000000011";
const opportunityId = "00000000-0000-4000-8000-000000000001";
const submissionAttemptId = "00000000-0000-4000-8000-000000000021";

afterEach(() => vi.clearAllMocks());

it("does not put an applicant capability in recruiter requests", async () => {
  // Production break: serializing an undefined or cached submissionAttemptId leaks applicant authority into recruiter tools.
  invokeMock.mockResolvedValue({
    data: {
      applicationId,
      viewerParty: "recruiter",
      selected: true,
      allowedActions: ["recruiter_confirmed"],
      events: [],
    },
    error: null,
  });

  await getAttendance({ applicationId, opportunityId });

  expect(invokeMock).toHaveBeenCalledWith("get-attendance", {
    body: { applicationId, opportunityId },
  });
});

it("persists recruiter selection through the authenticated selection function", async () => {
  // Production break: implementing selection as local UI state makes attendance available without a durable recruiter decision.
  invokeMock.mockResolvedValue({
    data: {
      applicationId,
      selectedAt: "2026-09-22T03:00:00.000Z",
    },
    error: null,
  });

  await expect(
    selectApplication({ applicationId, opportunityId }),
  ).resolves.toEqual({
    applicationId,
    selectedAt: "2026-09-22T03:00:00.000Z",
  });
  expect(invokeMock).toHaveBeenCalledWith("select-application", {
    body: { applicationId, opportunityId },
  });
});

it("sends the complete applicant capability and dispute event id", async () => {
  // Production break: dropping relatedEventId makes the applicant no-show dispute impossible to associate with its factual event.
  invokeMock.mockResolvedValue({
    data: {
      id: "00000000-0000-4000-8000-000000000102",
      applicationId,
      eventType: "dispute_opened",
      party: "applicant",
      relatedEventId: "00000000-0000-4000-8000-000000000101",
      occurredAt: "2026-09-22T03:00:00.000Z",
    },
    error: null,
  });

  await recordAttendance({
    applicationId,
    opportunityId,
    submissionAttemptId,
    eventType: "dispute_opened",
    party: "applicant",
    relatedEventId: "00000000-0000-4000-8000-000000000101",
  });

  expect(invokeMock).toHaveBeenCalledWith("record-attendance", {
    body: {
      applicationId,
      opportunityId,
      submissionAttemptId,
      eventType: "dispute_opened",
      party: "applicant",
      relatedEventId: "00000000-0000-4000-8000-000000000101",
    },
  });
});

it("accepts nullable relationship fields from the attendance RPC", async () => {
  // Production break: Postgres jsonb includes null relationship fields for ordinary events.
  invokeMock.mockResolvedValue({
    data: {
      id: "00000000-0000-4000-8000-000000000103",
      applicationId,
      eventType: "applicant_confirmed",
      party: "applicant",
      relatedEventId: null,
      resolution: null,
      occurredAt: "2026-09-22T03:00:00.000Z",
    },
    error: null,
  });

  await expect(
    recordAttendance({
      applicationId,
      opportunityId,
      submissionAttemptId,
      eventType: "applicant_confirmed",
      party: "applicant",
    }),
  ).resolves.toEqual({
    id: "00000000-0000-4000-8000-000000000103",
    eventType: "applicant_confirmed",
    party: "applicant",
    occurredAt: "2026-09-22T03:00:00.000Z",
  });
});

it("surfaces a bounded authoritative denial message", async () => {
  // Production break: collapsing a server timing denial into success or a generic transport failure removes actionable retry feedback.
  invokeMock.mockResolvedValue({
    data: null,
    error: new FunctionsHttpError(
      new Response(
        JSON.stringify({
          error:
            "Attendance outcomes are only available after the appointment starts.",
        }),
        { status: 409, headers: { "Content-Type": "application/json" } },
      ),
    ),
  });

  await expect(
    recordAttendance({
      applicationId,
      opportunityId,
      eventType: "completed",
      party: "recruiter",
    }),
  ).rejects.toEqual(
    new AttendanceRequestError(
      "Attendance outcomes are only available after the appointment starts.",
    ),
  );
});
