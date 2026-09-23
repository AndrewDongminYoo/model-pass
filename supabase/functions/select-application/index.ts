import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface SelectionInput {
  applicationId: string;
  opportunityId: string;
  action: "select" | "unselect";
}

interface SelectionResult {
  applicationId: string;
  selectedAt: string;
}

interface UnselectionResult {
  applicationId: string;
}

export interface SelectApplicationDependencies {
  authenticate: (accessToken: string) => Promise<string | null>;
  selectOwnedApplication: (
    input: SelectionInput & { recruiterId: string },
  ) => Promise<SelectionResult | UnselectionResult | null>;
}

class SelectionError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export function createSelectApplicationHandler(
  dependencies: SelectApplicationDependencies,
) {
  return async (request: Request): Promise<Response> => {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }
    if (request.method !== "POST") {
      return jsonResponse({ error: "Method not allowed." }, 405);
    }
    try {
      const token = /^Bearer (\S+)$/.exec(
        request.headers.get("Authorization") ?? "",
      )?.[1];
      if (token === undefined) {
        throw new SelectionError("Authentication is required.", 401);
      }
      const recruiterId = await dependencies.authenticate(token);
      if (recruiterId === null) {
        throw new SelectionError("Authentication is required.", 401);
      }
      const input = parseInput(await request.json());
      const selected = await dependencies.selectOwnedApplication({
        ...input,
        recruiterId,
      });
      if (selected === null) {
        throw new SelectionError("Application not found.", 404);
      }
      return jsonResponse(selected, 200);
    } catch (error) {
      if (error instanceof SelectionError) {
        return jsonResponse({ error: error.message }, error.status);
      }
      if (error instanceof SyntaxError) {
        return jsonResponse({ error: "Invalid selection request." }, 400);
      }
      console.error(error);
      return jsonResponse({ error: "Unable to select application." }, 500);
    }
  };
}

function parseInput(value: unknown): SelectionInput {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new SelectionError("Invalid selection request.", 400);
  }
  const input = value as Record<string, unknown>;
  if (
    Object.keys(input).some(
      (key) =>
        key !== "applicationId" && key !== "opportunityId" && key !== "action",
    ) ||
    typeof input.applicationId !== "string" ||
    !uuidPattern.test(input.applicationId) ||
    typeof input.opportunityId !== "string" ||
    !uuidPattern.test(input.opportunityId) ||
    (input.action !== undefined &&
      input.action !== "select" &&
      input.action !== "unselect")
  ) {
    throw new SelectionError("Invalid selection request.", 400);
  }
  return {
    applicationId: input.applicationId,
    opportunityId: input.opportunityId,
    action: input.action === "unselect" ? "unselect" : "select",
  };
}

export function createSupabaseDependencies(
  client: SupabaseClient,
): SelectApplicationDependencies {
  return {
    async authenticate(accessToken) {
      const { data, error } = await client.auth.getUser(accessToken);
      return error === null && data.user !== null ? data.user.id : null;
    },
    async selectOwnedApplication(input) {
      const { data, error } = await client.rpc(
        input.action === "unselect"
          ? "unselect_application_for_recruiter"
          : "select_application_for_recruiter",
        {
          p_application_id: input.applicationId,
          p_opportunity_id: input.opportunityId,
          p_recruiter_id: input.recruiterId,
        },
      );
      if (error !== null) throw error;
      return data as SelectionResult | UnselectionResult | null;
    },
  };
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

if (import.meta.main) {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Selection server environment is not configured.");
  }
  const client = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });
  Deno.serve(
    createSelectApplicationHandler(createSupabaseDependencies(client)),
  );
}
