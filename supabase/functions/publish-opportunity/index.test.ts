import type { RuleDefinition } from "../../../src/features/eligibility/domain/types.ts";
import { buildOpportunityRules } from "../../../src/features/eligibility/domain/opportunity-conditions.ts";
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
const hardRuleIds = ["adult-only", "schedule-available"];

const explicitHairRules: RuleDefinition[] = [
  {
    id: "adult-only",
    field: "isAdult",
    operator: "equals",
    expected: true,
    effect: "hard_fail",
    reason: "This pilot is available to adults only.",
    question: {
      en: "Are you at least 19 years old?",
      ko: "만 19세 이상인가요?",
    },
  },
  {
    id: "schedule-available",
    field: "isAvailable",
    operator: "equals",
    expected: true,
    effect: "hard_fail",
    reason: "This schedule is unavailable.",
    question: {
      en: "Can you attend at the listed time?",
      ko: "공고에 적힌 일시에 참여할 수 있나요?",
    },
  },
  {
    id: "hair-condition-photo-clear",
    field: "hairConditionPhotoIsClear",
    operator: "equals",
    expected: true,
    effect: "needs_review",
    reason: "A recruiter must review the hair-condition photo.",
  },
  {
    id: "current-length",
    field: "meetsCurrentLengthRequirement",
    operator: "equals",
    expected: true,
    effect: "needs_review",
    reason: "현재 머리가 어깨 아래까지 오나요?",
    question: {
      en: "현재 머리가 어깨 아래까지 오나요?",
      ko: "현재 머리가 어깨 아래까지 오나요?",
    },
  },
];

const explicitHairCondition = {
  id: "current-length",
  field: "meetsCurrentLengthRequirement",
  question: {
    en: "현재 머리가 어깨 아래까지 오나요?",
    ko: "현재 머리가 어깨 아래까지 오나요?",
  },
  expected: true,
  effect: "needs_review",
};

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
      rulesetVersion: 2,
      conditions: [explicitHairCondition],
      rules: explicitHairRules,
    },
    confirmedHardRuleIds: hardRuleIds,
    ...overrides,
  };
}

function createExplicitInput(rules: RuleDefinition[] = explicitHairRules) {
  const input = createInput();
  return {
    ...input,
    draft: {
      ...input.draft,
      rulesetVersion: 2,
      conditions: [explicitHairCondition],
      rules,
    },
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

registerTest(
  "rejects a published preview that changes the adult-only rule",
  async () => {
    const { dependencies, persisted } = createDependencies(recruiterId);
    const rules = structuredClone(explicitHairRules);
    const adultRule = rules.find((rule) => rule.id === "adult-only");
    if (adultRule === undefined || adultRule.operator !== "equals") {
      throw new Error("Adult rule fixture is missing.");
    }
    adultRule.expected = false;
    const response = await createPublishOpportunityHandler(dependencies)(
      new Request("http://localhost/functions/v1/publish-opportunity", {
        method: "POST",
        headers: {
          Authorization: "Bearer recruiter-token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(createExplicitInput(rules)),
      }),
    );

    assertEquals(response.status, 400);
    assertEquals(
      (await response.json()).error,
      "Opportunity conditions are invalid.",
    );
    assertEquals(persisted.length, 0);
  },
);

registerTest("rejects a stale publication template", async () => {
  const { dependencies, persisted } = createDependencies(recruiterId);
  const input = createInput();
  const response = await createPublishOpportunityHandler(dependencies)(
    new Request("http://localhost/functions/v1/publish-opportunity", {
      method: "POST",
      headers: {
        Authorization: "Bearer recruiter-token",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ...input,
        draft: { ...input.draft, rulesetVersion: 1 },
      }),
    }),
  );

  assertEquals(response.status, 400);
  assertEquals(
    (await response.json()).error,
    "Opportunity conditions are invalid.",
  );
  assertEquals(persisted.length, 0);
});

registerTest("rejects a 2027 makeup date under the 2026 ruleset", async () => {
  const { dependencies, persisted } = createDependencies(recruiterId);
  const input = createInput();
  const rules = buildOpportunityRules({
    category: "makeup_certification",
    rulesetVersion: 2,
    requiredModelSex: "female",
    conditions: [],
  });
  const response = await createPublishOpportunityHandler(dependencies)(
    new Request("http://localhost/functions/v1/publish-opportunity", {
      method: "POST",
      headers: {
        Authorization: "Bearer recruiter-token",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ...input,
        draft: {
          ...input.draft,
          category: "makeup_certification",
          rulesetId: "makeup-certification",
          requiredModelSex: "female",
          conditions: [],
          rules,
          startsAt: "2027-01-01T00:00:00.000Z",
          closesAt: "2026-12-31T00:00:00.000Z",
        },
        confirmedHardRuleIds: rules
          .filter((rule) => rule.effect === "hard_fail")
          .map((rule) => rule.id),
      }),
    }),
  );

  assertEquals(response.status, 400);
  assertEquals(persisted.length, 0);
});

registerTest(
  "publishes the 2026 makeup template with a recruiter-specified sex",
  async () => {
    const { dependencies, persisted } = createDependencies(recruiterId);
    const input = createInput();
    const rules = buildOpportunityRules({
      category: "makeup_certification",
      rulesetVersion: 2,
      requiredModelSex: "female",
      conditions: [],
    });
    const response = await createPublishOpportunityHandler(dependencies)(
      new Request("http://localhost/functions/v1/publish-opportunity", {
        method: "POST",
        headers: {
          Authorization: "Bearer recruiter-token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ...input,
          draft: {
            ...input.draft,
            category: "makeup_certification",
            rulesetId: "makeup-certification",
            startsAt: "2026-12-01T10:00:00.000Z",
            closesAt: "2026-11-30T10:00:00.000Z",
            requiredModelSex: "female",
            conditions: [],
            rules,
          },
          confirmedHardRuleIds: rules
            .filter((rule) => rule.effect === "hard_fail")
            .map((rule) => rule.id),
        }),
      }),
    );

    assertEquals(response.status, 201);
    assertEquals(
      persisted[0]?.draft.rules.some(
        (rule) =>
          rule.field === "hasEyelashExtensions" &&
          rule.effect === "needs_review",
      ),
      true,
    );
  },
);

registerTest(
  "rejects a makeup preview that changes a deduction item into a hard failure",
  async () => {
    const { dependencies, persisted } = createDependencies(recruiterId);
    const input = createInput();
    const rules = buildOpportunityRules({
      category: "makeup_certification",
      rulesetVersion: 2,
      requiredModelSex: "female",
      conditions: [],
    });
    const tamperedRules = rules.map((rule) =>
      rule.field === "hasEyelashExtensions"
        ? { ...rule, effect: "hard_fail" as const }
        : rule,
    );
    const response = await createPublishOpportunityHandler(dependencies)(
      new Request("http://localhost/functions/v1/publish-opportunity", {
        method: "POST",
        headers: {
          Authorization: "Bearer recruiter-token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ...input,
          draft: {
            ...input.draft,
            category: "makeup_certification",
            rulesetId: "makeup-certification",
            startsAt: "2026-12-01T10:00:00.000Z",
            closesAt: "2026-11-30T10:00:00.000Z",
            requiredModelSex: "female",
            conditions: [],
            rules: tamperedRules,
          },
          confirmedHardRuleIds: tamperedRules
            .filter((rule) => rule.effect === "hard_fail")
            .map((rule) => rule.id),
        }),
      }),
    );

    assertEquals(response.status, 400);
    assertEquals(persisted.length, 0);
  },
);

registerTest("rejects a hidden extra condition in the preview", async () => {
  const { dependencies, persisted } = createDependencies(recruiterId);
  const response = await createPublishOpportunityHandler(dependencies)(
    new Request("http://localhost/functions/v1/publish-opportunity", {
      method: "POST",
      headers: {
        Authorization: "Bearer recruiter-token",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(
        createExplicitInput([
          ...explicitHairRules,
          {
            id: "hidden-condition",
            field: "hiddenCondition",
            operator: "equals",
            expected: true,
            effect: "hard_fail",
            reason: "Not authored in the editor.",
          },
        ]),
      ),
    }),
  );

  assertEquals(response.status, 400);
  assertEquals(
    (await response.json()).error,
    "Opportunity conditions are invalid.",
  );
  assertEquals(persisted.length, 0);
});

registerTest(
  "rejects forged fields that applicants cannot answer",
  async () => {
    const { dependencies, persisted } = createDependencies(recruiterId);
    const editableRule = explicitHairRules[3];
    if (editableRule === undefined)
      throw new Error("Custom rule fixture is missing.");

    for (const field of ["customPhotoEvidence", "isWithinMakeupAgeLimit"]) {
      const input = createInput();
      const response = await createPublishOpportunityHandler(dependencies)(
        new Request("http://localhost/functions/v1/publish-opportunity", {
          method: "POST",
          headers: {
            Authorization: "Bearer recruiter-token",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            ...input,
            draft: {
              ...input.draft,
              conditions: [{ ...explicitHairCondition, field }],
              rules: [
                ...explicitHairRules.slice(0, 3),
                { ...editableRule, field },
              ],
            },
          }),
        }),
      );

      assertEquals(response.status, 400);
      assertEquals(
        (await response.json()).error,
        "Opportunity conditions are invalid.",
      );
    }
    assertEquals(persisted.length, 0);
  },
);

registerTest(
  "rejects a custom condition missing its published question",
  async () => {
    const { dependencies, persisted } = createDependencies(recruiterId);
    const rules = structuredClone(explicitHairRules);
    const customRule = rules.find((rule) => rule.id === "current-length");
    if (customRule === undefined) {
      throw new Error("Custom rule fixture is missing.");
    }
    delete customRule.question;
    const response = await createPublishOpportunityHandler(dependencies)(
      new Request("http://localhost/functions/v1/publish-opportunity", {
        method: "POST",
        headers: {
          Authorization: "Bearer recruiter-token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(createExplicitInput(rules)),
      }),
    );

    assertEquals(response.status, 400);
    assertEquals(
      (await response.json()).error,
      "Opportunity conditions are invalid.",
    );
    assertEquals(persisted.length, 0);
  },
);

registerTest("publishes a validated version-two hair snapshot", async () => {
  const { dependencies, persisted } = createDependencies(recruiterId);
  const response = await createPublishOpportunityHandler(dependencies)(
    new Request("http://localhost/functions/v1/publish-opportunity", {
      method: "POST",
      headers: {
        Authorization: "Bearer recruiter-token",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(createExplicitInput()),
    }),
  );

  assertEquals(response.status, 201);
  assertEquals(persisted.length, 1);
  assertEquals(persisted[0]?.draft.rules, explicitHairRules);
});

function assertEquals(actual: unknown, expected: unknown): void {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  if (actualJson !== expectedJson) {
    throw new Error(`Expected ${expectedJson}, received ${actualJson}.`);
  }
}
