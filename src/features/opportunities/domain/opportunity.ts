import { z } from "zod";
import {
  parseRuleDefinitions,
  type RuleDefinition,
} from "../../eligibility/domain/types";

export type OpportunityCategory = "hair_promotion" | "makeup_certification";

export type Compensation =
  | { type: "cash"; amount: number; description: string }
  | { type: "procedure"; description: string };

export interface OpportunityDraft {
  category: OpportunityCategory;
  title: string;
  startsAt: string;
  closesAt: string;
  venueDistrict: string;
  expectedMinutes: number;
  benefit: Compensation;
  rulesetId: string;
  rulesetVersion: number;
  rules: RuleDefinition[];
}

function isFutureDate(value: string) {
  const timestamp = Date.parse(value);
  return !Number.isNaN(timestamp) && timestamp > Date.now();
}

const rulesSchema = z.array(z.unknown()).transform((rules, context) => {
  try {
    return parseRuleDefinitions(rules);
  } catch {
    context.addIssue({ code: "custom", message: "rules_invalid" });
    return z.NEVER;
  }
});

export const opportunityDraftSchema = z
  .object({
    category: z.enum(["hair_promotion", "makeup_certification"]),
    title: z.string().trim().min(1, "title_required"),
    startsAt: z
      .string()
      .min(1, "starts_at_required")
      .refine(isFutureDate, "starts_at_future"),
    closesAt: z
      .string()
      .min(1, "closes_at_required")
      .refine(isFutureDate, "closes_at_future"),
    venueDistrict: z.string().trim().min(1, "venue_district_required"),
    expectedMinutes: z.coerce
      .number()
      .int()
      .positive("expected_minutes_required"),
    benefit: z.discriminatedUnion("type", [
      z.object({
        type: z.literal("cash"),
        amount: z.coerce.number().positive("cash_amount_required"),
        description: z.string().trim().min(1, "benefit_description_required"),
      }),
      z.object({
        type: z.literal("procedure"),
        description: z.string().trim().min(1, "benefit_description_required"),
      }),
    ]),
    rulesetId: z.string().min(1),
    rulesetVersion: z.number().int().positive(),
    rules: rulesSchema,
  })
  .superRefine(({ closesAt, startsAt }, context) => {
    if (Date.parse(closesAt) >= Date.parse(startsAt)) {
      context.addIssue({
        code: "custom",
        message: "closes_at_before_starts_at",
        path: ["closesAt"],
      });
    }
  });

export function validateOpportunityDraft(input: unknown): OpportunityDraft {
  return opportunityDraftSchema.parse(input);
}
