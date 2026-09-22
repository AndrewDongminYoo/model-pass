import type { RuleDefinition } from "../../../src/features/eligibility/domain/types.ts";
import {
  SubmissionError,
  submitApplication,
  type ApplicationPersistenceCommand,
  type OpportunityForSubmission,
  type SubmissionDependencies,
} from "./index.ts";

type TestFunction = () => void | Promise<void>;
type TestRegistrar = (name: string, testFunction: TestFunction) => void;

const registerTest: TestRegistrar = "Deno" in globalThis
  ? Deno.test
  : (globalThis as typeof globalThis & { it: TestRegistrar }).it;

const now = new Date("2026-09-22T03:00:00.000Z");
const applicationId = "00000000-0000-0000-0000-000000000101";

const rules: RuleDefinition[] = [
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

function createOpportunity(): OpportunityForSubmission {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    closesAt: "2026-09-23T03:00:00.000Z",
    closedAt: null,
    rulesetId: "hair-promotion",
    rulesetVersion: 1,
    rules: structuredClone(rules),
  };
}

function createInput(overrides: Record<string, unknown> = {}) {
  return {
    opportunityId: "00000000-0000-0000-0000-000000000001",
    applicant: {
      displayName: "Applicant",
      phone: "010-1234-5678",
      birthDate: "2000-09-22",
    },
    answers: { isAvailable: true },
    currentApplicationConsent: true,
    futureOpportunityConsent: false,
    ...overrides,
  };
}

function createDependencies(opportunity = createOpportunity()) {
  const persisted: ApplicationPersistenceCommand[] = [];
  const dependencies: SubmissionDependencies = {
    now: () => now,
    loadOpportunity: () => Promise.resolve(opportunity),
    persistApplication: (command) => {
      persisted.push(command);
      return Promise.resolve(applicationId);
    },
  };

  return { dependencies, persisted };
}

registerTest("rejects an applicant who has not reached age 19", async () => {
  // Production break: trusting an applicant's adult answer instead of deriving age from the birth date.
  const { dependencies, persisted } = createDependencies();

  const error = await expectSubmissionError(
    () =>
      submitApplication(
        createInput({
          applicant: {
            displayName: "Applicant",
            phone: "010-1234-5678",
            birthDate: "2007-09-23",
          },
          answers: { isAdult: true, isAvailable: true },
        }),
        dependencies,
      ),
    "Applicants must be at least 19 years old.",
  );

  assertEquals(error.status, 422);
  assertEquals(persisted.length, 0);
});

registerTest("ignores a client eligibility claim when a server-evaluated hard rule fails", async () => {
  // Production break: persisting a client-supplied eligible flag without evaluating the stored rules.
  const { dependencies, persisted } = createDependencies();

  const error = await expectSubmissionError(
    () =>
      submitApplication(
        createInput({
          answers: { isAvailable: false },
          eligible: true,
          evaluation: { eligible: true },
        }),
        dependencies,
      ),
    "The application does not satisfy this opportunity's rules.",
  );

  assertEquals(error.status, 422);
  assertEquals(error.evaluation?.eligible, false);
  assertEquals(error.evaluation?.failures[0]?.ruleId, "schedule-available");
  assertEquals(persisted.length, 0);
});

registerTest("persists immutable rules and evaluation snapshots", async () => {
  // Production break: retaining the mutable opportunity rules instead of the exact submission-time snapshot.
  const opportunity = createOpportunity();
  const { dependencies, persisted } = createDependencies(opportunity);

  const result = await submitApplication(createInput(), dependencies);

  assertEquals(result.applicationId, applicationId);
  assertEquals(result.evaluation.eligible, true);
  assertEquals(persisted.length, 1);
  assertEquals(persisted[0]?.currentApplicationConsent, true);
  assertEquals(persisted[0]?.futureOpportunityConsent, false);

  opportunity.rules[1] = {
    ...opportunity.rules[1],
    reason: "Changed after submission.",
  };
  opportunity.rulesetVersion = 2;

  assertEquals(persisted[0]?.rulesetVersion, 1);
  assertEquals(
    persisted[0]?.rulesSnapshot[1]?.reason,
    "This schedule is unavailable.",
  );
  assertEquals(persisted[0]?.evaluationSnapshot, {
    rulesetId: "hair-promotion",
    rulesetVersion: 1,
    eligible: true,
    failures: [],
    reviews: [],
    reminders: [],
  });
});

registerTest("rejects an application after the opportunity closes", async () => {
  // Production break: accepting new personal data after the published close time.
  const opportunity = createOpportunity();
  opportunity.closesAt = "2026-09-22T02:59:59.000Z";
  const { dependencies, persisted } = createDependencies(opportunity);

  const error = await expectSubmissionError(
    () => submitApplication(createInput(), dependencies),
    "This opportunity is closed.",
  );

  assertEquals(error.status, 409);
  assertEquals(persisted.length, 0);
});

function assertEquals(actual: unknown, expected: unknown): void {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  if (actualJson !== expectedJson) {
    throw new Error(`Expected ${expectedJson}, received ${actualJson}.`);
  }
}

async function expectSubmissionError(
  operation: () => Promise<unknown>,
  expectedMessage: string,
): Promise<SubmissionError> {
  try {
    await operation();
  } catch (error) {
    if (!(error instanceof SubmissionError)) {
      throw new Error("Expected a SubmissionError.", { cause: error });
    }
    if (!error.message.includes(expectedMessage)) {
      throw new Error(
        `Expected error message to include ${expectedMessage}, received ${error.message}.`,
        { cause: error },
      );
    }
    return error;
  }

  throw new Error("Expected the operation to reject.");
}
