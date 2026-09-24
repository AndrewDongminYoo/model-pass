import { z } from "zod";
import {
  hairPromotionV2Locked,
  hairPromotionV2Metadata,
} from "../templates/hair-promotion-v2.ts";
import {
  makeupCertificationV2Locked,
  makeupCertificationV2Metadata,
} from "../templates/makeup-certification-v2.ts";
import { parseRuleDefinitions, type RuleDefinition } from "./types.ts";

export const editableConditionSchema = z
  .object({
    id: z.string().trim().min(1),
    field: z.string().trim().min(1),
    question: z.object({ en: z.string(), ko: z.string() }).strict(),
    expected: z.boolean(),
    effect: z.enum(["hard_fail", "needs_review"]),
  })
  .strict();

export type EditableCondition = z.infer<typeof editableConditionSchema>;

const buildInputSchema = z
  .object({
    category: z.enum(["hair_promotion", "makeup_certification"]),
    rulesetVersion: z.number().int(),
    conditions: z.array(editableConditionSchema).max(20),
    requiredModelSex: z.enum(["female", "male"]).optional(),
  })
  .strict();

export type BuildOpportunityRulesInput = z.infer<typeof buildInputSchema>;

const reservedConditionFields = new Set(
  [...hairPromotionV2Locked, ...makeupCertificationV2Locked("female")].map(
    (rule) => rule.field,
  ),
);

export function buildOpportunityRules(
  input: BuildOpportunityRulesInput,
): RuleDefinition[] {
  const parsed = buildInputSchema.parse(input);
  if (parsed.rulesetVersion !== 2) {
    throw new Error("Template version is not current.");
  }
  if (parsed.category === "makeup_certification" && !parsed.requiredModelSex) {
    throw new Error("Required model sex is missing.");
  }

  const locked =
    parsed.category === "hair_promotion"
      ? hairPromotionV2Locked.map((rule) => ({ ...rule }))
      : makeupCertificationV2Locked(parsed.requiredModelSex!);
  const ids = new Set(locked.map((rule) => rule.id));
  const fields = new Set(locked.map((rule) => rule.field));
  const editable: RuleDefinition[] = [];

  for (const condition of parsed.conditions) {
    if (
      !/^[A-Za-z][A-Za-z0-9]*$/.test(condition.field) ||
      condition.field in Object.prototype ||
      condition.field.toLowerCase().includes("photo") ||
      reservedConditionFields.has(condition.field)
    ) {
      throw new Error("Condition field is invalid.");
    }
    const question = condition.question;
    if (
      question.en.trim().length === 0 ||
      question.ko.trim().length === 0 ||
      question.en !== question.ko ||
      question.ko.length > 200
    ) {
      throw new Error("Condition question is required.");
    }
    if (ids.has(condition.id)) {
      throw new Error("Duplicate condition ID.");
    }
    if (fields.has(condition.field)) {
      throw new Error("Duplicate condition field.");
    }
    ids.add(condition.id);
    fields.add(condition.field);
    editable.push({
      id: condition.id,
      field: condition.field,
      operator: "equals",
      expected: condition.expected,
      effect: condition.effect,
      reason: question.ko,
      question: { en: question.en, ko: question.ko },
    });
  }

  return [...locked, ...editable];
}

export function assertCanonicalOpportunityRules(input: {
  category: BuildOpportunityRulesInput["category"];
  rulesetId: string;
  rulesetVersion: number;
  conditions: BuildOpportunityRulesInput["conditions"];
  requiredModelSex?: BuildOpportunityRulesInput["requiredModelSex"];
  rules: unknown;
}): RuleDefinition[] {
  const currentRulesetId =
    input.category === "hair_promotion"
      ? hairPromotionV2Metadata.id
      : makeupCertificationV2Metadata.id;
  if (input.rulesetId !== currentRulesetId) {
    throw new Error("Template version is not current.");
  }
  const canonical = buildOpportunityRules({
    category: input.category,
    rulesetVersion: input.rulesetVersion,
    conditions: input.conditions,
    requiredModelSex: input.requiredModelSex,
  });
  const supplied = parseRuleDefinitions(input.rules);
  if (
    supplied.length !== canonical.length ||
    canonical.some((rule, index) => !sameRule(rule, supplied[index]))
  ) {
    throw new Error("Published rules do not match the preview.");
  }
  return canonical;
}

function sameRule(
  left: RuleDefinition,
  right: RuleDefinition | undefined,
): boolean {
  if (right === undefined) return false;
  return (
    left.id === right.id &&
    left.field === right.field &&
    left.operator === right.operator &&
    JSON.stringify(left.expected) === JSON.stringify(right.expected) &&
    left.effect === right.effect &&
    left.reason === right.reason &&
    left.question?.en === right.question?.en &&
    left.question?.ko === right.question?.ko
  );
}
