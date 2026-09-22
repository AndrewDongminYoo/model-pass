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

function isSubmitApplicationResult(
  value: unknown,
): value is SubmitApplicationResult {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const result = value as Partial<SubmitApplicationResult>;
  return (
    typeof result.applicationId === "string" &&
    typeof result.evaluation === "object" &&
    result.evaluation !== null &&
    typeof result.evaluation.eligible === "boolean"
  );
}
