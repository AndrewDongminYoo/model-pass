import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import {
  parseRuleDefinitions,
  type RuleDefinition,
} from "../../../src/features/eligibility/domain/types.ts";
import {
  assertCanonicalOpportunityRules,
  editableConditionSchema,
  type EditableCondition,
} from "../../../src/features/eligibility/domain/opportunity-conditions.ts";
import { isWithinMakeupExamYear } from "../../../src/features/eligibility/templates/makeup-certification-v2.ts";

const corsHeaders = {
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Origin": "*",
  "Content-Type": "application/json",
};

type OpportunityCategory = "hair_promotion" | "makeup_certification";
type Compensation =
  | { type: "cash"; amount: number; description: string }
  | { type: "procedure"; description: string };

interface OpportunityDraft {
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
  conditions?: EditableCondition[];
  requiredModelSex?: "female" | "male";
}

function isFutureDate(value: string): boolean {
  const timestamp = Date.parse(value);
  return !Number.isNaN(timestamp) && timestamp > Date.now();
}

const rulesSchema = z.array(z.unknown()).transform((rules, context) => {
  try {
    return parseRuleDefinitions(rules);
  } catch {
    context.addIssue({ code: "custom", message: "Rules must be valid." });
    return z.NEVER;
  }
});

const publicationDraftSchema = z
  .object({
    category: z.enum(["hair_promotion", "makeup_certification"]),
    title: z.string().trim().min(1),
    startsAt: z.string().refine(isFutureDate),
    closesAt: z.string().refine(isFutureDate),
    venueDistrict: z.string().trim().min(1),
    expectedMinutes: z.number().int().positive(),
    benefit: z.discriminatedUnion("type", [
      z.object({
        type: z.literal("cash"),
        amount: z.number().positive(),
        description: z.string().trim().min(1),
      }),
      z.object({
        type: z.literal("procedure"),
        description: z.string().trim().min(1),
      }),
    ]),
    rulesetId: z.string().min(1),
    rulesetVersion: z.number().int().positive(),
    rules: rulesSchema,
    conditions: z.array(editableConditionSchema).optional(),
    requiredModelSex: z.enum(["female", "male"]).optional(),
  })
  .strict()
  .refine(
    ({ closesAt, startsAt }) => Date.parse(closesAt) < Date.parse(startsAt),
  );

const publicationInputSchema = z
  .object({
    draft: publicationDraftSchema,
    confirmedHardRuleIds: z.array(z.string().min(1)),
  })
  .strict();

export interface OpportunityPublicationCommand {
  recruiterId: string;
  draft: OpportunityDraft;
  confirmedHardRuleIds: string[];
}

export interface OpportunityPublicationDependencies {
  authenticate: (accessToken: string | undefined) => Promise<string | null>;
  persistOpportunity: (
    command: OpportunityPublicationCommand,
  ) => Promise<string>;
}

class PublicationRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "PublicationRequestError";
  }
}

export function createPublishOpportunityHandler(
  dependencies: OpportunityPublicationDependencies,
) {
  return async (request: Request): Promise<Response> => {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }
    if (request.method !== "POST") {
      return jsonResponse({ error: "Method not allowed." }, 405);
    }

    try {
      const accessToken = readBearerToken(request.headers.get("Authorization"));
      const recruiterId = await dependencies.authenticate(accessToken);
      if (recruiterId === null || accessToken === undefined) {
        throw new PublicationRequestError(
          "Recruiter authentication is required.",
          401,
        );
      }

      const input = publicationInputSchema.parse(await request.json());
      if (
        input.draft.category === "makeup_certification" &&
        !isWithinMakeupExamYear(input.draft.startsAt)
      ) {
        throw new PublicationRequestError(
          "This makeup template applies only to 2026 exam dates.",
          400,
        );
      }
      let canonicalRules: RuleDefinition[];
      try {
        canonicalRules = assertCanonicalOpportunityRules({
          category: input.draft.category,
          rulesetId: input.draft.rulesetId,
          rulesetVersion: input.draft.rulesetVersion,
          conditions: input.draft.conditions ?? [],
          requiredModelSex: input.draft.requiredModelSex,
          rules: input.draft.rules,
        });
      } catch {
        throw new PublicationRequestError(
          "Opportunity conditions are invalid.",
          400,
        );
      }
      const canonicalDraft = { ...input.draft, rules: canonicalRules };
      assertEveryHardRuleConfirmed(canonicalDraft, input.confirmedHardRuleIds);
      const opportunityId = await dependencies.persistOpportunity({
        recruiterId,
        draft: canonicalDraft,
        confirmedHardRuleIds: input.confirmedHardRuleIds,
      });
      return jsonResponse(
        {
          opportunityId,
          applicantPath: `/opportunities/${opportunityId}/apply`,
          recruiterReviewPath: `/recruiter/opportunities/${opportunityId}/applications`,
        },
        201,
      );
    } catch (error) {
      if (error instanceof PublicationRequestError) {
        return jsonResponse({ error: error.message }, error.status);
      }
      if (error instanceof SyntaxError || error instanceof z.ZodError) {
        return jsonResponse({ error: "Invalid opportunity payload." }, 400);
      }
      console.error(error);
      return jsonResponse({ error: "Unable to publish the opportunity." }, 500);
    }
  };
}

function assertEveryHardRuleConfirmed(
  draft: OpportunityDraft,
  confirmedHardRuleIds: string[],
): void {
  const requiredIds = draft.rules
    .filter((rule) => rule.effect === "hard_fail")
    .map((rule) => rule.id);
  const confirmedIds = new Set(confirmedHardRuleIds);
  if (
    confirmedIds.size !== confirmedHardRuleIds.length ||
    confirmedIds.size !== requiredIds.length ||
    requiredIds.some((ruleId) => !confirmedIds.has(ruleId))
  ) {
    throw new PublicationRequestError(
      "Every hard rule must be explicitly confirmed.",
      400,
    );
  }
}

function readBearerToken(value: string | null): string | undefined {
  const match = /^Bearer\s+(.+)$/i.exec(value ?? "");
  return match?.[1];
}

export function createSupabaseDependencies(
  supabaseUrl: string,
  anonKey: string,
  serviceRoleKey: string,
): OpportunityPublicationDependencies {
  const authClient = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false },
  });
  const persistenceClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });
  return {
    async authenticate(accessToken) {
      if (accessToken === undefined) return null;
      const { data, error } = await authClient.auth.getUser(accessToken);
      if (error !== null || data.user === null) return null;
      return data.user.id;
    },
    async persistOpportunity(command) {
      return insertOpportunity(persistenceClient, command);
    },
  };
}

async function insertOpportunity(
  client: SupabaseClient,
  command: OpportunityPublicationCommand,
): Promise<string> {
  const { draft } = command;
  const { data, error } = await client.rpc(
    "publish_opportunity_for_recruiter",
    {
      p_recruiter_id: command.recruiterId,
      p_category: draft.category,
      p_title: draft.title,
      p_starts_at: draft.startsAt,
      p_closes_at: draft.closesAt,
      p_venue_district: draft.venueDistrict,
      p_expected_minutes: draft.expectedMinutes,
      p_benefit: draft.benefit,
      p_ruleset_id: draft.rulesetId,
      p_ruleset_version: draft.rulesetVersion,
      p_rules_snapshot: draft.rules,
      p_confirmed_hard_rule_ids: command.confirmedHardRuleIds,
    },
  );
  if (error !== null) throw error;
  if (typeof data !== "string") {
    throw new Error("Publication returned an invalid opportunity ID.");
  }
  return data;
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: corsHeaders,
  });
}

if (import.meta.main) {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    throw new Error("Supabase server environment is not configured.");
  }
  Deno.serve(
    createPublishOpportunityHandler(
      createSupabaseDependencies(supabaseUrl, anonKey, serviceRoleKey),
    ),
  );
}
