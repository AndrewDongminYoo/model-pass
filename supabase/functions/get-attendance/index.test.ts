import {
  createGetAttendanceHandler,
  type GetAttendanceDependencies,
} from "./index.ts";
import type { AttendanceEvent } from "../../../src/features/attendance/domain/attendance.ts";

type TestFunction = () => void | Promise<void>;
type TestRegistrar = (name: string, testFunction: TestFunction) => void;
const registerTest: TestRegistrar =
  "Deno" in globalThis
    ? Deno.test
    : (globalThis as typeof globalThis & { it: TestRegistrar }).it;

const applicationId = "00000000-0000-4000-8000-000000000011";
const opportunityId = "00000000-0000-4000-8000-000000000001";
const submissionAttemptId = "00000000-0000-4000-8000-000000000021";
const noShowId = "00000000-0000-4000-8000-000000000101";
const disputeId = "00000000-0000-4000-8000-000000000102";

registerTest(
  "returns recruiter attendance without requiring or exposing the applicant capability",
  async () => {
    // Production break: coupling recruiter history to submissionAttemptId either blocks the owner or discloses applicant authority.
    const response = await createGetAttendanceHandler(
      dependencies("recruiter", [], "2099-09-22T03:00:00.000Z"),
    )(request({ applicationId, opportunityId }, "recruiter-token"));
    const body = await response.json();

    assertEquals(response.status, 200);
    assertEquals(body.viewerParty, "recruiter");
    assertEquals(body.allowedActions, [
      "recruiter_confirmed",
      "recruiter_cancelled",
    ]);
    assertEquals(JSON.stringify(body).includes("submissionAttempt"), false);
  },
);

registerTest(
  "returns a capability-free waiting state before recruiter selection",
  async () => {
    // Production break: exposing actions or history before selection lets attendance begin for an unselected application.
    let eventsLoaded = false;
    const value = dependencies("applicant", []);
    value.resolveAccess = () =>
      Promise.resolve({
        actor: { party: "applicant" },
        startsAt: "2099-09-22T03:00:00.000Z",
        selected: false,
      });
    value.loadEvents = () => {
      eventsLoaded = true;
      return Promise.resolve([
        event(noShowId, "applicant_no_show", "applicant"),
      ]);
    };

    const response = await createGetAttendanceHandler(value)(
      request({ applicationId, opportunityId, submissionAttemptId }),
    );
    const body = await response.json();

    assertEquals(response.status, 200);
    assertEquals(body, {
      applicationId,
      viewerParty: "applicant",
      selected: false,
      allowedActions: [],
      events: [],
    });
    assertEquals(eventsLoaded, false);
    assertEquals(JSON.stringify(body).includes("submissionAttempt"), false);
  },
);

registerTest(
  "offers confirmation and each participant's own cancellation before the appointment",
  async () => {
    // Production break: pre-start cancellation must remain available to the participant who can factually report it.
    const recruiterResponse = await createGetAttendanceHandler(
      dependencies("recruiter", []),
    )(request({ applicationId, opportunityId }, "recruiter-token"));
    const applicantResponse = await createGetAttendanceHandler(
      dependencies("applicant", []),
    )(request({ applicationId, opportunityId, submissionAttemptId }));

    assertEquals((await recruiterResponse.json()).allowedActions, [
      "recruiter_confirmed",
      "recruiter_cancelled",
    ]);
    assertEquals((await applicantResponse.json()).allowedActions, [
      "applicant_confirmed",
      "applicant_cancelled",
    ]);
  },
);

registerTest("rejects an applicant with the wrong capability", async () => {
  // Production break: checking only applicationId and opportunityId lets any receipt holder read another applicant's history.
  const value = dependencies("applicant", []);
  value.resolveAccess = (capability, accessToken) =>
    Promise.resolve(
      accessToken === undefined &&
        capability.submissionAttemptId === submissionAttemptId
        ? {
            actor: { party: "applicant" },
            startsAt: "2099-09-22T03:00:00.000Z",
            selected: true,
          }
        : null,
    );
  const response = await createGetAttendanceHandler(value)(
    request({
      applicationId,
      opportunityId,
      submissionAttemptId: "00000000-0000-4000-8000-000000000099",
    }),
  );

  assertEquals(response.status, 403);
});

registerTest(
  "treats the exact platform anon bearer as an applicant capability request",
  async () => {
    // Production break: Supabase Functions adds the public anon bearer even when no user is signed in.
    let resolvedAccessToken: string | undefined = "not-called";
    const value = dependencies("applicant", []);
    value.resolveAccess = (_capability, accessToken) => {
      resolvedAccessToken = accessToken;
      return Promise.resolve({
        actor: { party: "applicant" },
        startsAt: "2099-09-22T03:00:00.000Z",
        selected: true,
      });
    };
    const response = await createGetAttendanceHandler(
      value,
      "anon-token",
    )(
      request(
        { applicationId, opportunityId, submissionAttemptId },
        "anon-token",
      ),
    );

    assertEquals(response.status, 200);
    assertEquals(resolvedAccessToken, undefined);
  },
);

registerTest(
  "returns viewer-scoped history and the no-show event id needed for a dispute",
  async () => {
    // Production break: publishing an unresolved disputed no-show to the counterparty, or stripping its id from the affected party, breaks the dispute contract.
    const events: AttendanceEvent[] = [
      event(noShowId, "applicant_no_show", "applicant"),
      {
        ...event(disputeId, "dispute_opened", "applicant"),
        relatedEventId: noShowId,
      },
    ];
    const recruiterResponse = await createGetAttendanceHandler(
      dependencies("recruiter", events),
    )(request({ applicationId, opportunityId }, "recruiter-token"));
    const applicantResponse = await createGetAttendanceHandler(
      dependencies("applicant", events),
    )(request({ applicationId, opportunityId, submissionAttemptId }));

    assertEquals((await recruiterResponse.json()).events, []);
    assertEquals((await applicantResponse.json()).events, events);
  },
);

registerTest(
  "offers only role-permitted final actions after the appointment",
  async () => {
    // Production break: returning confirmation or operator resolution after starts_at exposes forbidden participant actions.
    const applicantResponse = await createGetAttendanceHandler(
      dependencies(
        "applicant",
        [event(noShowId, "recruiter_no_show", "recruiter")],
        "2026-09-22T03:00:00.000Z",
        "2026-09-22T03:00:00.000Z",
      ),
    )(request({ applicationId, opportunityId, submissionAttemptId }));
    const body = await applicantResponse.json();

    assertEquals(body.allowedActions, ["completed", "recruiter_no_show"]);
    assertEquals(body.events[0].id, noShowId);
    assertEquals(body.events[0].eventType, "recruiter_no_show");
  },
);

registerTest(
  "uses the applicant capability even when a recruiter session bearer is present",
  async () => {
    // Production break: a shared Supabase client sends the recruiter JWT and hides applicant attendance in the same browser.
    let resolvedAccessToken: string | undefined;
    const value = dependencies("applicant", []);
    value.resolveAccess = (_capability, accessToken) => {
      resolvedAccessToken = accessToken;
      return Promise.resolve({
        actor: { party: "applicant" },
        startsAt: "2099-09-22T03:00:00.000Z",
        selected: true,
      });
    };
    const response = await createGetAttendanceHandler(
      value,
      "legacy-anon-key",
    )(
      request(
        { applicationId, opportunityId, submissionAttemptId },
        "recruiter-session-jwt",
      ),
    );

    assertEquals(response.status, 200);
    assertEquals(resolvedAccessToken, undefined);
  },
);

function dependencies(
  party: "recruiter" | "applicant",
  events: AttendanceEvent[],
  startsAt = "2099-09-22T03:00:00.000Z",
  now = "2026-09-22T03:00:00.000Z",
): GetAttendanceDependencies {
  return {
    now: () => new Date(now),
    resolveAccess: () =>
      Promise.resolve({
        actor:
          party === "recruiter" ? { party, userId: "recruiter-1" } : { party },
        startsAt,
        selected: true,
      }),
    loadEvents: () => Promise.resolve(events),
  };
}

function event(
  id: string,
  eventType: AttendanceEvent["eventType"],
  party: AttendanceEvent["party"],
): AttendanceEvent {
  return {
    id,
    eventType,
    party,
    occurredAt: "2026-09-22T03:00:00.000Z",
  };
}

function request(body: Record<string, unknown>, accessToken?: string) {
  return new Request("http://localhost/functions/v1/get-attendance", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(accessToken === undefined
        ? {}
        : { Authorization: `Bearer ${accessToken}` }),
    },
    body: JSON.stringify(body),
  });
}

function assertEquals(actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `Expected ${JSON.stringify(expected)}, received ${JSON.stringify(
        actual,
      )}`,
    );
  }
}
