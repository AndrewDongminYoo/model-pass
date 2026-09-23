import {
  createCloseOpportunityHandler,
  type ClosureDependencies,
} from "./index.ts";

const opportunityId = "00000000-0000-4000-8000-000000000011";
const recruiterId = "00000000-0000-4000-8000-000000000001";

Deno.test(
  "closes an owned opportunity through the authenticated server path",
  async () => {
    const calls: Array<{ opportunityId: string; recruiterId: string }> = [];
    const dependencies: ClosureDependencies = {
      authenticate: () => Promise.resolve(recruiterId),
      closeOwnedOpportunity: (input) => {
        calls.push(input);
        return Promise.resolve({
          opportunityId,
          status: "closed",
          closedAt: "2026-09-23T01:00:00.000Z",
        });
      },
    };
    const response = await createCloseOpportunityHandler(dependencies)(
      new Request("http://localhost/functions/v1/close-opportunity", {
        method: "POST",
        headers: { Authorization: "Bearer recruiter-token" },
        body: JSON.stringify({ opportunityId }),
      }),
    );

    assertEquals(response.status, 200);
    assertEquals(calls, [{ opportunityId, recruiterId }]);
    assertEquals(await response.json(), {
      opportunityId,
      status: "closed",
      closedAt: "2026-09-23T01:00:00.000Z",
    });
  },
);

Deno.test(
  "denies missing credentials and caller-supplied recruiter identity",
  async () => {
    let called = false;
    const dependencies: ClosureDependencies = {
      authenticate: () => Promise.resolve(null),
      closeOwnedOpportunity: () => {
        called = true;
        return Promise.resolve(null);
      },
    };
    const unauthorized = await createCloseOpportunityHandler(dependencies)(
      new Request("http://localhost/functions/v1/close-opportunity", {
        method: "POST",
        body: JSON.stringify({ opportunityId }),
      }),
    );
    const spoofed = await createCloseOpportunityHandler({
      ...dependencies,
      authenticate: () => Promise.resolve(recruiterId),
    })(
      new Request("http://localhost/functions/v1/close-opportunity", {
        method: "POST",
        headers: { Authorization: "Bearer recruiter-token" },
        body: JSON.stringify({ opportunityId, recruiterId: "another-user" }),
      }),
    );

    assertEquals(unauthorized.status, 401);
    assertEquals(spoofed.status, 400);
    assertEquals(called, false);
  },
);

Deno.test("conceals non-owned opportunities", async () => {
  const dependencies: ClosureDependencies = {
    authenticate: () => Promise.resolve(recruiterId),
    closeOwnedOpportunity: () => Promise.resolve(null),
  };
  const response = await createCloseOpportunityHandler(dependencies)(
    new Request("http://localhost/functions/v1/close-opportunity", {
      method: "POST",
      headers: { Authorization: "Bearer recruiter-token" },
      body: JSON.stringify({ opportunityId }),
    }),
  );

  assertEquals(response.status, 404);
});

function assertEquals(actual: unknown, expected: unknown): void {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  if (actualJson !== expectedJson) {
    throw new Error(`Expected ${expectedJson}, received ${actualJson}.`);
  }
}
