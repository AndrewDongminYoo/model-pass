import { FunctionsHttpError } from "@supabase/supabase-js";
import { getSupabaseClient } from "../../../lib/supabase/client.ts";
import type { EvaluationResult } from "../../eligibility/domain/types.ts";
import type {
  ApplicationSubmissionResult,
  SubmitApplicationInput,
} from "../domain/application.ts";
import {
  isEvaluationResult,
  isSubmitApplicationResult,
} from "../domain/application.ts";

export type {
  ApplicationSubmissionResult,
  ApplicationSubmissionState,
} from "../domain/application.ts";
export { isSubmitApplicationResult } from "../domain/application.ts";

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
): Promise<ApplicationSubmissionResult> {
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
