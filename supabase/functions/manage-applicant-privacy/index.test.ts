import {
  createManageApplicantPrivacyHandler,
  type ApplicantPrivacyDependencies,
  type ApplicantPrivacyResult,
} from "./index.ts";

type TestFunction = () => void | Promise<void>;
type TestRegistrar = (name: string, testFunction: TestFunction) => void;
const registerTest: TestRegistrar =
  "Deno" in globalThis
    ? Deno.test
    : (globalThis as typeof globalThis & { it: TestRegistrar }).it;

const capability = {
  applicationId: "00000000-0000-4000-8000-000000000011",
  opportunityId: "00000000-0000-4000-8000-000000000001",
  submissionAttemptId: "00000000-0000-4000-8000-000000000021",
};

registerTest("accepts a future-opportunity consent revocation", async () => {
  const commands: unknown[] = [];
  const response = await createManageApplicantPrivacyHandler(
    dependencies(commands),
  )(
    request({
      ...capability,
      action: "revoke_future_opportunity_consent",
    }),
  );

  assertEquals(response.status, 202);
  assertEquals(await response.json(), {
    action: "revoke_future_opportunity_consent",
    status: "accepted",
  });
  assertEquals(commands, [
    { ...capability, action: "revoke_future_opportunity_consent" },
  ]);
});

registerTest("accepts a deletion request as pending", async () => {
  const commands: unknown[] = [];
  const response = await createManageApplicantPrivacyHandler(
    dependencies(commands),
  )(
    request({
      ...capability,
      action: "request_deletion",
    }),
  );

  assertEquals(response.status, 202);
  assertEquals(await response.json(), {
    action: "request_deletion",
    status: "pending",
  });
  assertEquals(commands, [{ ...capability, action: "request_deletion" }]);
});

registerTest(
  "returns the same result for an identical repeated request",
  async () => {
    const stored = new Map<string, ApplicantPrivacyResult>();
    let inserted = 0;
    const handler = createManageApplicantPrivacyHandler({
      applyAction(command) {
        const key = `${command.applicationId}:${command.action}`;
        const existing = stored.get(key);
        if (existing !== undefined) return Promise.resolve(existing);
        inserted += 1;
        const result: ApplicantPrivacyResult = {
          action: "request_deletion",
          status: "pending",
        };
        stored.set(key, result);
        return Promise.resolve(result);
      },
    });
    const body = { ...capability, action: "request_deletion" };

    const first = await handler(request(body));
    const second = await handler(request(body));

    assertEquals(first.status, 202);
    assertEquals(second.status, 202);
    assertEquals(await first.json(), await second.json());
    assertEquals(inserted, 1);
  },
);

registerTest("rejects a malformed capability before persistence", async () => {
  const commands: unknown[] = [];
  const response = await createManageApplicantPrivacyHandler(
    dependencies(commands),
  )(
    request({
      applicationId: capability.applicationId,
      opportunityId: capability.opportunityId,
      submissionAttemptId: "not-a-uuid",
      action: "request_deletion",
    }),
  );

  assertEquals(response.status, 400);
  assertEquals(commands.length, 0);
});

registerTest("rejects an unsupported privacy action", async () => {
  const commands: unknown[] = [];
  const response = await createManageApplicantPrivacyHandler(
    dependencies(commands),
  )(
    request({
      ...capability,
      action: "delete_immediately",
    }),
  );

  assertEquals(response.status, 400);
  assertEquals(commands.length, 0);
});

registerTest("rejects a wrong application capability", async () => {
  const response = await createManageApplicantPrivacyHandler({
    applyAction: () => Promise.resolve(null),
  })(request({ ...capability, action: "request_deletion" }));

  assertEquals(response.status, 403);
  assertEquals(await response.json(), { error: "Privacy access denied." });
});

function dependencies(commands: unknown[]): ApplicantPrivacyDependencies {
  return {
    applyAction(command) {
      commands.push(command);
      return Promise.resolve(
        command.action === "request_deletion"
          ? { action: command.action, status: "pending" }
          : { action: command.action, status: "accepted" },
      );
    },
  };
}

function request(body: Record<string, unknown>) {
  return new Request("http://localhost/functions/v1/manage-applicant-privacy", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function assertEquals(actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `Expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`,
    );
  }
}
