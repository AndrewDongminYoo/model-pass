import type { RuleDefinition } from "../../../src/features/eligibility/domain/types.ts";
import { hashAnonymousRequestSource } from "../_shared/anonymous-quota.ts";
import {
  SubmissionError,
  createSubmissionFingerprint,
  createSubmitApplicationHandler,
  submitApplication,
  type ApplicationPersistenceCommand,
  type ApplicationPersistenceResult,
  type ExistingApplicationAttempt,
  type OpportunityForSubmission,
  type SubmissionDependencies,
} from "./index.ts";
import { isSubmitApplicationResult } from "../../../src/features/applications/api/submit-application.ts";

declare global {
  interface ImportMeta {
    readonly env: Record<string, string | undefined>;
  }
}

type TestFunction = () => void | Promise<void>;
type TestRegistrar = (name: string, testFunction: TestFunction) => void;

const registerTest: TestRegistrar =
  "Deno" in globalThis
    ? Deno.test
    : (globalThis as typeof globalThis & { it: TestRegistrar }).it;

const now = new Date("2026-09-22T03:00:00.000Z");
const applicationId = "00000000-0000-0000-0000-000000000101";
const submissionAttemptId = "00000000-0000-4000-8000-000000000201";

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
    submissionAttemptId,
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
  options: {
    existingAttempt?: ExistingApplicationAttempt | null;
    persistenceResult?: ApplicationPersistenceResult;
    quotaAllowed?: boolean;
  } = {},
) {
  const persisted: ApplicationPersistenceCommand[] = [];
  let opportunityLoadCount = 0;
  let quotaConsumptionCount = 0;
  const quotaCalls: unknown[][] = [];
  const dependencies: SubmissionDependencies = {
    now: () => currentDate,
    loadExistingAttempt: () => Promise.resolve(options.existingAttempt ?? null),
    loadOpportunity: () => {
      opportunityLoadCount += 1;
      return Promise.resolve(opportunity);
    },
    consumeQuota: (...args) => {
      quotaConsumptionCount += 1;
      quotaCalls.push(args);
      return Promise.resolve(options.quotaAllowed ?? true);
    },
    persistApplication: (command) => {
      persisted.push(command);
      return Promise.resolve(
        options.persistenceResult ?? {
          applicationId,
          evaluation: command.evaluationSnapshot,
          submissionState: command.submissionState,
        },
      );
    },
  };

  return {
    dependencies,
    persisted,
    getOpportunityLoadCount: () => opportunityLoadCount,
    getQuotaConsumptionCount: () => quotaConsumptionCount,
    quotaCalls,
  };
}

registerTest("binds anonymous quota to the submission attempt", async () => {
  const test = createDependencies();
  await submitApplication(createInput(), test.dependencies, "a".repeat(64));

  assertEquals(test.quotaCalls, [
    [createOpportunity().id, "a".repeat(64), submissionAttemptId],
  ]);
});

registerTest(
  "binds anonymous quota to the forwarded source without storing the IP",
  async () => {
    const first = await hashAnonymousRequestSource(
      new Request("http://localhost", {
        headers: { "X-Forwarded-For": "192.0.2.10" },
      }),
      "test-secret",
    );
    const second = await hashAnonymousRequestSource(
      new Request("http://localhost", {
        headers: { "X-Forwarded-For": "192.0.2.11" },
      }),
      "test-secret",
    );
    assertEquals(first?.length, 64);
    assertEquals(first === second, false);
    assertEquals(first?.includes("192.0.2.10"), false);
    assertEquals(
      await hashAnonymousRequestSource(
        new Request("http://localhost"),
        "test-secret",
      ),
      null,
    );
  },
);

registerTest(
  "fails closed when the gateway source is unavailable",
  async () => {
    const test = createDependencies();
    const response = await createSubmitApplicationHandler(
      test.dependencies,
      "test-secret",
    )(
      new Request("http://localhost/functions/v1/submit-application", {
        method: "POST",
        body: JSON.stringify(createInput()),
      }),
    );
    assertEquals(response.status, 503);
    assertEquals(test.getQuotaConsumptionCount(), 0);
    assertEquals(test.persisted.length, 0);
  },
);

registerTest(
  "does not consume quota for a failed eligibility check",
  async () => {
    const test = createDependencies();
    await expectSubmissionError(
      () =>
        submitApplication(
          createInput({
            applicant: {
              displayName: "Applicant",
              phone: "010-1234-5678",
              birthDate: "2015-09-22",
            },
          }),
          test.dependencies,
        ),
      "Applicants must be at least 19 years old.",
    );
    assertEquals(test.getQuotaConsumptionCount(), 0);
  },
);

registerTest("rejects an exhausted anonymous submission quota", async () => {
  const { dependencies, persisted } = createDependencies(
    createOpportunity(),
    now,
    {
      quotaAllowed: false,
    },
  );
  const error = await expectSubmissionError(
    () => submitApplication(createInput(), dependencies),
    "Too many applications for this opportunity. Please try again later.",
  );
  assertEquals(error.status, 429);
  assertEquals(persisted.length, 0);
});

registerTest(
  "rejects an oversized submission body before parsing",
  async () => {
    const { dependencies, persisted } = createDependencies();
    const response = await createSubmitApplicationHandler(
      dependencies,
      "test-secret",
    )(
      new Request("http://localhost/functions/v1/submit-application", {
        method: "POST",
        body: "x".repeat(262_145),
      }),
    );

    assertEquals(response.status, 413);
    assertEquals(persisted.length, 0);
  },
);

registerTest("rejects an oversized declared submission length", async () => {
  const { dependencies, persisted } = createDependencies();
  const response = await createSubmitApplicationHandler(
    dependencies,
    "test-secret",
  )(
    new Request("http://localhost/functions/v1/submit-application", {
      method: "POST",
      headers: { "Content-Length": "262145" },
      body: "{}",
    }),
  );

  assertEquals(response.status, 413);
  assertEquals(persisted.length, 0);
});

registerTest("allows Supabase browser preflight headers", async () => {
  // Production break: omitting x-client-info makes Supabase JS browser preflight fail before submission.
  const { dependencies } = createDependencies();
  const response = await createSubmitApplicationHandler(
    dependencies,
    "test-secret",
  )(
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

registerTest(
  "uses the Seoul business date for the age-19 boundary",
  async () => {
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
  },
);

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

registerTest(
  "derives the 2026 makeup upper age limit from birth year",
  async () => {
    const opportunity = createOpportunity();
    opportunity.rulesetId = "makeup-certification";
    opportunity.rulesetVersion = 2;
    opportunity.rules.push({
      id: "makeup-exam-age-limit",
      field: "isWithinMakeupAgeLimit",
      operator: "equals",
      expected: true,
      effect: "hard_fail",
      reason:
        "The 2026 makeup exam requires models to be no older than 55 by birth year.",
    });
    const olderApplicant = createDependencies(opportunity);

    const error = await expectSubmissionError(
      () =>
        submitApplication(
          createInput({
            applicant: {
              displayName: "Applicant",
              phone: "010-1234-5678",
              birthDate: "1970-12-31",
            },
            answers: { isAvailable: true, isWithinMakeupAgeLimit: true },
          }),
          olderApplicant.dependencies,
        ),
      "The application does not satisfy this opportunity's rules.",
    );
    assertEquals(error.status, 422);
    assertEquals(olderApplicant.persisted.length, 0);

    const eligibleApplicant = createDependencies(opportunity);
    await submitApplication(
      createInput({
        applicant: {
          displayName: "Applicant",
          phone: "010-1234-5678",
          birthDate: "1971-01-01",
        },
        answers: { isAvailable: true },
      }),
      eligibleApplicant.dependencies,
    );
    assertEquals(
      eligibleApplicant.persisted[0]?.answers.isWithinMakeupAgeLimit,
      true,
    );
  },
);

registerTest(
  "ignores a client eligibility claim when a server-evaluated hard rule fails",
  async () => {
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
  },
);

registerTest(
  "rejects answer fields that the stored rules do not request",
  async () => {
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
  },
);

registerTest("rejects an omitted non-photo review answer", async () => {
  // Production break: an omitted preferred answer can be persisted without a recruiter-visible answer row.
  const opportunity = createOpportunity();
  opportunity.rules.push({
    id: "prefers-no-dye",
    field: "noRecentDye",
    operator: "equals",
    expected: true,
    effect: "needs_review",
    reason: "Recent dye needs recruiter review.",
  });
  const { dependencies, persisted } = createDependencies(opportunity);

  const error = await expectSubmissionError(
    () => submitApplication(createInput(), dependencies),
    "Answers are missing a requested opportunity field.",
  );

  assertEquals(error.status, 400);
  assertEquals(persisted.length, 0);
});

registerTest("rejects an omitted non-photo reminder answer", async () => {
  // Production break: an omitted reminder answer can be persisted without a recruiter-visible answer row.
  const opportunity = createOpportunity();
  opportunity.rules.push({
    id: "day-of-makeup",
    field: "wearsDayOfMakeup",
    operator: "equals",
    expected: false,
    effect: "reminder",
    reason: "Arrive without makeup.",
  });
  const { dependencies, persisted } = createDependencies(opportunity);

  const error = await expectSubmissionError(
    () => submitApplication(createInput(), dependencies),
    "Answers are missing a requested opportunity field.",
  );

  assertEquals(error.status, 400);
  assertEquals(persisted.length, 0);
});

registerTest("rejects a null answer to a stored question", async () => {
  // Production break: a null review answer is present in the payload but still leaves the question unanswered.
  const opportunity = createOpportunity();
  opportunity.rules.push({
    id: "prefers-no-dye",
    field: "noRecentDye",
    operator: "equals",
    expected: true,
    effect: "needs_review",
    reason: "Recent dye needs recruiter review.",
  });
  const { dependencies, persisted } = createDependencies(opportunity);

  const error = await expectSubmissionError(
    () =>
      submitApplication(
        createInput({ answers: { isAvailable: true, noRecentDye: null } }),
        dependencies,
      ),
    "Answers are missing a requested opportunity field.",
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

registerTest(
  "persists a photo review as pending_photo and rejects client photo claims",
  async () => {
    // Production break: a client-provided photo answer can bypass the server-owned pending photo state.
    const opportunity = createOpportunity();
    opportunity.rules.push({
      id: "photo-required",
      field: "requestedPhoto",
      operator: "equals",
      expected: true,
      effect: "needs_review",
      reason: "Upload the requested job-specific photo.",
    });
    const test = createDependencies(opportunity);

    const result = await submitApplication(createInput(), test.dependencies);

    assertEquals(result.submissionState, "pending_photo");
    assertEquals(test.persisted[0]?.submissionState, "pending_photo");
    const error = await expectSubmissionError(
      () =>
        submitApplication(
          createInput({
            submissionAttemptId: "00000000-0000-4000-8000-000000000202",
            answers: { isAvailable: true, requestedPhoto: true },
          }),
          test.dependencies,
        ),
      "Answers contain fields not requested by this opportunity.",
    );
    assertEquals(error.status, 400);
  },
);

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
    ),
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
    ),
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
      submissionState: "submitted",
    }),
    true,
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
    false,
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
  assertEquals(persisted[0]?.submissionAttemptId, submissionAttemptId);
  assertMatches(
    persisted[0]?.submissionFingerprint,
    /^[0-9a-f]{64}$/,
    "submission fingerprint",
  );

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

registerTest(
  "keeps an unmet preferred condition eligible for recruiter review",
  async () => {
    const opportunity = createOpportunity();
    opportunity.rulesetVersion = 2;
    opportunity.rules.push({
      id: "prefers-no-dye",
      field: "noRecentDye",
      operator: "equals",
      expected: true,
      effect: "needs_review",
      reason: "최근 염색하지 않은 모델을 선호합니다.",
      question: {
        en: "Have you avoided dyeing your hair in the past month?",
        ko: "최근 한 달 동안 염색하지 않았나요?",
      },
    });
    const { dependencies, persisted } = createDependencies(opportunity);

    const result = await submitApplication(
      createInput({ answers: { isAvailable: true, noRecentDye: false } }),
      dependencies,
    );

    assertEquals(result.submissionState, "submitted");
    assertEquals(result.evaluation.eligible, true);
    assertEquals(result.evaluation.reviews[0]?.ruleId, "prefers-no-dye");
    assertEquals(persisted[0]?.rulesSnapshot[2]?.question, {
      en: "Have you avoided dyeing your hair in the past month?",
      ko: "최근 한 달 동안 염색하지 않았나요?",
    });
  },
);

registerTest(
  "rejects an unmet required condition without persistence",
  async () => {
    const opportunity = createOpportunity();
    opportunity.rulesetVersion = 2;
    opportunity.rules.push({
      id: "requires-length",
      field: "shoulderLength",
      operator: "equals",
      expected: true,
      effect: "hard_fail",
      reason: "어깨 아래 길이의 모델을 찾습니다.",
      question: {
        en: "Is your hair at least shoulder length?",
        ko: "현재 머리카락이 어깨 아래까지 내려오나요?",
      },
    });
    const { dependencies, persisted } = createDependencies(opportunity);

    const error = await expectSubmissionError(
      () =>
        submitApplication(
          createInput({
            answers: { isAvailable: true, shoulderLength: false },
          }),
          dependencies,
        ),
      "The application does not satisfy this opportunity's rules.",
    );

    assertEquals(error.status, 422);
    assertEquals(persisted.length, 0);
  },
);

registerTest(
  "reuses the attempt ID and canonical fingerprint across an exact retry",
  async () => {
    // Production break: regenerating an idempotency key or fingerprint turns response-loss retry into a duplicate write.
    const { dependencies, persisted } = createDependencies();

    await submitApplication(createInput(), dependencies);
    await submitApplication(createInput(), dependencies);
    await submitApplication(
      createInput({ futureOpportunityConsent: true }),
      dependencies,
    );

    assertEquals(persisted.length, 3);
    assertEquals(persisted[0]?.submissionAttemptId, submissionAttemptId);
    assertEquals(persisted[1]?.submissionAttemptId, submissionAttemptId);
    assertEquals(
      persisted[1]?.submissionFingerprint,
      persisted[0]?.submissionFingerprint,
    );
    const firstCommand = persisted[0];
    if (firstCommand === undefined) {
      throw new Error("Expected the first persistence command.");
    }
    const reorderedFingerprint = await createSubmissionFingerprint({
      opportunityId: firstCommand.opportunityId,
      submissionAttemptId: firstCommand.submissionAttemptId,
      applicant: firstCommand.applicant,
      answers: { isAvailable: true },
      currentApplicationConsent: firstCommand.currentApplicationConsent,
      futureOpportunityConsent: firstCommand.futureOpportunityConsent,
    });
    assertEquals(reorderedFingerprint, firstCommand.submissionFingerprint);
    if (
      persisted[2]?.submissionFingerprint ===
      persisted[0]?.submissionFingerprint
    ) {
      throw new Error(
        "Expected a changed authoritative payload to change the fingerprint.",
      );
    }
  },
);

registerTest(
  "returns the original receipt after response loss even when the opportunity closes",
  async () => {
    // Production break: checking close state before the attempt lookup makes an ambiguous retry lose its committed receipt.
    const first = createDependencies();
    const committed = await submitApplication(
      createInput(),
      first.dependencies,
    );
    const firstCommand = requireFirstCommand(first.persisted);
    const closedOpportunity = createOpportunity();
    closedOpportunity.closedAt = "2026-09-22T03:00:00.000Z";
    const retry = createDependencies(closedOpportunity, now, {
      existingAttempt: existingAttempt(firstCommand, committed.evaluation),
    });

    const recovered = await submitApplication(
      createInput(),
      retry.dependencies,
    );

    assertEquals(recovered, committed);
    assertEquals(retry.getOpportunityLoadCount(), 0);
    assertEquals(retry.persisted.length, 0);
  },
);

registerTest(
  "returns the original receipt after response loss even when rules change",
  async () => {
    // Production break: recomputing a retry against changed rules rejects an application that already committed.
    const first = createDependencies();
    const committed = await submitApplication(
      createInput(),
      first.dependencies,
    );
    const firstCommand = requireFirstCommand(first.persisted);
    const changedOpportunity = createOpportunity();
    changedOpportunity.rulesetVersion = 2;
    changedOpportunity.rules = [
      {
        id: "changed-schedule",
        field: "isAvailable",
        operator: "equals",
        expected: false,
        effect: "hard_fail",
        reason: "Rules changed after the original application.",
      },
    ];
    const retry = createDependencies(changedOpportunity, now, {
      existingAttempt: existingAttempt(firstCommand, committed.evaluation),
    });

    const recovered = await submitApplication(
      createInput(),
      retry.dependencies,
    );

    assertEquals(recovered, committed);
    assertEquals(retry.getOpportunityLoadCount(), 0);
    assertEquals(retry.persisted.length, 0);
  },
);

registerTest(
  "rejects changed submission intent before returning an existing receipt",
  async () => {
    // Production break: matching only the attempt ID lets changed personal data claim an earlier receipt.
    const first = createDependencies();
    const committed = await submitApplication(
      createInput(),
      first.dependencies,
    );
    const firstCommand = requireFirstCommand(first.persisted);
    const retry = createDependencies(createOpportunity(), now, {
      existingAttempt: existingAttempt(firstCommand, committed.evaluation),
    });

    const changedIntents = [
      {
        applicant: {
          displayName: "Changed applicant",
          phone: "010-9999-9999",
          birthDate: "2000-09-22",
        },
      },
      { answers: { isAvailable: false } },
      { futureOpportunityConsent: true },
    ];
    for (const changedIntent of changedIntents) {
      const error = await expectSubmissionError(
        () => submitApplication(createInput(changedIntent), retry.dependencies),
        "Submission attempt payload does not match the original application.",
      );
      assertEquals(error.status, 409);
    }

    assertEquals(retry.getOpportunityLoadCount(), 0);
    assertEquals(retry.persisted.length, 0);
  },
);

registerTest(
  "returns the stored evaluation when the database deduplicates a concurrent retry",
  async () => {
    // Production break: returning the request-time evaluation after an insert race can disagree with the committed receipt.
    const storedEvaluation = {
      rulesetId: "hair-promotion",
      rulesetVersion: 1,
      eligible: true,
      failures: [],
      reviews: [],
      reminders: [
        {
          ruleId: "stored-reminder",
          reason: "Stored evaluation from the winning transaction.",
          effect: "reminder" as const,
          input: true,
        },
      ],
    };
    const test = createDependencies(createOpportunity(), now, {
      persistenceResult: {
        applicationId,
        evaluation: storedEvaluation,
        submissionState: "submitted",
      },
    });

    const result = await submitApplication(createInput(), test.dependencies);

    assertEquals(result, {
      applicationId,
      evaluation: storedEvaluation,
      submissionState: "submitted",
    });
    assertEquals(test.persisted.length, 1);
  },
);

registerTest(
  "rejects an application after the opportunity closes",
  async () => {
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
  },
);

function assertEquals(actual: unknown, expected: unknown): void {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  if (actualJson !== expectedJson) {
    throw new Error(`Expected ${expectedJson}, received ${actualJson}.`);
  }
}

function assertMatches(value: unknown, pattern: RegExp, label: string): void {
  if (typeof value !== "string" || !pattern.test(value)) {
    throw new Error(
      `Expected ${label} to match ${pattern}, received ${String(value)}.`,
    );
  }
}

function requireFirstCommand(
  persisted: ApplicationPersistenceCommand[],
): ApplicationPersistenceCommand {
  const command = persisted[0];
  if (command === undefined) {
    throw new Error("Expected a persisted application command.");
  }
  return command;
}

function existingAttempt(
  command: ApplicationPersistenceCommand,
  evaluation: ApplicationPersistenceResult["evaluation"],
): ExistingApplicationAttempt {
  return {
    applicationId,
    submissionFingerprint: command.submissionFingerprint,
    evaluation,
    submissionState: command.submissionState,
  };
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
