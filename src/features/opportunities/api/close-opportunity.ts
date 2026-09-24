import { getSupabaseClient } from "../../../lib/supabase/client";
import {
  parseRuleDefinitions,
  type RuleDefinition,
} from "../../eligibility/domain/types";

export interface OpportunityClosureResult {
  opportunityId: string;
  status: "closed";
  closedAt: string;
}

export interface RecruiterOpportunityState {
  status: "draft" | "published" | "closed";
  canSelect: boolean;
  rules: RuleDefinition[];
}

export async function getRecruiterOpportunityState(
  opportunityId: string,
): Promise<RecruiterOpportunityState> {
  const { data, error } = await getSupabaseClient()
    .from("opportunities")
    .select("status, closed_at, closes_at, starts_at, rules_snapshot")
    .eq("id", opportunityId)
    .maybeSingle<{
      status: string;
      closed_at: string | null;
      closes_at: string;
      starts_at: string;
      rules_snapshot: unknown;
    }>();
  if (
    error !== null ||
    data === null ||
    !["draft", "published", "closed"].includes(data.status)
  ) {
    throw new Error("Could not load the opportunity state.");
  }
  const now = Date.now();
  return {
    status: data.status as RecruiterOpportunityState["status"],
    rules: parseRuleDefinitions(data.rules_snapshot),
    canSelect:
      data.status === "published" &&
      data.closed_at === null &&
      Date.parse(data.closes_at) > now &&
      Date.parse(data.starts_at) > now,
  };
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
