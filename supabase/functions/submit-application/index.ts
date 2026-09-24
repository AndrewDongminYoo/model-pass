import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { hashAnonymousRequestSource } from "../_shared/anonymous-quota.ts";
import type {
  EvaluationResult,
  RuleDefinition,
} from "../../../src/features/eligibility/domain/types.ts";
import { evaluateRules } from "../../../src/features/eligibility/domain/evaluate-rules.ts";
import { isAtLeast19 } from "../../../src/features/eligibility/domain/age.ts";
import { parseRuleDefinitions } from "../../../src/features/eligibility/domain/types.ts";
import {
  isWithinMakeupExamAgeLimit,
  makeupCertificationV2Metadata,
} from "../../../src/features/eligibility/templates/makeup-certification-v2.ts";
import type {
  SubmitApplicationInput,
  SubmitApplicationResult,
} from "../../../src/features/applications/domain/application.ts";
import {
  isEvaluationResult,
  parseSubmitApplicationInput,
} from "../../../src/features/applications/domain/application.ts";

export type ApplicationSubmissionState = "pending_photo" | "submitted";

export interface ApplicationSubmissionResult extends SubmitApplicationResult {
  submissionState: ApplicationSubmissionState;
}

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
  submissionAttemptId: string;
  submissionFingerprint: string;
  applicant: SubmitApplicationInput["applicant"];
  answers: SubmitApplicationInput["answers"];
  currentApplicationConsent: true;
  futureOpportunityConsent: boolean;
  rulesetId: string;
  rulesetVersion: number;
  rulesSnapshot: RuleDefinition[];
  evaluationSnapshot: EvaluationResult;
  submissionState: ApplicationSubmissionState;
}

export type ApplicationPersistenceResult = ApplicationSubmissionResult;

export interface ExistingApplicationAttempt {
  applicationId: string;
  submissionFingerprint: string;
  evaluation: EvaluationResult;
  submissionState: ApplicationSubmissionState;
}

export interface SubmissionIntent {
  opportunityId: string;
  submissionAttemptId: string;
  applicant: SubmitApplicationInput["applicant"];
  answers: SubmitApplicationInput["answers"];
  currentApplicationConsent: true;
  futureOpportunityConsent: boolean;
}

export interface SubmissionDependencies {
  now: () => Date;
  consumeQuota: (
    opportunityId: string,
    sourceHash: string,
    submissionAttemptId: string,
  ) => Promise<boolean>;
  loadExistingAttempt: (
    opportunityId: string,
    submissionAttemptId: string,
  ) => Promise<ExistingApplicationAttempt | null>;
  loadOpportunity: (
    opportunityId: string,
  ) => Promise<OpportunityForSubmission | null>;
  persistApplication: (
    command: ApplicationPersistenceCommand,
  ) => Promise<ApplicationPersistenceResult>;
}

interface OpportunityRow {
  id: string;
  closes_at: string;
  closed_at: string | null;
  ruleset_id: string;
  ruleset_version: number;
  rules_snapshot: unknown;
}

interface ExistingAttemptRow {
  id: string;
  submission_fingerprint: string;
  evaluation_snapshot: unknown;
  submission_state: string;
}

const corsHeaders = {
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Origin": "*",
  "Content-Type": "application/json",
};

const maximumSubmissionBytes = 262_144;

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
  sourceHash = "",
): Promise<ApplicationSubmissionResult> {
  const parsedInput = parseSubmitApplicationInput(input);
  const submissionIntent: SubmissionIntent = {
    opportunityId: parsedInput.opportunityId,
    submissionAttemptId: parsedInput.submissionAttemptId,
    applicant: parsedInput.applicant,
    answers: parsedInput.answers,
    currentApplicationConsent: parsedInput.currentApplicationConsent,
    futureOpportunityConsent: parsedInput.futureOpportunityConsent,
  };
  const submissionFingerprint =
    await createSubmissionFingerprint(submissionIntent);
  const existingAttempt = await dependencies.loadExistingAttempt(
    parsedInput.opportunityId,
    parsedInput.submissionAttemptId,
  );
  if (existingAttempt !== null) {
    if (existingAttempt.submissionFingerprint !== submissionFingerprint) {
      throw new SubmissionError(
        "Submission attempt payload does not match the original application.",
        409,
      );
    }

    return {
      applicationId: existingAttempt.applicationId,
      evaluation: existingAttempt.evaluation,
      submissionState: existingAttempt.submissionState,
    };
  }

  if (!isAtLeast19(parsedInput.applicant.birthDate, dependencies.now())) {
    throw new SubmissionError("Applicants must be at least 19 years old.", 422);
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
      .filter(
        (rule) =>
          rule.field !== "isAdult" &&
          !rule.field.toLowerCase().includes("photo"),
      )
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
    ...(opportunity.rulesetId === makeupCertificationV2Metadata.id &&
    opportunity.rulesetVersion === makeupCertificationV2Metadata.version
      ? {
          isWithinMakeupAgeLimit:
            isWithinMakeupExamAgeLimit(parsedInput.applicant.birthDate) ===
            true,
        }
      : {}),
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

  if (
    !(await dependencies.consumeQuota(
      opportunity.id,
      sourceHash,
      parsedInput.submissionAttemptId,
    ))
  ) {
    throw new SubmissionError(
      "Too many applications for this opportunity. Please try again later.",
      429,
    );
  }

  const rulesSnapshot = structuredClone(opportunity.rules);
  const evaluationSnapshot = structuredClone(evaluation);
  const submissionState = deriveSubmissionState(
    rulesSnapshot,
    evaluationSnapshot,
  );
  const persistencePayload = {
    opportunityId: opportunity.id,
    submissionAttemptId: parsedInput.submissionAttemptId,
    applicant: parsedInput.applicant,
    answers: evaluatedAnswers,
    currentApplicationConsent: parsedInput.currentApplicationConsent,
    futureOpportunityConsent: parsedInput.futureOpportunityConsent,
    rulesetId: opportunity.rulesetId,
    rulesetVersion: opportunity.rulesetVersion,
    rulesSnapshot,
    evaluationSnapshot,
    submissionState,
  };
  const persistenceResult = await dependencies.persistApplication({
    ...persistencePayload,
    submissionFingerprint,
  });

  return persistenceResult;
}

export function deriveSubmissionState(
  rules: RuleDefinition[],
  evaluation: EvaluationResult,
): ApplicationSubmissionState {
  const requestedPhotoRuleIds = new Set(
    rules
      .filter(
        (rule) =>
          rule.effect === "needs_review" &&
          rule.field.toLowerCase().includes("photo"),
      )
      .map((rule) => rule.id),
  );
  return evaluation.reviews.some(
    (outcome) =>
      outcome.effect === "needs_review" &&
      requestedPhotoRuleIds.has(outcome.ruleId),
  )
    ? "pending_photo"
    : "submitted";
}

export async function createSubmissionFingerprint(
  intent: SubmissionIntent,
): Promise<string> {
  const canonical = canonicalJson(intent);
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonical),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (typeof value === "object" && value !== null) {
    return `{${Object.entries(value)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function createSupabaseDependencies(
  client: SupabaseClient,
): SubmissionDependencies {
  return {
    now: () => new Date(),
    async consumeQuota(opportunityId, sourceHash, submissionAttemptId) {
      const { data, error } = await client.rpc(
        "consume_anonymous_submission_quota",
        {
          p_opportunity_id: opportunityId,
          p_source_hash: sourceHash,
          p_limit: 10,
          p_submission_attempt_id: submissionAttemptId,
        },
      );
      if (error !== null || typeof data !== "boolean") {
        throw new Error("Failed to check anonymous submission quota.");
      }
      return data;
    },
    async loadExistingAttempt(opportunityId, submissionAttemptId) {
      const { data, error } = await client
        .from("applications")
        .select(
          "id, submission_fingerprint, evaluation_snapshot, submission_state",
        )
        .eq("opportunity_id", opportunityId)
        .eq("submission_attempt_id", submissionAttemptId)
        .maybeSingle<ExistingAttemptRow>();

      if (error !== null) {
        throw new Error(`Failed to load submission attempt: ${error.message}`);
      }
      if (data === null) {
        return null;
      }
      if (!isEvaluationResult(data.evaluation_snapshot)) {
        throw new Error("Stored application evaluation is invalid.");
      }
      const submissionState = parseSubmissionState(data.submission_state);
      if (submissionState === undefined) {
        throw new Error("Stored application submission state is invalid.");
      }

      return {
        applicationId: data.id,
        submissionFingerprint: data.submission_fingerprint,
        evaluation: data.evaluation_snapshot,
        submissionState,
      };
    },
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
          p_submission_attempt_id: command.submissionAttemptId,
          p_submission_fingerprint: command.submissionFingerprint,
          p_applicant_display_name: command.applicant.displayName,
          p_applicant_phone: command.applicant.phone,
          p_applicant_birth_date: command.applicant.birthDate,
          p_answers: command.answers,
          p_current_application_consent: command.currentApplicationConsent,
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
      if (
        typeof data !== "object" ||
        data === null ||
        typeof (data as { applicationId?: unknown }).applicationId !==
          "string" ||
        !isEvaluationResult((data as { evaluation?: unknown }).evaluation)
      ) {
        throw new Error("Application persistence returned an invalid result.");
      }
      const persistedResult = data as SubmitApplicationResult;
      const { data: persistedApplication, error: stateError } = await client
        .from("applications")
        .select("submission_state")
        .eq("id", persistedResult.applicationId)
        .maybeSingle<{ submission_state: string }>();
      if (stateError !== null || persistedApplication === null) {
        throw new Error(
          `Failed to load persisted application state: ${stateError?.message ?? "application not found"}`,
        );
      }
      const submissionState = parseSubmissionState(
        persistedApplication.submission_state,
      );
      if (
        submissionState === undefined ||
        submissionState !== command.submissionState
      ) {
        throw new Error("Persisted application submission state is invalid.");
      }

      return { ...persistedResult, submissionState };
    },
  };
}

function parseSubmissionState(
  value: unknown,
): ApplicationSubmissionState | undefined {
  return value === "pending_photo" || value === "submitted" ? value : undefined;
}

export function createSubmitApplicationHandler(
  dependencies: SubmissionDependencies,
  quotaSecret: string,
) {
  return async (request: Request): Promise<Response> => {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }
    if (request.method !== "POST") {
      return jsonResponse({ error: "Method not allowed." }, 405);
    }

    try {
      const input = await readBoundedSubmission(request);
      const sourceHash = await hashAnonymousRequestSource(request, quotaSecret);
      if (sourceHash === null) {
        return jsonResponse({ error: "Request source is unavailable." }, 503);
      }
      const result = await submitApplication(input, dependencies, sourceHash);
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

async function readBoundedSubmission(request: Request): Promise<unknown> {
  const declaredLength = request.headers.get("Content-Length");
  if (declaredLength !== null) {
    if (!/^(0|[1-9][0-9]*)$/.test(declaredLength)) {
      throw new SubmissionError("Invalid Content-Length header.", 400);
    }
    if (Number(declaredLength) > maximumSubmissionBytes) {
      throw new SubmissionError("Application payload is too large.", 413);
    }
  }

  if (request.body === null) {
    throw new SyntaxError("Empty application payload.");
  }
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    totalBytes += value.byteLength;
    if (totalBytes > maximumSubmissionBytes) {
      await reader.cancel();
      throw new SubmissionError("Application payload is too large.", 413);
    }
    chunks.push(value);
  }

  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(body));
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
  Deno.serve(
    createSubmitApplicationHandler(
      createSupabaseDependencies(client),
      serviceRoleKey,
    ),
  );
}
