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
    context.addIssue({ code: "custom", message: "Rules must be valid." });
    return z.NEVER;
  }
});

export const opportunityDraftSchema = z
  .object({
    category: z.enum(["hair_promotion", "makeup_certification"]),
    title: z.string().trim().min(1, "Enter the procedure."),
    startsAt: z
      .string()
      .min(1, "Enter the start date.")
      .refine(isFutureDate, "Start date must be in the future."),
    closesAt: z
      .string()
      .min(1, "Enter the closing date.")
      .refine(isFutureDate, "Closing date must be in the future."),
    venueDistrict: z.string().trim().min(1, "Enter the venue district."),
    expectedMinutes: z.coerce
      .number()
      .int()
      .positive("Enter the expected duration."),
    benefit: z.discriminatedUnion("type", [
      z.object({
        type: z.literal("cash"),
        amount: z.coerce.number().positive("Enter the cash amount."),
        description: z.string().trim().min(1, "Enter the benefit description."),
      }),
      z.object({
        type: z.literal("procedure"),
        description: z.string().trim().min(1, "Enter the benefit description."),
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
        message: "Closing date must be before the start date.",
        path: ["closesAt"],
      });
    }
  });

export function validateOpportunityDraft(input: unknown): OpportunityDraft {
  return opportunityDraftSchema.parse(input);
}
