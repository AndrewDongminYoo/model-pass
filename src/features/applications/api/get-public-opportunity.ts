import { getSupabaseClient } from "../../../lib/supabase/client";
import type { RuleDefinition } from "../../eligibility/domain/types";
import type {
  Compensation,
  OpportunityCategory,
} from "../../opportunities/domain/opportunity";

export interface PublicOpportunity {
  id: string;
  category: OpportunityCategory;
  title: string;
  startsAt: string;
  closesAt: string;
  venueDistrict: string;
  expectedMinutes: number;
  benefit: Compensation;
  rulesetId: string;
  rulesetVersion: number;
  rules: RuleDefinition[];
}

export async function getPublicOpportunity(
  opportunityId: string,
): Promise<PublicOpportunity> {
  const { data, error } = await getSupabaseClient().functions.invoke(
    "get-public-opportunity",
    { body: { opportunityId } },
  );

  if (error !== null) {
    throw error;
  }
  if (!isPublicOpportunity(data)) {
    throw new Error("The opportunity response is invalid.");
  }
  return data;
}

function isPublicOpportunity(value: unknown): value is PublicOpportunity {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const opportunity = value as Partial<PublicOpportunity>;
  return (
    typeof opportunity.id === "string" &&
    (opportunity.category === "hair_promotion" ||
      opportunity.category === "makeup_certification") &&
    typeof opportunity.title === "string" &&
    typeof opportunity.startsAt === "string" &&
    typeof opportunity.closesAt === "string" &&
    typeof opportunity.venueDistrict === "string" &&
    Number.isInteger(opportunity.expectedMinutes) &&
    typeof opportunity.benefit === "object" &&
    opportunity.benefit !== null &&
    typeof opportunity.rulesetId === "string" &&
    Number.isInteger(opportunity.rulesetVersion) &&
    Array.isArray(opportunity.rules)
  );
}
