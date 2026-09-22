import type { RuleDefinition } from "../../../src/features/eligibility/domain/types.ts";
import {
  PublicOpportunityError,
  createGetPublicOpportunityHandler,
  getPublicOpportunity,
  type PublicOpportunityDependencies,
  type PublicOpportunityRow,
} from "./index.ts";

type TestFunction = () => void | Promise<void>;
type TestRegistrar = (name: string, testFunction: TestFunction) => void;

const registerTest: TestRegistrar =
  "Deno" in globalThis
    ? Deno.test
    : (globalThis as typeof globalThis & { it: TestRegistrar }).it;

const opportunityId = "00000000-0000-4000-8000-000000000001";
const now = new Date("2026-09-22T03:00:00.000Z");
const rules: RuleDefinition[] = [
  {
    id: "adult-only",
    field: "isAdult",
    operator: "equals",
    expected: true,
    effect: "hard_fail",
    reason: "This pilot is available to adults only.",
  },
];

function createRow(
  overrides: Partial<PublicOpportunityRow> = {},
): PublicOpportunityRow {
  return {
    id: opportunityId,
    recruiter_id: "00000000-0000-4000-8000-000000000099",
    category: "makeup_certification",
    title: "Makeup certification practical exam",
    starts_at: "2026-09-24T03:00:00.000Z",
    closes_at: "2026-09-23T03:00:00.000Z",
    closed_at: null,
    venue_district: "서울 강남구",
    expected_minutes: 120,
    benefit: {
      type: "cash",
      amount: 100000,
      description: "Cash after the exam",
    },
    status: "published",
    ruleset_id: "makeup-certification",
    ruleset_version: 1,
    rules_snapshot: structuredClone(rules),
    created_at: "2026-09-20T03:00:00.000Z",
    updated_at: "2026-09-21T03:00:00.000Z",
    recruiter_only_notes: "Never expose this.",
    ...overrides,
  };
}

function createDependencies(
  row: PublicOpportunityRow | null,
): PublicOpportunityDependencies {
  return {
    now: () => now,
    loadOpportunity: () => Promise.resolve(row),
  };
}

registerTest(
  "returns only the applicant-safe public opportunity whitelist",
  async () => {
    // Production break: spreading the database row leaks recruiter identity, notes, or internal timestamps.
    const result = await getPublicOpportunity(
      { opportunityId },
      createDependencies(createRow()),
    );

    assertEquals(result, {
      id: opportunityId,
      category: "makeup_certification",
      title: "Makeup certification practical exam",
      startsAt: "2026-09-24T03:00:00.000Z",
      closesAt: "2026-09-23T03:00:00.000Z",
      venueDistrict: "서울 강남구",
      expectedMinutes: 120,
      benefit: {
        type: "cash",
        amount: 100000,
        description: "Cash after the exam",
      },
      rulesetId: "makeup-certification",
      rulesetVersion: 1,
      rules,
    });
  },
);

registerTest(
  "rejects malformed opportunity IDs before loading data",
  async () => {
    // Production break: passing arbitrary route input into the service-role query broadens the endpoint surface.
    let loadCount = 0;
    const dependencies: PublicOpportunityDependencies = {
      now: () => now,
      loadOpportunity: () => {
        loadCount += 1;
        return Promise.resolve(createRow());
      },
    };

    const error = await expectPublicOpportunityError(
      () => getPublicOpportunity({ opportunityId: "not-a-uuid" }, dependencies),
      "Invalid opportunity request.",
    );

    assertEquals(error.status, 400);
    assertEquals(loadCount, 0);
  },
);

for (const testCase of [
  {
    name: "draft",
    row: createRow({ status: "draft" }),
    message: "This opportunity was not found.",
    status: 404,
  },
  {
    name: "closed",
    row: createRow({ status: "closed" }),
    message: "This opportunity is closed.",
    status: 410,
  },
  {
    name: "explicitly closed",
    row: createRow({ closed_at: "2026-09-22T02:00:00.000Z" }),
    message: "This opportunity is closed.",
    status: 410,
  },
  {
    name: "past close",
    row: createRow({ closes_at: "2026-09-22T03:00:00.000Z" }),
    message: "This opportunity is closed.",
    status: 410,
  },
  {
    name: "missing",
    row: null,
    message: "This opportunity was not found.",
    status: 404,
  },
] as const) {
  registerTest(`rejects a ${testCase.name} opportunity`, async () => {
    // Production break: serving anything except an active published opportunity exposes unavailable job data.
    const error = await expectPublicOpportunityError(
      () =>
        getPublicOpportunity(
          { opportunityId },
          createDependencies(testCase.row),
        ),
      testCase.message,
    );

    assertEquals(error.status, testCase.status);
  });
}

registerTest("allows Supabase browser preflight headers", async () => {
  // Production break: omitting x-client-info blocks the browser before the public read reaches the handler.
  const response = await createGetPublicOpportunityHandler(
    createDependencies(createRow()),
  )(
    new Request("http://localhost/functions/v1/get-public-opportunity", {
      method: "OPTIONS",
      headers: {
        "Access-Control-Request-Headers":
          "authorization, x-client-info, apikey, content-type",
      },
    }),
  );

  assertEquals(response.status, 204);
  assertEquals(
    response.headers.get("Access-Control-Allow-Headers"),
    "authorization, x-client-info, apikey, content-type",
  );
});

function assertEquals(actual: unknown, expected: unknown): void {
  const actualJson = JSON.stringify(sortKeys(actual));
  const expectedJson = JSON.stringify(sortKeys(expected));
  if (actualJson !== expectedJson) {
    throw new Error(`Expected ${expectedJson}, received ${actualJson}.`);
  }
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeys);
  }
  if (typeof value !== "object" || value === null) {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, sortKeys(entry)]),
  );
}

async function expectPublicOpportunityError(
  operation: () => Promise<unknown>,
  expectedMessage: string,
): Promise<PublicOpportunityError> {
  try {
    await operation();
  } catch (error) {
    if (!(error instanceof PublicOpportunityError)) {
      throw new Error("Expected a PublicOpportunityError.", { cause: error });
    }
    if (error.message !== expectedMessage) {
      throw new Error(
        `Expected ${expectedMessage}, received ${error.message}.`,
        { cause: error },
      );
    }
    return error;
  }

  throw new Error("Expected the operation to reject.");
}
