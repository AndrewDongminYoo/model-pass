import {
  type AttendanceActor,
  createRecordAttendanceHandler,
  createSupabaseDependencies,
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
  "allows an authenticated recruiter owner to record without an applicant capability",
  async () => {
    // Production break: requiring submissionAttemptId exposes the applicant's bearer capability to the recruiter.
    const recorded: unknown[] = [];
    const response = await createRecordAttendanceHandler(
      dependencies({ party: "recruiter", userId: "recruiter-1" }, recorded),
    )(
      request(
        {
          applicationId,
          opportunityId,
          eventType: "recruiter_confirmed",
          party: "recruiter",
        },
        "recruiter-token",
      ),
    );

    assertEquals(response.status, 201);
    assertEquals(recorded.length, 1);
    assertEquals(
      "submissionAttemptId" in (recorded[0] as Record<string, unknown>),
      false,
    );
  },
);

registerTest(
  "rejects every participant attendance write before recruiter selection",
  async () => {
    // Production break: checking only application access lets either party create attendance facts before recruiter selection.
    for (const testCase of [
      {
        actor: { party: "recruiter", userId: "recruiter-1" } as const,
        token: "recruiter-token",
        body: {
          applicationId,
          opportunityId,
          eventType: "recruiter_confirmed",
          party: "recruiter",
        },
      },
      {
        actor: { party: "applicant" } as const,
        token: undefined,
        body: {
          applicationId,
          opportunityId,
          submissionAttemptId,
          eventType: "applicant_confirmed",
          party: "applicant",
        },
      },
    ]) {
      const recorded: unknown[] = [];
      const value = dependencies(testCase.actor, recorded);
      value.resolveAccess = () =>
        Promise.resolve({
          actor: testCase.actor,
          startsAt: "2099-09-22T03:00:00.000Z",
          selected: false,
        });

      const response = await createRecordAttendanceHandler(value)(
        request(testCase.body, testCase.token),
      );

      assertEquals(response.status, 409);
      assertEquals(await response.json(), {
        error: "Attendance is unavailable until recruiter selection.",
      });
      assertEquals(recorded.length, 0);
    }
  },
);

registerTest(
  "rejects confirmation at or after the appointment start",
  async () => {
    // Production break: a post-appointment confirmation can rewrite a final attendance outcome.
    const recorded: unknown[] = [];
    const response = await createRecordAttendanceHandler(
      dependencies(
        { party: "applicant" },
        recorded,
        "2026-09-22T03:00:00.000Z",
        "2026-09-22T03:00:00.000Z",
      ),
    )(
      request({
        applicationId,
        opportunityId,
        submissionAttemptId,
        eventType: "applicant_confirmed",
        party: "applicant",
      }),
    );

    assertEquals(response.status, 409);
    assertEquals(recorded.length, 0);
  },
);

registerTest(
  "rejects a final factual outcome before the appointment start",
  async () => {
    // Production break: recording completion before the appointment manufactures a future fact.
    const recorded: unknown[] = [];
    const response = await createRecordAttendanceHandler(
      dependencies(
        { party: "recruiter", userId: "recruiter-1" },
        recorded,
        "2026-09-22T03:00:00.000Z",
        "2026-09-22T02:59:59.000Z",
      ),
    )(
      request(
        {
          applicationId,
          opportunityId,
          eventType: "completed",
          party: "recruiter",
        },
        "recruiter-token",
      ),
    );

    assertEquals(response.status, 409);
    assertEquals(recorded.length, 0);
  },
);

registerTest(
  "allows an applicant to record its own cancellation before the appointment start",
  async () => {
    // Production break: treating cancellation as a post-start-only factual outcome prevents an applicant from recording a timely cancellation.
    const recorded: unknown[] = [];
    const response = await createRecordAttendanceHandler(
      dependencies({ party: "applicant" }, recorded),
    )(
      request({
        applicationId,
        opportunityId,
        submissionAttemptId,
        eventType: "applicant_cancelled",
        party: "applicant",
      }),
    );

    assertEquals(response.status, 201);
    assertEquals(recorded.length, 1);
  },
);

registerTest(
  "allows a recruiter to record its own cancellation before the appointment start",
  async () => {
    // Production break: treating cancellation as a post-start-only factual outcome prevents a recruiter from recording a timely cancellation.
    const recorded: unknown[] = [];
    const response = await createRecordAttendanceHandler(
      dependencies({ party: "recruiter", userId: "recruiter-1" }, recorded),
    )(
      request(
        {
          applicationId,
          opportunityId,
          eventType: "recruiter_cancelled",
          party: "recruiter",
        },
        "recruiter-token",
      ),
    );

    assertEquals(response.status, 201);
    assertEquals(recorded.length, 1);
  },
);

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
  "treats the exact platform anon bearer as an applicant capability request",
  async () => {
    // Production break: forwarding the public anon bearer to user authentication blocks every applicant write.
    const recorded: unknown[] = [];
    let resolvedAccessToken: string | undefined = "not-called";
    const value = dependencies({ party: "applicant" }, recorded);
    value.resolveAccess = (capability, accessToken) => {
      resolvedAccessToken = accessToken;
      return Promise.resolve(
        capability.submissionAttemptId === submissionAttemptId
          ? {
              actor: { party: "applicant" },
              startsAt: "2099-09-22T03:00:00.000Z",
              selected: true,
            }
          : null,
      );
    };
    const response = await createRecordAttendanceHandler(
      value,
      "anon-token",
    )(
      request(
        {
          applicationId,
          opportunityId,
          submissionAttemptId,
          eventType: "applicant_confirmed",
          party: "applicant",
        },
        "anon-token",
      ),
    );

    assertEquals(response.status, 201);
    assertEquals(resolvedAccessToken, undefined);
    assertEquals(recorded.length, 1);
  },
);

registerTest(
  "rejects an applicant actor when the submission capability is absent",
  async () => {
    // Production break: relying only on the dependency lookup lets a future resolver accidentally authorize an identifier-only applicant write.
    const recorded: unknown[] = [];
    const response = await createRecordAttendanceHandler(
      dependencies({ party: "applicant" }, recorded),
    )(
      request({
        applicationId,
        opportunityId,
        eventType: "applicant_confirmed",
        party: "applicant",
      }),
    );

    assertEquals(response.status, 403);
    assertEquals(recorded.length, 0);
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
    now: () => new Date("2026-09-22T03:00:00.000Z"),
    resolveAccess: () => {
      resolved = true;
      return Promise.resolve({
        actor: { party: "applicant" },
        startsAt: "2099-09-22T03:00:00.000Z",
        selected: true,
      });
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
      now: () => new Date("2026-09-22T03:00:00.000Z"),
      resolveAccess: () => {
        resolved = true;
        return Promise.resolve({
          actor: { party: "applicant" },
          startsAt: "2099-09-22T03:00:00.000Z",
          selected: true,
        });
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

    const access = await dependencies.resolveAccess(
      { applicationId, opportunityId, submissionAttemptId },
      "valid-other-user-token",
    );

    assertEquals(access, null);
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

    const access = await dependencies.resolveAccess(
      { applicationId, opportunityId, submissionAttemptId },
      "invalid-token",
    );

    assertEquals(access, null);
  },
);

registerTest(
  "requires the exact applicant submission attempt in the database lookup",
  async () => {
    // Production break: dropping the submission_attempt_id filter turns the receipt capability into a guessable application ID.
    const filters: Array<[string, unknown]> = [];
    const query = {
      select: () => query,
      eq: (column: string, value: unknown) => {
        filters.push([column, value]);
        return query;
      },
      maybeSingle: () =>
        Promise.resolve({
          data: filters.some(
            ([column, value]) =>
              column === "submission_attempt_id" &&
              value === submissionAttemptId,
          )
            ? { id: applicationId }
            : null,
          error: null,
        }),
    };
    const dependencies = createSupabaseDependencies(
      {
        auth: { getUser: () => Promise.reject(new Error("not expected")) },
        from: () => query,
        rpc: () => Promise.resolve({ data: null, error: null }),
      } as never,
      "service-key",
    );

    const access = await dependencies.resolveAccess(
      {
        applicationId,
        opportunityId,
        submissionAttemptId: "00000000-0000-4000-8000-000000000099",
      },
      undefined,
    );

    assertEquals(access, null);
    assertEquals(filters[3], [
      "submission_attempt_id",
      "00000000-0000-4000-8000-000000000099",
    ]);
  },
);

registerTest(
  "passes the applicant capability into the atomic attendance RPC",
  async () => {
    // Production break: validating only before the RPC allows a stale capability to race deletion fulfillment.
    let rpcName: string | undefined;
    let rpcArguments: Record<string, unknown> | undefined;
    const dependencies = createSupabaseDependencies(
      {
        auth: { getUser: () => Promise.reject(new Error("not expected")) },
        from: () => {
          throw new Error("not expected");
        },
        rpc: (name: string, args: Record<string, unknown>) => {
          rpcName = name;
          rpcArguments = args;
          return Promise.resolve({ data: {}, error: null });
        },
      } as never,
      "service-key",
    );

    await dependencies.recordEvent({
      applicationId,
      opportunityId,
      submissionAttemptId,
      actor: { party: "applicant" },
      eventType: "applicant_confirmed",
      party: "applicant",
    });

    assertEquals(rpcName, "record_attendance_event_authorized");
    assertEquals(rpcArguments?.p_submission_attempt_id, submissionAttemptId);
  },
);

function dependencies(
  actor: AttendanceActor,
  recorded: unknown[],
  startsAt = "2099-09-22T03:00:00.000Z",
  now = "2026-09-22T03:00:00.000Z",
) {
  const value: RecordAttendanceDependencies = {
    now: () => new Date(now),
    resolveAccess: () => Promise.resolve({ actor, startsAt, selected: true }),
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

function request(body: Record<string, unknown>, accessToken?: string) {
  return new Request("http://localhost/functions/v1/record-attendance", {
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
      `Expected ${JSON.stringify(expected)}, received ${JSON.stringify(
        actual,
      )}`,
    );
  }
}
