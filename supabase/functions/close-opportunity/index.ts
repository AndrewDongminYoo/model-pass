import { createClient } from "@supabase/supabase-js";

const MAX_BODY_BYTES = 1024;
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const corsHeaders = {
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Origin": "*",
  "Content-Type": "application/json",
};

interface ClosureResult {
  opportunityId: string;
  status: "closed";
  closedAt: string;
}

export interface ClosureDependencies {
  authenticate: (accessToken: string) => Promise<string | null>;
  closeOwnedOpportunity: (input: {
    opportunityId: string;
    recruiterId: string;
  }) => Promise<ClosureResult | null>;
}

class ClosureRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export function createCloseOpportunityHandler(
  dependencies: ClosureDependencies,
) {
  return async (request: Request): Promise<Response> => {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }
    if (request.method !== "POST") {
      return jsonResponse({ error: "Method not allowed." }, 405);
    }

    try {
      const accessToken = /^Bearer\s+(\S+)$/i.exec(
        request.headers.get("Authorization") ?? "",
      )?.[1];
      if (accessToken === undefined) {
        throw new ClosureRequestError(
          "Recruiter authentication is required.",
          401,
        );
      }
      const recruiterId = await dependencies.authenticate(accessToken);
      if (recruiterId === null) {
        throw new ClosureRequestError(
          "Recruiter authentication is required.",
          401,
        );
      }

      const input = await readBoundedJson(request);
      if (
        typeof input !== "object" ||
        input === null ||
        Array.isArray(input) ||
        Object.keys(input).length !== 1 ||
        typeof (input as { opportunityId?: unknown }).opportunityId !==
          "string" ||
        !uuidPattern.test((input as { opportunityId: string }).opportunityId)
      ) {
        throw new ClosureRequestError("Invalid closure request.", 400);
      }
      const result = await dependencies.closeOwnedOpportunity({
        opportunityId: (input as { opportunityId: string }).opportunityId,
        recruiterId,
      });
      if (result === null) {
        throw new ClosureRequestError("Opportunity not found.", 404);
      }
      return jsonResponse(result, 200);
    } catch (error) {
      if (error instanceof ClosureRequestError) {
        return jsonResponse({ error: error.message }, error.status);
      }
      if (error instanceof SyntaxError) {
        return jsonResponse({ error: "Invalid closure request." }, 400);
      }
      console.error(error);
      return jsonResponse({ error: "Unable to close the opportunity." }, 500);
    }
  };
}

async function readBoundedJson(request: Request): Promise<unknown> {
  const reader = request.body?.getReader();
  if (reader === undefined) {
    throw new ClosureRequestError("Invalid closure request.", 400);
  }
  const chunks: Uint8Array[] = [];
  let byteCount = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    byteCount += value.byteLength;
    if (byteCount > MAX_BODY_BYTES) {
      await reader.cancel();
      throw new ClosureRequestError("Closure request is too large.", 413);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(byteCount);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}

export function createSupabaseDependencies(
  supabaseUrl: string,
  anonKey: string,
  serviceRoleKey: string,
): ClosureDependencies {
  const authClient = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false },
  });
  const persistenceClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });
  return {
    async authenticate(accessToken) {
      const { data, error } = await authClient.auth.getUser(accessToken);
      return error === null && data.user !== null ? data.user.id : null;
    },
    async closeOwnedOpportunity(input) {
      const { data, error } = await persistenceClient.rpc(
        "close_opportunity_for_recruiter",
        {
          p_opportunity_id: input.opportunityId,
          p_recruiter_id: input.recruiterId,
        },
      );
      if (error !== null) throw error;
      if (data === null) return null;
      if (
        typeof data !== "object" ||
        data.opportunityId !== input.opportunityId ||
        data.status !== "closed" ||
        typeof data.closedAt !== "string" ||
        Number.isNaN(Date.parse(data.closedAt))
      ) {
        throw new Error("Closure returned an invalid result.");
      }
      return data as ClosureResult;
    },
  };
}

if (import.meta.main) {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    throw new Error("Supabase server environment is not configured.");
  }
  Deno.serve(
    createCloseOpportunityHandler(
      createSupabaseDependencies(supabaseUrl, anonKey, serviceRoleKey),
    ),
  );
}
