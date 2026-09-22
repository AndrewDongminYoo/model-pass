import {
  createSupabaseDependencies,
  createRecordAttendanceHandler,
  type AttendanceActor,
  type RecordAttendanceDependencies,
} from "./index.ts";

type TestFunction = () => void | Promise<void>;
type TestRegistrar = (name: string, testFunction: TestFunction) => void;
const registerTest: TestRegistrar =
  "Deno" in globalThis
    ? Deno.test
    : (globalThis as typeof globalThis & { it: TestRegistrar }).it;

const applicationId = "00000000-0000-4000-8000-000000000011";
const opportunityId = "00000000-0000-4000-8000-000000000001";
const submissionAttemptId = "00000000-0000-4000-8000-000000000021";

registerTest(
  "allows an applicant capability to record its own confirmation",
  async () => {
    // Production break: requiring a recruiter JWT for applicant facts prevents symmetric attendance history.
    const recorded: unknown[] = [];
    const response = await createRecordAttendanceHandler(
      dependencies({ party: "applicant" }, recorded),
    )(
      request({
        applicationId,
        opportunityId,
        submissionAttemptId,
        eventType: "applicant_confirmed",
        party: "applicant",
      }),
    );

    assertEquals(response.status, 201);
    assertEquals(recorded.length, 1);
    assertEquals(
      "occurredAt" in (recorded[0] as Record<string, unknown>),
      false,
    );
  },
);

registerTest(
  "rejects a recruiter recording the applicant's own cancellation",
  async () => {
    // Production break: checking ownership without checking actor-to-event permissions lets recruiters rewrite applicant facts.
    const recorded: unknown[] = [];
    const response = await createRecordAttendanceHandler(
      dependencies({ party: "recruiter", userId: "recruiter-1" }, recorded),
    )(
      request({
        applicationId,
        opportunityId,
        submissionAttemptId,
        eventType: "applicant_cancelled",
        party: "applicant",
      }),
    );

    assertEquals(response.status, 403);
    assertEquals(recorded.length, 0);
  },
);

registerTest("allows only an operator to resolve a dispute", async () => {
  // Production break: either participant resolving its own dispute bypasses the required operator decision.
  const participantResponse = await createRecordAttendanceHandler(
    dependencies({ party: "applicant" }, []),
  )(
    request({
      applicationId,
      opportunityId,
      submissionAttemptId,
      eventType: "dispute_resolved",
      party: "applicant",
      relatedEventId: "00000000-0000-4000-8000-000000000099",
      resolution: "confirmed",
    }),
  );
  const recorded: unknown[] = [];
  const operatorResponse = await createRecordAttendanceHandler(
    dependencies({ party: "operator", userId: "operator-1" }, recorded),
  )(
    request({
      applicationId,
      opportunityId,
      submissionAttemptId,
      eventType: "dispute_resolved",
      party: "applicant",
      relatedEventId: "00000000-0000-4000-8000-000000000099",
      resolution: "rejected",
    }),
  );

  assertEquals(participantResponse.status, 403);
  assertEquals(operatorResponse.status, 201);
  assertEquals(recorded.length, 1);
});

registerTest(
  "requires a participant to open a dispute for its own party",
  async () => {
    // Production break: a recruiter opening a dispute as the applicant can suppress the recruiter's own no-show from applicant history.
    const recorded: unknown[] = [];
    const response = await createRecordAttendanceHandler(
      dependencies({ party: "recruiter", userId: "recruiter-1" }, recorded),
    )(
      request({
        applicationId,
        opportunityId,
        submissionAttemptId,
        eventType: "dispute_opened",
        party: "applicant",
        relatedEventId: "00000000-0000-4000-8000-000000000099",
      }),
    );

    assertEquals(response.status, 403);
    assertEquals(recorded.length, 0);
  },
);

registerTest("rejects arbitrary attendance details", async () => {
  // Production break: accepting unbounded free text creates an unnecessary sensitive-data channel.
  const recorded: unknown[] = [];
  const response = await createRecordAttendanceHandler(
    dependencies({ party: "applicant" }, recorded),
  )(
    request({
      applicationId,
      opportunityId,
      submissionAttemptId,
      eventType: "applicant_confirmed",
      party: "applicant",
      details: "private note",
    }),
  );

  assertEquals(response.status, 400);
  assertEquals(recorded.length, 0);
});

registerTest("rejects a participant-controlled occurredAt", async () => {
  // Production break: accepting a public timestamp lets a participant create arbitrary historical or future facts.
  const recorded: unknown[] = [];
  const response = await createRecordAttendanceHandler(
    dependencies({ party: "applicant" }, recorded),
  )(
    request({
      applicationId,
      opportunityId,
      submissionAttemptId,
      eventType: "applicant_confirmed",
      party: "applicant",
      occurredAt: "1999-01-01T00:00:00.000Z",
    }),
  );

  assertEquals(response.status, 400);
  assertEquals(recorded.length, 0);
});

registerTest("stops a chunked oversized body at the byte limit", async () => {
  // Production break: calling request.text() consumes an unbounded no-header stream before checking its size.
  let resolved = false;
  const dependenciesValue: RecordAttendanceDependencies = {
    resolveActor: () => {
      resolved = true;
      return Promise.resolve({ party: "applicant" });
    },
    recordEvent: () => Promise.resolve({}),
  };

  const chunked = oversizedChunkedRequest(
    "http://localhost/functions/v1/record-attendance",
  );
  const response = await createRecordAttendanceHandler(dependenciesValue)(
    chunked.request,
  );

  assertEquals(response.status, 413);
  assertEquals(resolved, false);
  assertEquals(chunked.getPulls() < 100, true);
});

registerTest(
  "rejects a non-canonical Content-Length before reading",
  async () => {
    // Production break: accepting ambiguous numeric syntax makes the early size gate disagree with the stream byte counter.
    let resolved = false;
    const response = await createRecordAttendanceHandler({
      resolveActor: () => {
        resolved = true;
        return Promise.resolve({ party: "applicant" });
      },
      recordEvent: () => Promise.resolve({}),
    })(
      new Request("http://localhost/functions/v1/record-attendance", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": "0002",
        },
        body: "{}",
      }),
    );

    assertEquals(response.status, 400);
    assertEquals(resolved, false);
  },
);

registerTest(
  "does not downgrade an authenticated non-owner to an applicant capability",
  async () => {
    // Production break: falling back after a valid non-owner JWT lets another recruiter act as the applicant.
    const makeQuery = (data: { id: string } | null) => {
      const query = {
        select: () => query,
        eq: () => query,
        maybeSingle: () => Promise.resolve({ data, error: null }),
      };
      return query;
    };
    const client = {
      auth: {
        getUser: () =>
          Promise.resolve({
            data: { user: { id: "other-recruiter", app_metadata: {} } },
            error: null,
          }),
      },
      from: (table: string) =>
        makeQuery(table === "applications" ? { id: applicationId } : null),
      rpc: () => Promise.resolve({ data: null, error: null }),
    };
    const dependencies = createSupabaseDependencies(
      client as never,
      "service-key",
    );

    const actor = await dependencies.resolveActor(
      { applicationId, opportunityId, submissionAttemptId },
      "valid-other-user-token",
    );

    assertEquals(actor, null);
  },
);

registerTest(
  "denies an invalid supplied bearer instead of using applicant capability",
  async () => {
    // Production break: treating a supplied invalid token like no Authorization header grants applicant capability access.
    const makeQuery = (data: { id: string } | null) => {
      const query = {
        select: () => query,
        eq: () => query,
        maybeSingle: () => Promise.resolve({ data, error: null }),
      };
      return query;
    };
    const client = {
      auth: {
        getUser: () =>
          Promise.resolve({
            data: { user: null },
            error: new Error("invalid bearer"),
          }),
      },
      from: () => makeQuery({ id: applicationId }),
      rpc: () => Promise.resolve({ data: null, error: null }),
    };
    const dependencies = createSupabaseDependencies(
      client as never,
      "service-key",
    );

    const actor = await dependencies.resolveActor(
      { applicationId, opportunityId, submissionAttemptId },
      "invalid-token",
    );

    assertEquals(actor, null);
  },
);

function dependencies(actor: AttendanceActor, recorded: unknown[]) {
  const value: RecordAttendanceDependencies = {
    resolveActor: () => Promise.resolve(actor),
    recordEvent: (command) => {
      recorded.push(command);
      return Promise.resolve({
        id: "00000000-0000-4000-8000-000000000101",
        ...command,
        occurredAt: "2026-09-22T03:00:00.000Z",
      });
    },
  };
  return value;
}

function request(body: Record<string, unknown>) {
  return new Request("http://localhost/functions/v1/record-attendance", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function oversizedChunkedRequest(url: string) {
  let pulls = 0;
  const request = new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1;
        if (pulls > 1000) return controller.close();
        controller.enqueue(new Uint8Array(512));
      },
    }),
    duplex: "half",
  } as RequestInit & { duplex: "half" });
  return { request, getPulls: () => pulls };
}

function assertEquals(actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `Expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`,
    );
  }
}
