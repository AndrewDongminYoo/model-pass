import { evaluateRules } from "./evaluate-rules";
import { parseRuleDefinitions, type RuleDefinition } from "./types";

describe("evaluateRules", () => {
  describe("when hard failures and reminders both fail", () => {
    // Production break: treating a failed hard rule as eligible or discarding a failed reminder.
    it("returns the declared outcomes in their separate buckets", () => {
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
          id: "remove-lenses",
          field: "wearsLenses",
          operator: "equals",
          expected: false,
          effect: "reminder",
          reason: "Remove lenses before the appointment.",
        },
      ];

      expect(
        evaluateRules({ isAdult: false, wearsLenses: true }, rules),
      ).toEqual({
        eligible: false,
        failures: [
          {
            ruleId: "adult-only",
            reason: "This pilot is available to adults only.",
          },
        ],
        reviews: [],
        reminders: [
          {
            ruleId: "remove-lenses",
            reason: "Remove lenses before the appointment.",
          },
        ],
      });
    });
  });

  describe("when an operator predicate fails", () => {
    // Production break: omitting an operator branch or treating a missing answer as a passing answer.
    it.each([
      [
        "not_equals",
        "red",
        "red",
        "hard_fail",
        "The selected color is unavailable.",
        "failures",
      ],
      [
        "one_of",
        "short",
        ["medium", "long"],
        "needs_review",
        "A recruiter must review the current length.",
        "reviews",
      ],
      [
        "none_of",
        "bleached",
        ["bleached", "permed"],
        "reminder",
        "Confirm the current style before arrival.",
        "reminders",
      ],
      [
        "minimum",
        17,
        19,
        "hard_fail",
        "This pilot is available to adults only.",
        "failures",
      ],
      [
        "maximum",
        75,
        60,
        "needs_review",
        "A recruiter must review the requested duration.",
        "reviews",
      ],
    ] as const)(
      "places a failed %s predicate under its declared effect",
      (operator, answer, expected, effect, reason, bucket) => {
        const rule = {
          id: `${operator}-rule`,
          field: "answer",
          operator,
          expected,
          effect,
          reason,
        } as RuleDefinition;

        const result = evaluateRules({ answer }, [rule]);

        expect(result[bucket]).toEqual([
          { ruleId: `${operator}-rule`, reason },
        ]);
        expect(result.eligible).toBe(effect !== "hard_fail");
      },
    );

    // Production break: allowing an unanswered required condition to silently pass.
    it("places a missing answer under the rule's declared effect", () => {
      const rule: RuleDefinition = {
        id: "availability",
        field: "isAvailable",
        operator: "equals",
        expected: true,
        effect: "needs_review",
        reason: "Confirm availability with the recruiter.",
      };

      expect(evaluateRules({}, [rule])).toEqual({
        eligible: true,
        failures: [],
        reviews: [
          {
            ruleId: "availability",
            reason: "Confirm availability with the recruiter.",
          },
        ],
        reminders: [],
      });
    });
  });

  describe("when an operator predicate passes", () => {
    // Production break: making a supported operator always fail, which rejects otherwise eligible applicants.
    it.each([
      ["not_equals", "blue", "red"],
      ["one_of", "medium", ["medium", "long"]],
      ["none_of", "natural", ["bleached", "permed"]],
      ["minimum", 19, 19],
      ["maximum", 60, 60],
    ] as const)(
      "does not add an outcome for a passing %s predicate",
      (operator, answer, expected) => {
        const rule = {
          id: `${operator}-rule`,
          field: "answer",
          operator,
          expected,
          effect: "hard_fail",
          reason: "This should not be returned.",
        } as RuleDefinition;

        expect(evaluateRules({ answer }, [rule])).toEqual({
          eligible: true,
          failures: [],
          reviews: [],
          reminders: [],
        });
      },
    );
  });

  describe("when returning evaluation evidence", () => {
    // Production break: returning mutable result objects that can be altered before persistence.
    it("returns a frozen result and frozen outcome collections", () => {
      const result = evaluateRules({ isAdult: false }, [
        {
          id: "adult-only",
          field: "isAdult",
          operator: "equals",
          expected: true,
          effect: "hard_fail",
          reason: "This pilot is available to adults only.",
        },
      ]);

      expect(Object.isFrozen(result)).toBe(true);
      expect(Object.isFrozen(result.failures)).toBe(true);
      expect(Object.isFrozen(result.failures[0])).toBe(true);
      expect(Object.isFrozen(result.reviews)).toBe(true);
      expect(Object.isFrozen(result.reminders)).toBe(true);
    });
  });

  describe("parseRuleDefinitions", () => {
    // Production break: omitting runtime validation so untrusted rules cannot be parsed into the domain contract.
    it("parses a supported rule definition", () => {
      expect(
        parseRuleDefinitions([
          {
            id: "adult-only",
            field: "isAdult",
            operator: "equals",
            expected: true,
            effect: "hard_fail",
            reason: "This pilot is available to adults only.",
          },
        ]),
      ).toEqual([
        {
          id: "adult-only",
          field: "isAdult",
          operator: "equals",
          expected: true,
          effect: "hard_fail",
          reason: "This pilot is available to adults only.",
        },
      ]);
    });

    // Production break: accepting an unimplemented operator and silently treating it as a pass.
    it("rejects an unknown operator", () => {
      expect(() =>
        parseRuleDefinitions([
          {
            id: "unsupported",
            field: "answer",
            operator: "contains",
            expected: "value",
            effect: "hard_fail",
            reason: "Unsupported operators must not pass.",
          },
        ]),
      ).toThrow();
    });
  });
});
