import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Resolves the opportunity for an applicant who holds a receipt number and
// private management code. It authorizes nothing by itself: get-attendance and
// manage-applicant-privacy re-validate the full capability on every call.
// No quota is needed because the private code is a random UUIDv4 secret.

const MAX_BODY_BYTES = 1024;
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface ResolveApplicationDependencies {
  findOpportunityId: (
    applicationId: string,
    submissionAttemptId: string,
  ) => Promise<string | null>;
}

interface ResolveApplicationInput {
  applicationId: string;
  submissionAttemptId: string;
}

class ResolveApplicationError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ResolveApplicationError";
  }
}

export function createResolveApplicationHandler(
  dependencies: ResolveApplicationDependencies,
) {
  return async (request: Request): Promise<Response> => {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }
    if (request.method !== "POST") {
      return jsonResponse({ error: "Method not allowed." }, 405);
    }

    try {
      const input = parseInput(await readBoundedJson(request));
      const opportunityId = await dependencies.findOpportunityId(
        input.applicationId,
        input.submissionAttemptId,
      );
      if (opportunityId === null) {
        throw new ResolveApplicationError(
          "No application matches this receipt.",
          404,
        );
      }
      return jsonResponse({ opportunityId }, 200);
    } catch (error) {
      if (error instanceof ResolveApplicationError) {
        return jsonResponse({ error: error.message }, error.status);
      }
      console.error(error);
      return jsonResponse({ error: "Unable to resolve the application." }, 500);
    }
  };
}

function parseInput(value: unknown): ResolveApplicationInput {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ResolveApplicationError("Invalid application receipt.", 400);
  }
  const keys = Object.keys(value).sort();
  const input = value as Partial<ResolveApplicationInput>;
  if (
    keys.length !== 2 ||
    keys[0] !== "applicationId" ||
    keys[1] !== "submissionAttemptId" ||
    typeof input.applicationId !== "string" ||
    typeof input.submissionAttemptId !== "string" ||
    !uuidPattern.test(input.applicationId) ||
    !uuidPattern.test(input.submissionAttemptId)
  ) {
    throw new ResolveApplicationError("Invalid application receipt.", 400);
  }
  return {
    applicationId: input.applicationId,
    submissionAttemptId: input.submissionAttemptId,
  };
}

async function readBoundedJson(request: Request): Promise<unknown> {
  const contentLength = request.headers.get("Content-Length");
  if (contentLength !== null) {
    if (!/^(0|[1-9][0-9]*)$/.test(contentLength)) {
      throw new ResolveApplicationError("Invalid Content-Length.", 400);
    }
    if (Number(contentLength) > MAX_BODY_BYTES) {
      throw new ResolveApplicationError("Receipt request is too large.", 413);
    }
  }
  const body = new Uint8Array(await request.arrayBuffer());
  if (body.byteLength > MAX_BODY_BYTES) {
    throw new ResolveApplicationError("Receipt request is too large.", 413);
  }
  try {
    return JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(body),
    ) as unknown;
  } catch {
    throw new ResolveApplicationError("Invalid application receipt.", 400);
  }
}

const corsHeaders = {
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Origin": "*",
  "Content-Type": "application/json",
};

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}

export function createSupabaseDependencies(
  client: SupabaseClient,
): ResolveApplicationDependencies {
  return {
    async findOpportunityId(applicationId, submissionAttemptId) {
      const { data, error } = await client
        .from("applications")
        .select("opportunity_id")
        .eq("id", applicationId)
        .eq("submission_attempt_id", submissionAttemptId)
        .eq("submission_state", "submitted")
        .maybeSingle<{ opportunity_id: string }>();
      if (error !== null) throw error;
      return data?.opportunity_id ?? null;
    },
  };
}

if (import.meta.main) {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Resolve-application environment is not configured.");
  }
  const client = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });
  Deno.serve(
    createResolveApplicationHandler(createSupabaseDependencies(client)),
  );
}
