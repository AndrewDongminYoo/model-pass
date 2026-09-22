import { z } from "zod";

export type RuleEffect = "hard_fail" | "needs_review" | "reminder";

export type AnswerValue = string | number | boolean | null;

export type RuleOperator =
  "equals" | "not_equals" | "one_of" | "none_of" | "minimum" | "maximum";

interface BaseRuleDefinition {
  id: string;
  field: string;
  effect: RuleEffect;
  reason: string;
}

export type RuleDefinition =
  | (BaseRuleDefinition & {
      operator: "equals" | "not_equals";
      expected: AnswerValue;
    })
  | (BaseRuleDefinition & {
      operator: "one_of" | "none_of";
      expected: readonly AnswerValue[];
    })
  | (BaseRuleDefinition & {
      operator: "minimum" | "maximum";
      expected: number;
    });

export interface RuleOutcome {
  ruleId: string;
  reason: string;
  effect: RuleEffect;
  input: AnswerValue;
}

export interface EvaluationContext {
  rulesetId: string;
  rulesetVersion: number;
}

export interface EvaluationResult {
  readonly rulesetId: string;
  readonly rulesetVersion: number;
  readonly eligible: boolean;
  readonly failures: readonly RuleOutcome[];
  readonly reviews: readonly RuleOutcome[];
  readonly reminders: readonly RuleOutcome[];
}

export type Answers = Readonly<Record<string, AnswerValue | undefined>>;

const answerValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
]);

const baseRuleDefinitionSchema = z.object({
  id: z.string(),
  field: z.string(),
  effect: z.enum(["hard_fail", "needs_review", "reminder"]),
  reason: z.string(),
});

const ruleDefinitionSchema = z.discriminatedUnion("operator", [
  baseRuleDefinitionSchema.extend({
    operator: z.literal("equals"),
    expected: answerValueSchema,
  }),
  baseRuleDefinitionSchema.extend({
    operator: z.literal("not_equals"),
    expected: answerValueSchema,
  }),
  baseRuleDefinitionSchema.extend({
    operator: z.literal("one_of"),
    expected: z.array(answerValueSchema),
  }),
  baseRuleDefinitionSchema.extend({
    operator: z.literal("none_of"),
    expected: z.array(answerValueSchema),
  }),
  baseRuleDefinitionSchema.extend({
    operator: z.literal("minimum"),
    expected: z.number(),
  }),
  baseRuleDefinitionSchema.extend({
    operator: z.literal("maximum"),
    expected: z.number(),
  }),
]);

export function parseRuleDefinitions(input: unknown): RuleDefinition[] {
  return z.array(ruleDefinitionSchema).parse(input);
}
