import { FunctionsHttpError } from "@supabase/supabase-js";
import { getSupabaseClient } from "../../../lib/supabase/client";

export interface ApplicationReceipt {
  applicationId: string;
  submissionAttemptId: string;
}

export type ApplicationResolution =
  { status: "found"; opportunityId: string } | { status: "not_found" };

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Finds the opportunity for a receipt. The server answers every miss the same
// way, and every later call re-validates the full capability.
export async function resolveApplication(
  receipt: ApplicationReceipt,
): Promise<ApplicationResolution> {
  const { data, error } = await getSupabaseClient().functions.invoke(
    "resolve-application",
    { body: receipt },
  );
  if (error !== null) {
    if (
      error instanceof FunctionsHttpError &&
      error.context instanceof Response &&
      error.context.status === 404
    ) {
      return { status: "not_found" };
    }
    throw error;
  }
  const opportunityId = (data as { opportunityId?: unknown } | null)
    ?.opportunityId;
  if (typeof opportunityId !== "string" || !uuidPattern.test(opportunityId)) {
    throw new Error("The application lookup response is invalid.");
  }
  return { status: "found", opportunityId };
}
