import { z } from "zod";
import type {
  AnswerValue,
  EvaluationResult,
} from "../../eligibility/domain/types.ts";

export interface SubmitApplicationInput {
  opportunityId: string;
  submissionAttemptId: string;
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

const ruleOutcomeSchema = z
  .object({
    ruleId: z.string().min(1),
    reason: z.string().min(1),
    effect: z.enum(["hard_fail", "needs_review", "reminder"]),
    input: answerValueSchema,
  })
  .strip();

const evaluationResultSchema = z
  .object({
    rulesetId: z.string().min(1),
    rulesetVersion: z.number().int().positive(),
    eligible: z.boolean(),
    failures: z.array(ruleOutcomeSchema),
    reviews: z.array(ruleOutcomeSchema),
    reminders: z.array(ruleOutcomeSchema),
  })
  .strip();

export const submitApplicationInputSchema = z
  .object({
    opportunityId: z
      .string()
      .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i),
    submissionAttemptId: z
      .string()
      .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i),
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

export function isEvaluationResult(input: unknown): input is EvaluationResult {
  return evaluationResultSchema.safeParse(input).success;
}
