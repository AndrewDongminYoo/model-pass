import type { RuleDefinition } from "../../../src/features/eligibility/domain/types.ts";
import {
  SubmissionError,
  createSubmitApplicationHandler,
  submitApplication,
  type ApplicationPersistenceCommand,
  type OpportunityForSubmission,
  type SubmissionDependencies,
} from "./index.ts";
import { isSubmitApplicationResult } from "../../../src/features/applications/api/submit-application.ts";

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

function createDependencies(
  opportunity = createOpportunity(),
  currentDate = now,
) {
  const persisted: ApplicationPersistenceCommand[] = [];
  const dependencies: SubmissionDependencies = {
    now: () => currentDate,
    loadOpportunity: () => Promise.resolve(opportunity),
    persistApplication: (command) => {
      persisted.push(command);
      return Promise.resolve(applicationId);
    },
  };

  return { dependencies, persisted };
}

registerTest("allows Supabase browser preflight headers", async () => {
  // Production break: omitting x-client-info makes Supabase JS browser preflight fail before submission.
  const { dependencies } = createDependencies();
  const response = await createSubmitApplicationHandler(dependencies)(
    new Request("http://localhost/functions/v1/submit-application", {
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

registerTest("uses the Seoul business date for the age-19 boundary", async () => {
  // Production break: using the UTC date rejects an applicant after their birthday starts in Seoul.
  const seoulBirthdayBoundary = new Date("2026-09-22T15:30:00.000Z");
  const { dependencies, persisted } = createDependencies(
    createOpportunity(),
    seoulBirthdayBoundary,
  );

  const result = await submitApplication(
    createInput({
      applicant: {
        displayName: "Applicant",
        phone: "010-1234-5678",
        birthDate: "2007-09-23",
      },
    }),
    dependencies,
  );

  assertEquals(result.applicationId, applicationId);
  assertEquals(persisted.length, 1);
});

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

registerTest("rejects answer fields that the stored rules do not request", async () => {
  // Production break: persisting unrelated client data that has no stored eligibility rule.
  const { dependencies, persisted } = createDependencies();

  const error = await expectSubmissionError(
    () =>
      submitApplication(
        createInput({
          answers: { isAvailable: true, unrelatedProfile: "extra" },
        }),
        dependencies,
      ),
    "Answers contain fields not requested by this opportunity.",
  );

  assertEquals(error.status, 400);
  assertEquals(persisted.length, 0);
});

registerTest("rejects a client-supplied isAdult answer", async () => {
  // Production break: allowing the client to supply the server-derived adult eligibility input.
  const { dependencies, persisted } = createDependencies();

  const error = await expectSubmissionError(
    () =>
      submitApplication(
        createInput({
          answers: { isAdult: true, isAvailable: true },
        }),
        dependencies,
      ),
    "Answers contain fields not requested by this opportunity.",
  );

  assertEquals(error.status, 400);
  assertEquals(persisted.length, 0);
});

registerTest("rejects an oversized applicant display name", async () => {
  // Production break: accepting unbounded personal-data strings into the submission payload.
  const { dependencies, persisted } = createDependencies();

  await expectValidationError(() =>
    submitApplication(
      createInput({
        applicant: {
          displayName: "A".repeat(101),
          phone: "010-1234-5678",
          birthDate: "2000-09-22",
        },
      }),
      dependencies,
    )
  );

  assertEquals(persisted.length, 0);
});

registerTest("rejects an oversized answer string", async () => {
  // Production break: accepting an answer string above the declared payload limit.
  const { dependencies, persisted } = createDependencies();

  await expectValidationError(() =>
    submitApplication(
      createInput({
        answers: { isAvailable: "A".repeat(1_001) },
      }),
      dependencies,
    )
  );

  assertEquals(persisted.length, 0);
});

registerTest("rejects an incomplete client success response", () => {
  // Production break: treating a partial evaluation body as a successful application response.
  assertEquals(
    isSubmitApplicationResult({
      applicationId,
      evaluation: { eligible: true },
    }),
    false,
  );
  assertEquals(
    isSubmitApplicationResult({
      applicationId,
      evaluation: {
        rulesetId: "hair-promotion",
        rulesetVersion: 1,
        eligible: true,
        failures: [],
        reviews: [],
        reminders: [],
      },
    }),
    true,
  );
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

async function expectValidationError(
  operation: () => Promise<unknown>,
): Promise<void> {
  try {
    await operation();
  } catch (error) {
    if (error instanceof Error && error.name === "ZodError") {
      return;
    }

    throw new Error("Expected a ZodError.", { cause: error });
  }

  throw new Error("Expected the operation to reject.");
}
