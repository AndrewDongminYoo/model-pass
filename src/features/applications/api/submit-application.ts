import { getSupabaseClient } from "../../../lib/supabase/client";
import type {
  SubmitApplicationInput,
  SubmitApplicationResult,
} from "../domain/application";

export async function submitApplication(
  input: SubmitApplicationInput,
): Promise<SubmitApplicationResult> {
  const { data, error } = await getSupabaseClient().functions.invoke(
    "submit-application",
    { body: input },
  );

  if (error !== null) {
    throw error;
  }
  if (!isSubmitApplicationResult(data)) {
    throw new Error("The application response is invalid.");
  }

  return data;
}

export function isSubmitApplicationResult(
  value: unknown,
): value is SubmitApplicationResult {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const result = value as Partial<SubmitApplicationResult>;
  const evaluation = result.evaluation;
  return (
    typeof result.applicationId === "string" &&
    typeof evaluation === "object" &&
    evaluation !== null &&
    typeof evaluation.rulesetId === "string" &&
    evaluation.rulesetId.length > 0 &&
    Number.isInteger(evaluation.rulesetVersion) &&
    evaluation.rulesetVersion > 0 &&
    typeof evaluation.eligible === "boolean" &&
    Array.isArray(evaluation.failures) &&
    Array.isArray(evaluation.reviews) &&
    Array.isArray(evaluation.reminders)
  );
}
