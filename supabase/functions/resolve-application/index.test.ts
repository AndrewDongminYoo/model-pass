import {
  createResolveApplicationHandler,
  type ResolveApplicationDependencies,
} from "./index.ts";

type TestFunction = () => void | Promise<void>;
type TestRegistrar = (name: string, testFunction: TestFunction) => void;

const registerTest: TestRegistrar =
  "Deno" in globalThis
    ? Deno.test
    : (globalThis as typeof globalThis & { it: TestRegistrar }).it;

const applicationId = "00000000-0000-4000-8000-000000000101";
const submissionAttemptId = "00000000-0000-4000-8000-000000000201";
const opportunityId = "00000000-0000-4000-8000-000000000001";

function createDependencies(found: string | null = opportunityId) {
  const lookups: { applicationId: string; submissionAttemptId: string }[] = [];
  const dependencies: ResolveApplicationDependencies = {
    findOpportunityId: (lookupApplicationId, lookupSubmissionAttemptId) => {
      lookups.push({
        applicationId: lookupApplicationId,
        submissionAttemptId: lookupSubmissionAttemptId,
      });
      return Promise.resolve(found);
    },
  };
  return { dependencies, lookups };
}

function post(body: unknown): Request {
  return new Request("http://localhost/functions/v1/resolve-application", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

registerTest("returns the opportunity for a matching receipt", async () => {
  const test = createDependencies();
  const response = await createResolveApplicationHandler(test.dependencies)(
    post({ applicationId, submissionAttemptId }),
  );

  assertEquals(response.status, 200);
  assertEquals(await response.json(), { opportunityId });
  assertEquals(test.lookups, [{ applicationId, submissionAttemptId }]);
});

registerTest("answers every miss with the same not-found body", async () => {
  const test = createDependencies(null);
  const response = await createResolveApplicationHandler(test.dependencies)(
    post({ applicationId, submissionAttemptId }),
  );

  assertEquals(response.status, 404);
  assertEquals(await response.json(), {
    error: "No application matches this receipt.",
  });
});

registerTest("rejects malformed identifiers without a lookup", async () => {
  const test = createDependencies();
  const response = await createResolveApplicationHandler(test.dependencies)(
    post({ applicationId: "not-a-uuid", submissionAttemptId }),
  );

  assertEquals(response.status, 400);
  assertEquals(test.lookups.length, 0);
});

registerTest("rejects extra fields without a lookup", async () => {
  const test = createDependencies();
  const response = await createResolveApplicationHandler(test.dependencies)(
    post({ applicationId, submissionAttemptId, opportunityId }),
  );

  assertEquals(response.status, 400);
  assertEquals(test.lookups.length, 0);
});

registerTest("rejects a request body that is too large", async () => {
  const test = createDependencies();
  const response = await createResolveApplicationHandler(test.dependencies)(
    post({ applicationId, submissionAttemptId, padding: "x".repeat(5_000) }),
  );

  assertEquals(response.status, 413);
  assertEquals(test.lookups.length, 0);
});

registerTest("allows only POST and preflight", async () => {
  const test = createDependencies();
  const handler = createResolveApplicationHandler(test.dependencies);

  assertEquals(
    (
      await handler(
        new Request("http://localhost/functions/v1/resolve-application"),
      )
    ).status,
    405,
  );
  assertEquals(
    (
      await handler(
        new Request("http://localhost/functions/v1/resolve-application", {
          method: "OPTIONS",
        }),
      )
    ).status,
    204,
  );
});

function assertEquals(actual: unknown, expected: unknown): void {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  if (actualJson !== expectedJson) {
    throw new Error(`Expected ${expectedJson}, received ${actualJson}.`);
  }
}

registerTest(
  "stops reading a body without Content-Length once it is too large",
  async () => {
    const test = createDependencies();
    let pulledChunks = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulledChunks += 1;
        if (pulledChunks > 5) {
          controller.close();
          return;
        }
        controller.enqueue(new Uint8Array(1024));
      },
    });
    const response = await createResolveApplicationHandler(test.dependencies)(
      new Request("http://localhost/functions/v1/resolve-application", {
        method: "POST",
        body,
      }),
    );

    assertEquals(response.status, 413);
    assertEquals(pulledChunks <= 3, true);
    assertEquals(test.lookups.length, 0);
  },
);
