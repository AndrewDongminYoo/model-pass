import {
  createSendAttendanceRemindersHandler,
  sendAttendanceReminders,
  type ReminderClaim,
  type ReminderDependencies,
  type SendOutcome,
} from "./index.ts";
import {
  classifySendResponse,
  createTossMessageSender,
  reminderContext,
} from "./toss-message-sender.ts";

type TestFunction = () => void | Promise<void>;
type TestRegistrar = (name: string, testFunction: TestFunction) => void;

const registerTest: TestRegistrar =
  "Deno" in globalThis
    ? Deno.test
    : (globalThis as typeof globalThis & { it: TestRegistrar }).it;

const now = new Date("2026-10-10T03:00:00.000Z");
const invocationId = "00000000-0000-4000-8000-00000000a001";

function claimFor(applicationId: string): ReminderClaim {
  return {
    reminderId: `reminder-${applicationId}`,
    attemptCount: 1,
    anonKey: `anon-${applicationId}`,
    startsAt: "2026-10-11T05:00:00.000Z",
    venueDistrict: "Gangnam-gu",
  };
}

function createDependencies(
  outcomes: Record<string, SendOutcome | Error>,
  options: {
    configured?: boolean;
    candidates?: string[];
    unclaimable?: string[];
  } = {},
) {
  const calls: string[] = [];
  const dependencies: ReminderDependencies = {
    now: () => now,
    createInvocationId: () => invocationId,
    authorize: (token) => Promise.resolve(token === "operator-token"),
    isConfigured: options.configured ?? true,
    deleteStartedRecipients: () => {
      calls.push("deleteStarted");
      return Promise.resolve(2);
    },
    listCandidates: () => {
      calls.push("list");
      return Promise.resolve(options.candidates ?? Object.keys(outcomes));
    },
    claim: (applicationId) => {
      calls.push(`claim:${applicationId}`);
      return Promise.resolve(
        options.unclaimable?.includes(applicationId)
          ? null
          : claimFor(applicationId),
      );
    },
    send: (claim) => {
      const applicationId = claim.anonKey.replace("anon-", "");
      calls.push(`send:${applicationId}`);
      const outcome = outcomes[applicationId];
      if (outcome instanceof Error) return Promise.reject(outcome);
      return Promise.resolve(outcome ?? { kind: "sent" });
    },
    finish: (reminderId, result, failureCode) => {
      calls.push(`finish:${reminderId}:${result}:${failureCode ?? ""}`);
      return Promise.resolve(true);
    },
    release: (reminderId) => {
      calls.push(`release:${reminderId}`);
      return Promise.resolve(true);
    },
    reportError: () => undefined,
  };
  return { dependencies, calls };
}

registerTest("sends each claimed reminder and records it", async () => {
  const test = createDependencies({ a: { kind: "sent" }, b: { kind: "sent" } });

  const result = await sendAttendanceReminders(test.dependencies);

  assertEquals(result.status, "completed");
  assertEquals(result.sent, 2);
  assertEquals(result.deletedRecipients, 2);
  assertEquals(test.calls, [
    "deleteStarted",
    "list",
    "claim:a",
    "send:a",
    "finish:reminder-a:sent:",
    "claim:b",
    "send:b",
    "finish:reminder-b:sent:",
  ]);
});

registerTest("skips a candidate that can no longer be claimed", async () => {
  const test = createDependencies(
    { a: { kind: "sent" } },
    { candidates: ["a", "b"], unclaimable: ["b"] },
  );

  const result = await sendAttendanceReminders(test.dependencies);

  assertEquals(result.claimed, 1);
  assertEquals(
    test.calls.some((call) => call === "send:b"),
    false,
  );
});

registerTest("records an explicit failure and keeps going", async () => {
  const test = createDependencies({
    a: { kind: "failed", code: "INVALID_PARAMETER" },
    b: { kind: "sent" },
  });

  const result = await sendAttendanceReminders(test.dependencies);

  assertEquals(result.status, "completed");
  assertEquals(result.failed, 1);
  assertEquals(result.sent, 1);
  assertEquals(
    test.calls.includes("finish:reminder-a:failed:INVALID_PARAMETER"),
    true,
  );
});

registerTest(
  "stops on a configuration failure and releases the claim",
  async () => {
    const test = createDependencies({
      a: { kind: "configuration", code: "HTTP_403" },
      b: { kind: "sent" },
    });

    const result = await sendAttendanceReminders(test.dependencies);

    assertEquals(result.status, "stoppedOnConfigurationFailure");
    assertEquals(result.released, 1);
    assertEquals(test.calls.includes("release:reminder-a"), true);
    assertEquals(test.calls.includes("claim:b"), false);
  },
);

registerTest(
  "stops on an ambiguous outcome and keeps the claim unresolved",
  async () => {
    const test = createDependencies({
      a: { kind: "ambiguous", code: "NETWORK" },
      b: { kind: "sent" },
    });

    const result = await sendAttendanceReminders(test.dependencies);

    assertEquals(result.status, "stoppedOnAmbiguousOutcome");
    assertEquals(result.ambiguous, 1);
    assertEquals(
      test.calls.some((call) => call.startsWith("finish:reminder-a")),
      false,
    );
    assertEquals(test.calls.includes("release:reminder-a"), false);
    assertEquals(test.calls.includes("claim:b"), false);
  },
);

registerTest("treats a thrown sender error as ambiguous", async () => {
  const test = createDependencies({ a: new Error("socket closed") });

  const result = await sendAttendanceReminders(test.dependencies);

  assertEquals(result.status, "stoppedOnAmbiguousOutcome");
  assertEquals(result.ambiguous, 1);
});

registerTest(
  "only cleans up recipient keys when sending is not configured",
  async () => {
    const test = createDependencies(
      { a: { kind: "sent" } },
      {
        configured: false,
      },
    );

    const result = await sendAttendanceReminders(test.dependencies);

    assertEquals(result.status, "notConfigured");
    assertEquals(result.deletedRecipients, 2);
    assertEquals(test.calls, ["deleteStarted"]);
  },
);

registerTest("requires the operator token", async () => {
  const test = createDependencies({ a: { kind: "sent" } });
  const handler = createSendAttendanceRemindersHandler(test.dependencies);

  const response = await handler(
    new Request("http://localhost/functions/v1/send-attendance-reminders", {
      method: "POST",
      headers: { Authorization: "Bearer wrong-token" },
      body: "{}",
    }),
  );

  assertEquals(response.status, 401);
  assertEquals(test.calls, []);
});

registerTest("returns the run summary to the operator", async () => {
  const test = createDependencies({ a: { kind: "sent" } });
  const handler = createSendAttendanceRemindersHandler(test.dependencies);

  const response = await handler(
    new Request("http://localhost/functions/v1/send-attendance-reminders", {
      method: "POST",
      headers: { Authorization: "Bearer operator-token" },
      body: "{}",
    }),
  );

  assertEquals(response.status, 200);
  assertEquals(await response.json(), {
    invocationId,
    status: "completed",
    deletedRecipients: 2,
    candidates: 1,
    claimed: 1,
    sent: 1,
    failed: 0,
    released: 0,
    ambiguous: 0,
  });
});

registerTest("rejects a non-empty request body", async () => {
  const test = createDependencies({ a: { kind: "sent" } });
  const handler = createSendAttendanceRemindersHandler(test.dependencies);

  const response = await handler(
    new Request("http://localhost/functions/v1/send-attendance-reminders", {
      method: "POST",
      headers: { Authorization: "Bearer operator-token" },
      body: JSON.stringify({ dryRun: true }),
    }),
  );

  assertEquals(response.status, 400);
  assertEquals(test.calls, []);
});

const delivered = JSON.stringify({
  resultType: "SUCCESS",
  success: {
    msgCount: 1,
    sentPushCount: 1,
    sentInboxCount: 0,
    sentSmsCount: 0,
    sentAlimtalkCount: 0,
    sentFriendtalkCount: 0,
  },
});

registerTest("classifies a delivered success as sent", () => {
  assertEquals(classifySendResponse(200, delivered), { kind: "sent" });
});

registerTest("classifies a success with zero delivery as failed", () => {
  const body = JSON.stringify({
    resultType: "SUCCESS",
    success: {
      msgCount: 1,
      sentPushCount: 0,
      sentInboxCount: 0,
      sentSmsCount: 0,
      sentAlimtalkCount: 0,
      sentFriendtalkCount: 0,
    },
  });
  assertEquals(classifySendResponse(200, body), {
    kind: "failed",
    code: "NOT_DELIVERED",
  });
});

registerTest("classifies an HTTP 200 FAIL as failed with its code", () => {
  const body = JSON.stringify({
    resultType: "FAIL",
    error: { errorCode: "INVALID_PARAMETER", reason: "요청에 실패했습니다." },
  });
  assertEquals(classifySendResponse(200, body), {
    kind: "failed",
    code: "INVALID_PARAMETER",
  });
});

registerTest("classifies 401 and 403 as configuration failures", () => {
  assertEquals(classifySendResponse(401, "{}"), {
    kind: "configuration",
    code: "HTTP_401",
  });
  assertEquals(classifySendResponse(403, "{}"), {
    kind: "configuration",
    code: "HTTP_403",
  });
});

registerTest("classifies 400 as an explicit failure", () => {
  assertEquals(classifySendResponse(400, "not json"), {
    kind: "failed",
    code: "HTTP_400",
  });
});

registerTest("classifies 5xx and unrecognized 2xx bodies as ambiguous", () => {
  assertEquals(classifySendResponse(503, delivered), {
    kind: "ambiguous",
    code: "HTTP_503",
  });
  assertEquals(classifySendResponse(200, "<html>"), {
    kind: "ambiguous",
    code: "UNRECOGNIZED_RESPONSE",
  });
  assertEquals(classifySendResponse(200, JSON.stringify({ resultType: "?" })), {
    kind: "ambiguous",
    code: "UNRECOGNIZED_RESPONSE",
  });
});

registerTest("puts only the time and district in the template context", () => {
  const context = reminderContext(claimFor("a"));

  assertEquals(Object.keys(context).length, 2);
  assertEquals(Object.values(context).includes("Gangnam-gu"), true);
  assertEquals(JSON.stringify(context).includes("anon-a"), false);
});

registerTest(
  "posts the send-message request with the recipient header",
  async () => {
    const requests: { url: string; init: RequestInit }[] = [];
    const send = createTossMessageSender({
      templateSetCode: "model-pass-reminder",
      fetchImpl: (url, init) => {
        requests.push({ url, init });
        return Promise.resolve(new Response(delivered, { status: 200 }));
      },
    });

    const outcome = await send(claimFor("a"));

    assertEquals(outcome, { kind: "sent" });
    assertEquals(
      requests[0]?.url,
      "https://apps-in-toss-api.toss.im/api-partner/v1/apps-in-toss/messenger/send-message",
    );
    assertEquals(
      new Headers(requests[0]?.init.headers).get("x-anon-key"),
      "anon-a",
    );
    assertEquals(
      JSON.parse(String(requests[0]?.init.body)).templateSetCode,
      "model-pass-reminder",
    );
  },
);

registerTest("classifies a network error as ambiguous", async () => {
  const send = createTossMessageSender({
    templateSetCode: "model-pass-reminder",
    fetchImpl: () => Promise.reject(new TypeError("connection reset")),
  });

  assertEquals(await send(claimFor("a")), {
    kind: "ambiguous",
    code: "NETWORK",
  });
});

function assertEquals(actual: unknown, expected: unknown): void {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  if (actualJson !== expectedJson) {
    throw new Error(`Expected ${expectedJson}, received ${actualJson}.`);
  }
}
