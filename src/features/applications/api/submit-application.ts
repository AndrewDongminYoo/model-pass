import { FunctionsHttpError } from "@supabase/supabase-js";
import { getSupabaseClient } from "../../../lib/supabase/client";
import type { EvaluationResult } from "../../eligibility/domain/types";
import type {
  SubmitApplicationInput,
  SubmitApplicationResult,
} from "../domain/application";
import { isEvaluationResult } from "../domain/application";

export class ApplicationSubmissionError extends Error {
  constructor(
    message: string,
    readonly evaluation?: EvaluationResult,
  ) {
    super(message);
    this.name = "ApplicationSubmissionError";
  }
}

export async function submitApplication(
  input: SubmitApplicationInput,
): Promise<SubmitApplicationResult> {
  const { data, error } = await getSupabaseClient().functions.invoke(
    "submit-application",
    { body: input },
  );

  if (error !== null) {
    const submissionError = await parseApplicationSubmissionHttpError(error);
    if (submissionError !== null) {
      throw submissionError;
    }
    throw error;
  }
  if (!isSubmitApplicationResult(data)) {
    throw new Error("The application response is invalid.");
  }

  return data;
}

export async function parseApplicationSubmissionHttpError(
  error: unknown,
): Promise<ApplicationSubmissionError | null> {
  if (
    !(error instanceof FunctionsHttpError) ||
    !(error.context instanceof Response)
  ) {
    return null;
  }

  try {
    const body: unknown = await error.context.json();
    if (typeof body !== "object" || body === null) {
      return null;
    }

    const response = body as { error?: unknown; evaluation?: unknown };
    if (
      typeof response.error !== "string" ||
      response.error.length === 0 ||
      response.error.length > 500
    ) {
      return null;
    }
    if (
      response.evaluation !== undefined &&
      !isEvaluationResult(response.evaluation)
    ) {
      return null;
    }

    return new ApplicationSubmissionError(
      response.error,
      response.evaluation as EvaluationResult | undefined,
    );
  } catch {
    return null;
  }
}

export function isSubmitApplicationResult(
  value: unknown,
): value is SubmitApplicationResult {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const result = value as Partial<SubmitApplicationResult>;
  return (
    typeof result.applicationId === "string" &&
    isEvaluationResult(result.evaluation)
  );
}
