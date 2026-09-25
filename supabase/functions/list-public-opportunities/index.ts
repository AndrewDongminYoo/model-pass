import { createClient, type SupabaseClient } from "@supabase/supabase-js";

type PublicBenefit =
  | { type: "cash"; amount: number; description: string }
  | { type: "procedure"; description: string };

export interface PublicOpportunitySummary {
  id: string;
  category: "hair_promotion" | "makeup_certification";
  title: string;
  startsAt: string;
  closesAt: string;
  venueDistrict: string;
  expectedMinutes: number;
  benefit: PublicBenefit;
}

export interface OpportunitySummaryRow {
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
  [field: string]: unknown;
}

export interface ListPublicOpportunitiesDependencies {
  now: () => Date;
  loadActiveOpportunities: (now: Date) => Promise<OpportunitySummaryRow[]>;
}

const corsHeaders = {
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Origin": "*",
  "Content-Type": "application/json",
};

export async function listPublicOpportunities(
  dependencies: ListPublicOpportunitiesDependencies,
): Promise<PublicOpportunitySummary[]> {
  const now = dependencies.now();
  const rows = await dependencies.loadActiveOpportunities(now);
  return rows
    .filter(
      (row) =>
        row.status === "published" &&
        row.closed_at === null &&
        Date.parse(row.closes_at) > now.getTime(),
    )
    .sort(
      (left, right) => Date.parse(left.starts_at) - Date.parse(right.starts_at),
    )
    .slice(0, 12)
    .map((row) => ({
      id: row.id,
      category: parseCategory(row.category),
      title: row.title,
      startsAt: row.starts_at,
      closesAt: row.closes_at,
      venueDistrict: row.venue_district,
      expectedMinutes: row.expected_minutes,
      benefit: parseBenefit(row.benefit),
    }));
}

export function createListPublicOpportunitiesHandler(
  dependencies: ListPublicOpportunitiesDependencies,
) {
  return async (request: Request): Promise<Response> => {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }
    if (request.method !== "POST") {
      return jsonResponse({ error: "Method not allowed." }, 405);
    }

    try {
      return jsonResponse(await listPublicOpportunities(dependencies), 200);
    } catch (error) {
      console.error(error);
      return jsonResponse({ error: "Unable to load opportunities." }, 500);
    }
  };
}

function parseCategory(value: string): PublicOpportunitySummary["category"] {
  if (value === "hair_promotion" || value === "makeup_certification") {
    return value;
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

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: corsHeaders,
  });
}

export function createSupabaseDependencies(
  client: SupabaseClient,
): ListPublicOpportunitiesDependencies {
  return {
    now: () => new Date(),
    async loadActiveOpportunities(now) {
      const { data, error } = await client
        .from("opportunities")
        .select(
          "id, category, title, starts_at, closes_at, closed_at, venue_district, expected_minutes, benefit, status",
        )
        .eq("status", "published")
        .is("closed_at", null)
        .gt("closes_at", now.toISOString())
        .order("starts_at", { ascending: true })
        .limit(12)
        .returns<OpportunitySummaryRow[]>();
      if (error !== null) {
        throw new Error(`Failed to load opportunities: ${error.message}`);
      }
      return data ?? [];
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
    createListPublicOpportunitiesHandler(createSupabaseDependencies(client)),
  );
}
