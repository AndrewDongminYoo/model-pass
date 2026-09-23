import { getSupabaseClient } from "../../../lib/supabase/client";

export interface OpportunityClosureResult {
  opportunityId: string;
  status: "closed";
  closedAt: string;
}

export async function closeOpportunity(
  opportunityId: string,
): Promise<OpportunityClosureResult> {
  const { data, error } = await getSupabaseClient().functions.invoke(
    "close-opportunity",
    { body: { opportunityId } },
  );
  if (error !== null) throw error;
  if (
    typeof data !== "object" ||
    data === null ||
    data.opportunityId !== opportunityId ||
    data.status !== "closed" ||
    typeof data.closedAt !== "string" ||
    Number.isNaN(Date.parse(data.closedAt))
  ) {
    throw new Error("The opportunity closure response is invalid.");
  }
  return data as OpportunityClosureResult;
}
