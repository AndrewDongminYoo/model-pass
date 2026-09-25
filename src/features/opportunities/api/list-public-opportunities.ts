import { getSupabaseClient } from "../../../lib/supabase/client";
import type { Compensation, OpportunityCategory } from "../domain/opportunity";

export interface PublicOpportunitySummary {
  id: string;
  category: OpportunityCategory;
  title: string;
  startsAt: string;
  closesAt: string;
  venueDistrict: string;
  expectedMinutes: number;
  benefit: Compensation;
}

export async function listPublicOpportunities(): Promise<
  PublicOpportunitySummary[]
> {
  const { data, error } = await getSupabaseClient().functions.invoke(
    "list-public-opportunities",
  );
  if (error !== null) throw error;
  if (!Array.isArray(data) || !data.every(isPublicOpportunitySummary)) {
    throw new Error("The opportunity list response is invalid.");
  }
  return data;
}

function isPublicOpportunitySummary(
  value: unknown,
): value is PublicOpportunitySummary {
  if (typeof value !== "object" || value === null) return false;
  const opportunity = value as Partial<PublicOpportunitySummary>;
  const benefit = opportunity.benefit;
  return (
    typeof opportunity.id === "string" &&
    (opportunity.category === "hair_promotion" ||
      opportunity.category === "makeup_certification") &&
    typeof opportunity.title === "string" &&
    typeof opportunity.startsAt === "string" &&
    Number.isFinite(Date.parse(opportunity.startsAt)) &&
    typeof opportunity.closesAt === "string" &&
    Number.isFinite(Date.parse(opportunity.closesAt)) &&
    typeof opportunity.venueDistrict === "string" &&
    Number.isInteger(opportunity.expectedMinutes) &&
    typeof benefit === "object" &&
    benefit !== null &&
    ((benefit.type === "procedure" &&
      typeof benefit.description === "string") ||
      (benefit.type === "cash" &&
        typeof benefit.amount === "number" &&
        typeof benefit.description === "string"))
  );
}
