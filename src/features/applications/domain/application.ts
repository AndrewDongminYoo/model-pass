import { z } from "zod";
import type {
  AnswerValue,
  EvaluationResult,
} from "../../eligibility/domain/types";

export interface SubmitApplicationInput {
  opportunityId: string;
  applicant: {
    displayName: string;
    phone: string;
    birthDate: string;
  };
  answers: Record<string, AnswerValue>;
  currentApplicationConsent: true;
  futureOpportunityConsent: boolean;
}

export interface SubmitApplicationResult {
  applicationId: string;
  evaluation: EvaluationResult;
}

const answerValueSchema = z.union([
  z.string().max(1_000),
  z.number(),
  z.boolean(),
  z.null(),
]);

export const submitApplicationInputSchema = z
  .object({
    opportunityId: z
      .string()
      .regex(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      ),
    applicant: z
      .object({
        displayName: z.string().trim().min(1).max(100),
        phone: z.string().trim().min(1).max(32),
        birthDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      })
      .strip(),
    answers: z
      .record(z.string().min(1).max(100), answerValueSchema)
      .refine((answers) => Object.keys(answers).length <= 50),
    currentApplicationConsent: z.literal(true),
    futureOpportunityConsent: z.boolean(),
  })
  .strip();

export function parseSubmitApplicationInput(
  input: unknown,
): SubmitApplicationInput {
  return submitApplicationInputSchema.parse(input);
}
