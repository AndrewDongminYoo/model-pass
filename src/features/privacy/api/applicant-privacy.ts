import { getSupabaseClient } from "../../../lib/supabase/client";

export interface ApplicantCapability {
  applicationId: string;
  opportunityId: string;
  submissionAttemptId: string;
}

export type ApplicantPrivacyCommand = ApplicantCapability &
  (
    | { action: "revoke_future_opportunity_consent" }
    | { action: "request_deletion" }
  );

export type ApplicantPrivacyResult =
  | { action: "revoke_future_opportunity_consent"; status: "accepted" }
  | { action: "request_deletion"; status: "pending" };

export async function manageApplicantPrivacy(
  command: ApplicantPrivacyCommand,
): Promise<ApplicantPrivacyResult> {
  const { data, error } = await getSupabaseClient().functions.invoke(
    "manage-applicant-privacy",
    { body: command },
  );
  if (error !== null) throw error;
  if (!isApplicantPrivacyResult(data)) {
    throw new Error("The applicant privacy response is invalid.");
  }
  return data;
}

function isApplicantPrivacyResult(
  value: unknown,
): value is ApplicantPrivacyResult {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const result = value as Record<string, unknown>;
  return (
    Object.keys(result).length === 2 &&
    ((result.action === "revoke_future_opportunity_consent" &&
      result.status === "accepted") ||
      (result.action === "request_deletion" && result.status === "pending"))
  );
}
