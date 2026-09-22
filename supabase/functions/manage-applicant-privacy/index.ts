import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const MAX_BODY_BYTES = 4 * 1024;
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ApplicantPrivacyAction =
  "revoke_future_opportunity_consent" | "request_deletion";

interface ApplicantPrivacyCommand {
  applicationId: string;
  opportunityId: string;
  submissionAttemptId: string;
  action: ApplicantPrivacyAction;
}

export type ApplicantPrivacyResult =
  | { action: "revoke_future_opportunity_consent"; status: "accepted" }
  | { action: "request_deletion"; status: "pending" };

export interface ApplicantPrivacyDependencies {
  applyAction: (
    command: ApplicantPrivacyCommand,
  ) => Promise<ApplicantPrivacyResult | null>;
}

class ApplicantPrivacyRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ApplicantPrivacyRequestError";
  }
}

export function createManageApplicantPrivacyHandler(
  dependencies: ApplicantPrivacyDependencies,
) {
  return async (request: Request): Promise<Response> => {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }
    if (request.method !== "POST") {
      return jsonResponse({ error: "Method not allowed." }, 405);
    }

    try {
      const command = parseInput(await readBoundedJson(request));
      const result = await dependencies.applyAction(command);
      if (result === null) {
        throw new ApplicantPrivacyRequestError("Privacy access denied.", 403);
      }
      return jsonResponse(result, 202);
    } catch (error) {
      if (error instanceof ApplicantPrivacyRequestError) {
        return jsonResponse({ error: error.message }, error.status);
      }
      if (error instanceof SyntaxError) {
        return jsonResponse({ error: "Invalid privacy request." }, 400);
      }
      return jsonResponse({ error: "Unable to record privacy request." }, 500);
    }
  };
}

function parseInput(value: unknown): ApplicantPrivacyCommand {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ApplicantPrivacyRequestError("Invalid privacy request.", 400);
  }
  const input = value as Record<string, unknown>;
  const allowedKeys = new Set([
    "applicationId",
    "opportunityId",
    "submissionAttemptId",
    "action",
  ]);
  if (
    Object.keys(input).length !== allowedKeys.size ||
    Object.keys(input).some((key) => !allowedKeys.has(key))
  ) {
    throw new ApplicantPrivacyRequestError("Invalid privacy request.", 400);
  }
  for (const key of [
    "applicationId",
    "opportunityId",
    "submissionAttemptId",
  ] as const) {
    if (typeof input[key] !== "string" || !uuidPattern.test(input[key])) {
      throw new ApplicantPrivacyRequestError("Invalid privacy request.", 400);
    }
  }
  if (!isApplicantPrivacyAction(input.action)) {
    throw new ApplicantPrivacyRequestError("Invalid privacy request.", 400);
  }
  return {
    applicationId: input.applicationId as string,
    opportunityId: input.opportunityId as string,
    submissionAttemptId: input.submissionAttemptId as string,
    action: input.action,
  };
}

function isApplicantPrivacyAction(
  value: unknown,
): value is ApplicantPrivacyAction {
  return (
    value === "revoke_future_opportunity_consent" ||
    value === "request_deletion"
  );
}

async function readBoundedJson(request: Request): Promise<unknown> {
  const contentLength = request.headers.get("Content-Length");
  if (contentLength !== null) {
    if (!/^(0|[1-9][0-9]*)$/.test(contentLength)) {
      throw new ApplicantPrivacyRequestError("Invalid privacy request.", 400);
    }
    if (Number(contentLength) > MAX_BODY_BYTES) {
      throw new ApplicantPrivacyRequestError(
        "Privacy request is too large.",
        413,
      );
    }
  }
  const reader = request.body?.getReader();
  if (reader === undefined) return JSON.parse("") as unknown;
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    byteLength += value.byteLength;
    if (byteLength > MAX_BODY_BYTES) {
      await reader.cancel();
      throw new ApplicantPrivacyRequestError(
        "Privacy request is too large.",
        413,
      );
    }
    chunks.push(value);
  }
  const body = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(body);
  } catch {
    throw new ApplicantPrivacyRequestError("Invalid privacy request.", 400);
  }
  return JSON.parse(text) as unknown;
}

const corsHeaders = {
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Origin": "*",
  "Content-Type": "application/json",
};

function jsonResponse(body: unknown, status: number) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}

export function createSupabaseDependencies(
  client: SupabaseClient,
): ApplicantPrivacyDependencies {
  return {
    async applyAction(command) {
      const { data, error } = await client.rpc("manage_applicant_privacy", {
        p_application_id: command.applicationId,
        p_opportunity_id: command.opportunityId,
        p_submission_attempt_id: command.submissionAttemptId,
        p_action: command.action,
      });
      if (error !== null) throw error;
      if (data === null) return null;
      if (!isApplicantPrivacyResult(data)) {
        throw new Error("Invalid applicant privacy result.");
      }
      return data;
    },
  };
}

function isApplicantPrivacyResult(
  value: unknown,
): value is ApplicantPrivacyResult {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const result = value as Record<string, unknown>;
  return (
    Object.keys(result).length === 2 &&
    ((result.action === "revoke_future_opportunity_consent" &&
      result.status === "accepted") ||
      (result.action === "request_deletion" && result.status === "pending"))
  );
}

if (import.meta.main) {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Applicant privacy server environment is not configured.");
  }
  const client = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });
  Deno.serve(
    createManageApplicantPrivacyHandler(createSupabaseDependencies(client)),
  );
}
