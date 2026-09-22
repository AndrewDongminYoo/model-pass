import type { RuleDefinition } from "../../../src/features/eligibility/domain/types.ts";
import {
  createPublishOpportunityHandler,
  type OpportunityPublicationCommand,
  type OpportunityPublicationDependencies,
} from "./index.ts";

type TestFunction = () => void | Promise<void>;
type TestRegistrar = (name: string, testFunction: TestFunction) => void;

const registerTest: TestRegistrar =
  "Deno" in globalThis
    ? Deno.test
    : (globalThis as typeof globalThis & { it: TestRegistrar }).it;

const opportunityId = "00000000-0000-0000-0000-000000000001";
const recruiterId = "00000000-0000-0000-0000-000000000111";
const hardRules: RuleDefinition[] = [
  {
    id: "adult-only",
    field: "isAdult",
    operator: "equals",
    expected: true,
    effect: "hard_fail",
    reason: "This pilot is available to adults only.",
  },
  {
    id: "schedule-available",
    field: "isAvailable",
    operator: "equals",
    expected: true,
    effect: "hard_fail",
    reason: "This schedule is unavailable.",
  },
];

function createInput(overrides: Record<string, unknown> = {}) {
  return {
    draft: {
      category: "hair_promotion",
      title: "Layered cut promotion exam",
      startsAt: "2099-06-01T10:00:00.000Z",
      closesAt: "2099-05-31T18:00:00.000Z",
      venueDistrict: "서울 강남구",
      expectedMinutes: 90,
      benefit: { type: "procedure", description: "Free layered cut" },
      rulesetId: "hair-promotion",
      rulesetVersion: 1,
      rules: hardRules,
    },
    confirmedHardRuleIds: hardRules.map((rule) => rule.id),
    ...overrides,
  };
}

function createDependencies(authenticatedUserId: string | null) {
  const persisted: OpportunityPublicationCommand[] = [];
  const dependencies: OpportunityPublicationDependencies = {
    authenticate: () => Promise.resolve(authenticatedUserId),
    persistOpportunity: (command) => {
      persisted.push(command);
      return Promise.resolve(opportunityId);
    },
  };
  return { dependencies, persisted };
}

registerTest("denies unauthenticated publication", async () => {
  const { dependencies, persisted } = createDependencies(null);
  const response = await createPublishOpportunityHandler(dependencies)(
    new Request("http://localhost/functions/v1/publish-opportunity", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(createInput()),
    }),
  );

  assertEquals(response.status, 401);
  assertEquals(persisted.length, 0);
});

registerTest(
  "rejects publication when any hard rule is unconfirmed",
  async () => {
    const { dependencies, persisted } = createDependencies(recruiterId);
    const response = await createPublishOpportunityHandler(dependencies)(
      new Request("http://localhost/functions/v1/publish-opportunity", {
        method: "POST",
        headers: {
          Authorization: "Bearer recruiter-token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(
          createInput({ confirmedHardRuleIds: ["adult-only"] }),
        ),
      }),
    );

    assertEquals(response.status, 400);
    assertEquals(persisted.length, 0);
  },
);

registerTest(
  "publishes under the authenticated recruiter and returns both links",
  async () => {
    const { dependencies, persisted } = createDependencies(recruiterId);
    const response = await createPublishOpportunityHandler(dependencies)(
      new Request("http://localhost/functions/v1/publish-opportunity", {
        method: "POST",
        headers: {
          Authorization: "Bearer recruiter-token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(createInput()),
      }),
    );

    assertEquals(response.status, 201);
    assertEquals(persisted.length, 1);
    assertEquals(persisted[0]?.recruiterId, recruiterId);
    assertEquals(await response.json(), {
      opportunityId,
      applicantPath: `/opportunities/${opportunityId}/apply`,
      recruiterReviewPath: `/recruiter/opportunities/${opportunityId}/applications`,
    });
  },
);

registerTest("rejects a caller-supplied recruiter identity", async () => {
  const { dependencies, persisted } = createDependencies(recruiterId);
  const response = await createPublishOpportunityHandler(dependencies)(
    new Request("http://localhost/functions/v1/publish-opportunity", {
      method: "POST",
      headers: {
        Authorization: "Bearer recruiter-token",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(createInput({ recruiterId: "another-user" })),
    }),
  );

  assertEquals(response.status, 400);
  assertEquals(persisted.length, 0);
});

function assertEquals(actual: unknown, expected: unknown): void {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  if (actualJson !== expectedJson) {
    throw new Error(`Expected ${expectedJson}, received ${actualJson}.`);
  }
}
