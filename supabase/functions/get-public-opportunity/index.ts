import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  parseRuleDefinitions,
  type RuleDefinition,
} from "../../../src/features/eligibility/domain/types.ts";

type PublicBenefit =
  | { type: "cash"; amount: number; description: string }
  | { type: "procedure"; description: string };

export interface PublicOpportunity {
  id: string;
  category: "hair_promotion" | "makeup_certification";
  title: string;
  startsAt: string;
  closesAt: string;
  venueDistrict: string;
  expectedMinutes: number;
  benefit: PublicBenefit;
  rulesetId: string;
  rulesetVersion: number;
  rules: RuleDefinition[];
}

export interface PublicOpportunityRow {
  id: string;
  category: string;
  title: string;
  starts_at: string;
  closes_at: string;
  closed_at: string | null;
  venue_district: string;
  expected_minutes: number;
  benefit: unknown;
  status: string;
  ruleset_id: string;
  ruleset_version: number;
  rules_snapshot: unknown;
  [field: string]: unknown;
}

export interface PublicOpportunityDependencies {
  now: () => Date;
  loadOpportunity: (
    opportunityId: string,
  ) => Promise<PublicOpportunityRow | null>;
}

const corsHeaders = {
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Origin": "*",
  "Content-Type": "application/json",
};

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class PublicOpportunityError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "PublicOpportunityError";
  }
}

export async function getPublicOpportunity(
  input: unknown,
  dependencies: PublicOpportunityDependencies,
): Promise<PublicOpportunity> {
  const opportunityId = parseOpportunityId(input);
  const row = await dependencies.loadOpportunity(opportunityId);

  if (row === null || row.status === "draft") {
    throw new PublicOpportunityError("This opportunity was not found.", 404);
  }
  if (
    row.status === "closed" ||
    row.status !== "published" ||
    row.closed_at !== null ||
    Date.parse(row.closes_at) <= dependencies.now().getTime()
  ) {
    throw new PublicOpportunityError("This opportunity is closed.", 410);
  }

  return {
    id: row.id,
    category: parseCategory(row.category),
    title: row.title,
    startsAt: row.starts_at,
    closesAt: row.closes_at,
    venueDistrict: row.venue_district,
    expectedMinutes: row.expected_minutes,
    benefit: parseBenefit(row.benefit),
    rulesetId: row.ruleset_id,
    rulesetVersion: row.ruleset_version,
    rules: parseRuleDefinitions(row.rules_snapshot),
  };
}

function parseOpportunityId(input: unknown): string {
  if (typeof input !== "object" || input === null) {
    throw new PublicOpportunityError("Invalid opportunity request.", 400);
  }

  const opportunityId = (input as { opportunityId?: unknown }).opportunityId;
  if (typeof opportunityId !== "string" || !uuidPattern.test(opportunityId)) {
    throw new PublicOpportunityError("Invalid opportunity request.", 400);
  }
  return opportunityId;
}

function parseCategory(category: string): PublicOpportunity["category"] {
  if (category === "hair_promotion" || category === "makeup_certification") {
    return category;
  }
  throw new Error("Opportunity has an invalid category.");
}

function parseBenefit(value: unknown): PublicBenefit {
  if (typeof value !== "object" || value === null) {
    throw new Error("Opportunity has an invalid benefit.");
  }

  const benefit = value as Record<string, unknown>;
  if (
    benefit.type === "cash" &&
    typeof benefit.amount === "number" &&
    typeof benefit.description === "string"
  ) {
    return {
      type: "cash",
      amount: benefit.amount,
      description: benefit.description,
    };
  }
  if (benefit.type === "procedure" && typeof benefit.description === "string") {
    return { type: "procedure", description: benefit.description };
  }

  throw new Error("Opportunity has an invalid benefit.");
}

export function createGetPublicOpportunityHandler(
  dependencies: PublicOpportunityDependencies,
) {
  return async (request: Request): Promise<Response> => {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }
    if (request.method !== "POST") {
      return jsonResponse({ error: "Method not allowed." }, 405);
    }

    try {
      return jsonResponse(
        await getPublicOpportunity(await request.json(), dependencies),
        200,
      );
    } catch (error) {
      if (error instanceof PublicOpportunityError) {
        return jsonResponse({ error: error.message }, error.status);
      }
      if (error instanceof SyntaxError) {
        return jsonResponse({ error: "Invalid opportunity request." }, 400);
      }

      console.error(error);
      return jsonResponse({ error: "Unable to load the opportunity." }, 500);
    }
  };
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: corsHeaders,
  });
}

export function createSupabaseDependencies(
  client: SupabaseClient,
): PublicOpportunityDependencies {
  return {
    now: () => new Date(),
    async loadOpportunity(opportunityId) {
      const { data, error } = await client
        .from("opportunities")
        .select(
          "id, category, title, starts_at, closes_at, closed_at, venue_district, expected_minutes, benefit, status, ruleset_id, ruleset_version, rules_snapshot",
        )
        .eq("id", opportunityId)
        .maybeSingle<PublicOpportunityRow>();

      if (error !== null) {
        throw new Error(`Failed to load opportunity: ${error.message}`);
      }
      return data;
    },
  };
}

if (import.meta.main) {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (supabaseUrl === undefined || serviceRoleKey === undefined) {
    throw new Error("Supabase server environment is not configured.");
  }

  const client = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });
  Deno.serve(
    createGetPublicOpportunityHandler(createSupabaseDependencies(client)),
  );
}
