import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type {
  EvaluationResult,
  RuleDefinition,
} from "../../../src/features/eligibility/domain/types.ts";
import { evaluateRules } from "../../../src/features/eligibility/domain/evaluate-rules.ts";
import { parseRuleDefinitions } from "../../../src/features/eligibility/domain/types.ts";
import type {
  SubmitApplicationInput,
  SubmitApplicationResult,
} from "../../../src/features/applications/domain/application.ts";
import { parseSubmitApplicationInput } from "../../../src/features/applications/domain/application.ts";

export interface OpportunityForSubmission {
  id: string;
  closesAt: string;
  closedAt: string | null;
  rulesetId: string;
  rulesetVersion: number;
  rules: RuleDefinition[];
}

export interface ApplicationPersistenceCommand {
  opportunityId: string;
  applicant: SubmitApplicationInput["applicant"];
  answers: SubmitApplicationInput["answers"];
  currentApplicationConsent: true;
  futureOpportunityConsent: boolean;
  rulesetId: string;
  rulesetVersion: number;
  rulesSnapshot: RuleDefinition[];
  evaluationSnapshot: EvaluationResult;
}

export interface SubmissionDependencies {
  now: () => Date;
  loadOpportunity: (
    opportunityId: string,
  ) => Promise<OpportunityForSubmission | null>;
  persistApplication: (
    command: ApplicationPersistenceCommand,
  ) => Promise<string>;
}

interface OpportunityRow {
  id: string;
  closes_at: string;
  closed_at: string | null;
  ruleset_id: string;
  ruleset_version: number;
  rules_snapshot: unknown;
}

const corsHeaders = {
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Origin": "*",
  "Content-Type": "application/json",
};

export class SubmissionError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly evaluation?: EvaluationResult,
  ) {
    super(message);
    this.name = "SubmissionError";
  }
}

export async function submitApplication(
  input: unknown,
  dependencies: SubmissionDependencies,
): Promise<SubmitApplicationResult> {
  const parsedInput = parseSubmitApplicationInput(input);

  if (!isAtLeast19(parsedInput.applicant.birthDate, dependencies.now())) {
    throw new SubmissionError(
      "Applicants must be at least 19 years old.",
      422,
    );
  }

  const opportunity = await dependencies.loadOpportunity(
    parsedInput.opportunityId,
  );
  if (opportunity === null) {
    throw new SubmissionError("This opportunity was not found.", 404);
  }

  const now = dependencies.now();
  if (
    opportunity.closedAt !== null ||
    Date.parse(opportunity.closesAt) <= now.getTime()
  ) {
    throw new SubmissionError("This opportunity is closed.", 409);
  }

  const acceptedAnswerFields = new Set(
    opportunity.rules
      .filter((rule) => rule.field !== "isAdult")
      .map((rule) => rule.field),
  );
  if (
    Object.keys(parsedInput.answers).some(
      (field) => !acceptedAnswerFields.has(field),
    )
  ) {
    throw new SubmissionError(
      "Answers contain fields not requested by this opportunity.",
      400,
    );
  }

  const evaluatedAnswers = {
    ...parsedInput.answers,
    isAdult: true,
  };
  const evaluation = evaluateRules(evaluatedAnswers, opportunity.rules, {
    rulesetId: opportunity.rulesetId,
    rulesetVersion: opportunity.rulesetVersion,
  });
  if (!evaluation.eligible) {
    throw new SubmissionError(
      "The application does not satisfy this opportunity's rules.",
      422,
      evaluation,
    );
  }

  const rulesSnapshot = structuredClone(opportunity.rules);
  const evaluationSnapshot = structuredClone(evaluation);
  const applicationId = await dependencies.persistApplication({
    opportunityId: opportunity.id,
    applicant: parsedInput.applicant,
    answers: evaluatedAnswers,
    currentApplicationConsent: parsedInput.currentApplicationConsent,
    futureOpportunityConsent: parsedInput.futureOpportunityConsent,
    rulesetId: opportunity.rulesetId,
    rulesetVersion: opportunity.rulesetVersion,
    rulesSnapshot,
    evaluationSnapshot,
  });

  return {
    applicationId,
    evaluation,
  };
}

function isAtLeast19(birthDate: string, currentDate: Date): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(birthDate);
  if (match === null) {
    return false;
  }

  const birthYear = Number(match[1]);
  const birthMonth = Number(match[2]);
  const birthDay = Number(match[3]);
  const parsedBirthDate = new Date(
    Date.UTC(birthYear, birthMonth - 1, birthDay),
  );

  if (
    parsedBirthDate.getUTCFullYear() !== birthYear ||
    parsedBirthDate.getUTCMonth() !== birthMonth - 1 ||
    parsedBirthDate.getUTCDate() !== birthDay
  ) {
    return false;
  }

  const businessDate = getSeoulDateParts(currentDate);
  let age = businessDate.year - birthYear;
  const currentMonth = businessDate.month;
  const currentDay = businessDate.day;
  if (
    currentMonth < birthMonth ||
    (currentMonth === birthMonth && currentDay < birthDay)
  ) {
    age -= 1;
  }

  return age >= 19;
}

function getSeoulDateParts(date: Date): {
  year: number;
  month: number;
  day: number;
} {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = new Map(parts.map((part) => [part.type, part.value]));

  return {
    year: Number(values.get("year")),
    month: Number(values.get("month")),
    day: Number(values.get("day")),
  };
}

export function createSupabaseDependencies(
  client: SupabaseClient,
): SubmissionDependencies {
  return {
    now: () => new Date(),
    async loadOpportunity(opportunityId) {
      const { data, error } = await client
        .from("opportunities")
        .select(
          "id, closes_at, closed_at, ruleset_id, ruleset_version, rules_snapshot",
        )
        .eq("id", opportunityId)
        .eq("status", "published")
        .maybeSingle<OpportunityRow>();

      if (error !== null) {
        throw new Error(`Failed to load opportunity: ${error.message}`);
      }
      if (data === null) {
        return null;
      }

      return {
        id: data.id,
        closesAt: data.closes_at,
        closedAt: data.closed_at,
        rulesetId: data.ruleset_id,
        rulesetVersion: data.ruleset_version,
        rules: parseRuleDefinitions(data.rules_snapshot),
      };
    },
    async persistApplication(command) {
      const { data, error } = await client.rpc(
        "submit_application_transaction",
        {
          p_opportunity_id: command.opportunityId,
          p_applicant_display_name: command.applicant.displayName,
          p_applicant_phone: command.applicant.phone,
          p_applicant_birth_date: command.applicant.birthDate,
          p_answers: command.answers,
          p_current_application_consent:
            command.currentApplicationConsent,
          p_future_opportunity_consent: command.futureOpportunityConsent,
          p_ruleset_id: command.rulesetId,
          p_ruleset_version: command.rulesetVersion,
          p_rules_snapshot: command.rulesSnapshot,
          p_evaluation_snapshot: command.evaluationSnapshot,
        },
      );

      if (error !== null) {
        throw new Error(`Failed to persist application: ${error.message}`);
      }
      if (typeof data !== "string") {
        throw new Error("Application persistence returned an invalid ID.");
      }

      return data;
    },
  };
}

export function createSubmitApplicationHandler(
  dependencies: SubmissionDependencies,
) {
  return async (request: Request): Promise<Response> => {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }
    if (request.method !== "POST") {
      return jsonResponse({ error: "Method not allowed." }, 405);
    }

    try {
      const result = await submitApplication(await request.json(), dependencies);
      return jsonResponse(result, 201);
    } catch (error) {
      if (error instanceof SubmissionError) {
        return jsonResponse(
          { error: error.message, evaluation: error.evaluation },
          error.status,
        );
      }
      if (error instanceof SyntaxError || isZodError(error)) {
        return jsonResponse({ error: "Invalid application payload." }, 400);
      }

      console.error(error);
      return jsonResponse({ error: "Unable to submit the application." }, 500);
    }
  };
}

function isZodError(error: unknown): boolean {
  return error instanceof Error && error.name === "ZodError";
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: corsHeaders,
  });
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
  Deno.serve(createSubmitApplicationHandler(createSupabaseDependencies(client)));
}
