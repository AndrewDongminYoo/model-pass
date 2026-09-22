import { getSupabaseClient } from "../../../lib/supabase/client";
import type { OpportunityDraft } from "../domain/opportunity";

export interface OpportunityPublicationResult {
  opportunityId: string;
  applicantPath: string;
  recruiterReviewPath: string;
}

export async function publishOpportunity(
  draft: OpportunityDraft,
  confirmedHardRuleIds: string[],
): Promise<OpportunityPublicationResult> {
  const normalizedDraft = {
    ...draft,
    startsAt: new Date(draft.startsAt).toISOString(),
    closesAt: new Date(draft.closesAt).toISOString(),
  };
  const { data, error } = await getSupabaseClient().functions.invoke(
    "publish-opportunity",
    { body: { draft: normalizedDraft, confirmedHardRuleIds } },
  );
  if (error !== null) throw error;
  if (!isOpportunityPublicationResult(data)) {
    throw new Error("The opportunity publication response is invalid.");
  }
  return data;
}

function isOpportunityPublicationResult(
  value: unknown,
): value is OpportunityPublicationResult {
  if (typeof value !== "object" || value === null) return false;
  const result = value as Partial<OpportunityPublicationResult>;
  if (typeof result.opportunityId !== "string") return false;
  return (
    result.applicantPath === `/opportunities/${result.opportunityId}/apply` &&
    result.recruiterReviewPath ===
      `/recruiter/opportunities/${result.opportunityId}/applications`
  );
}
