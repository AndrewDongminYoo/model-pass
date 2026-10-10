import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createTossMessageSender } from "./toss-message-sender.ts";

// Hourly attendance reminder sender. Claim-before-send keeps it at most once;
// see docs/specs/2026-10-10-ait-attendance-reminder.md §Server Call.

const MAX_BODY_BYTES = 1024;
// Stop claiming well inside the hosted wall-clock limit and the workflow's
// 120-second curl timeout: a run killed between claim and finish would leave
// that reminder permanently ambiguous. Unclaimed candidates wait for the next run.
const CLAIM_BUDGET_MS = 60_000;
const DOCUMENTED_TOKEN_PLACEHOLDER =
  "replace-with-a-different-at-least-32-byte-random-secret";

export interface ReminderClaim {
  reminderId: string;
  attemptCount: number;
  anonKey: string;
  startsAt: string;
  venueDistrict: string;
}

export type SendOutcome =
  | { kind: "sent" }
  | { kind: "failed" | "configuration" | "ambiguous"; code: string };

export interface ReminderDependencies {
  now: () => Date;
  elapsedMs: () => number;
  createInvocationId: () => string;
  authorize: (token: string | null) => Promise<boolean>;
  isConfigured: boolean;
  deleteStartedRecipients: (now: Date) => Promise<number>;
  listCandidates: (now: Date) => Promise<string[]>;
  claim: (applicationId: string, now: Date) => Promise<ReminderClaim | null>;
  send: (claim: ReminderClaim) => Promise<SendOutcome>;
  finish: (
    reminderId: string,
    result: "sent" | "failed",
    failureCode: string | null,
    now: Date,
  ) => Promise<boolean>;
  release: (reminderId: string) => Promise<boolean>;
  reportError: (message: string, error: unknown) => void;
}

export interface ReminderRunResult {
  invocationId: string;
  status:
    | "completed"
    | "notConfigured"
    | "stoppedOnConfigurationFailure"
    | "stoppedOnAmbiguousOutcome";
  deletedRecipients: number;
  candidates: number;
  claimed: number;
  sent: number;
  failed: number;
  released: number;
  ambiguous: number;
}

export async function sendAttendanceReminders(
  dependencies: ReminderDependencies,
): Promise<ReminderRunResult> {
  const now = dependencies.now();
  const runStartedMs = dependencies.elapsedMs();
  const result: ReminderRunResult = {
    invocationId: dependencies.createInvocationId(),
    status: "completed",
    deletedRecipients: await dependencies.deleteStartedRecipients(now),
    candidates: 0,
    claimed: 0,
    sent: 0,
    failed: 0,
    released: 0,
    ambiguous: 0,
  };
  // Key cleanup runs even before the certificate and template exist.
  if (!dependencies.isConfigured) {
    result.status = "notConfigured";
    return result;
  }

  const candidates = await dependencies.listCandidates(now);
  result.candidates = candidates.length;
  for (const applicationId of candidates) {
    if (dependencies.elapsedMs() - runStartedMs > CLAIM_BUDGET_MS) break;
    const claim = await dependencies.claim(applicationId, now);
    if (claim === null) continue;
    result.claimed += 1;

    let outcome: SendOutcome;
    try {
      outcome = await dependencies.send(claim);
    } catch (error) {
      dependencies.reportError("Reminder send threw.", error);
      outcome = { kind: "ambiguous", code: "SENDER_ERROR" };
    }

    if (outcome.kind === "sent") {
      await dependencies.finish(claim.reminderId, "sent", null, now);
      result.sent += 1;
    } else if (outcome.kind === "failed") {
      await dependencies.finish(claim.reminderId, "failed", outcome.code, now);
      result.failed += 1;
    } else if (outcome.kind === "configuration") {
      // A broken certificate or template must not spend this attempt.
      await dependencies.release(claim.reminderId);
      result.released += 1;
      result.status = "stoppedOnConfigurationFailure";
      return result;
    } else {
      // The message may have been delivered: keep the claim and stop, so a
      // shared outage strands at most one reminder.
      result.ambiguous += 1;
      result.status = "stoppedOnAmbiguousOutcome";
      return result;
    }
  }
  return result;
}

class ReminderRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ReminderRequestError";
  }
}

export function createSendAttendanceRemindersHandler(
  dependencies: ReminderDependencies,
) {
  return async (request: Request): Promise<Response> => {
    if (request.method !== "POST") {
      return jsonResponse({ error: "Method not allowed." }, 405);
    }
    try {
      const authorized = await dependencies.authorize(
        readBearerToken(request.headers.get("Authorization")),
      );
      if (!authorized) {
        throw new ReminderRequestError(
          "Operator authorization is required.",
          401,
        );
      }
      const body = await readBoundedJson(request);
      if (
        typeof body !== "object" ||
        body === null ||
        Array.isArray(body) ||
        Object.keys(body).length > 0
      ) {
        throw new ReminderRequestError("Invalid reminder request.", 400);
      }
      return jsonResponse(await sendAttendanceReminders(dependencies), 200);
    } catch (error) {
      if (error instanceof ReminderRequestError) {
        return jsonResponse({ error: error.message }, error.status);
      }
      dependencies.reportError("Reminder invocation failed.", error);
      return jsonResponse({ error: "Reminder invocation failed." }, 500);
    }
  };
}

function readBearerToken(header: string | null): string | null {
  return /^Bearer (\S+)$/.exec(header ?? "")?.[1] ?? null;
}

async function readBoundedJson(request: Request): Promise<unknown> {
  const body = new Uint8Array(await request.arrayBuffer());
  if (body.byteLength > MAX_BODY_BYTES) {
    throw new ReminderRequestError("Reminder request is too large.", 413);
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body));
  } catch {
    throw new ReminderRequestError("Invalid reminder request.", 400);
  }
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function constantTimeEqual(
  left: string,
  right: string,
): Promise<boolean> {
  const encoder = new TextEncoder();
  const [leftDigest, rightDigest] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(left)),
    crypto.subtle.digest("SHA-256", encoder.encode(right)),
  ]);
  const leftBytes = new Uint8Array(leftDigest);
  const rightBytes = new Uint8Array(rightDigest);
  let difference = 0;
  for (let index = 0; index < leftBytes.length; index += 1) {
    difference |= leftBytes[index] ^ rightBytes[index];
  }
  return difference === 0;
}

export function validateReminderInvocationSecret(
  secret: string | undefined,
  serviceRoleKey: string,
): string {
  if (
    secret === undefined ||
    secret === DOCUMENTED_TOKEN_PLACEHOLDER ||
    new TextEncoder().encode(secret).byteLength < 32 ||
    secret === serviceRoleKey
  ) {
    throw new Error("Reminder server environment is not configured.");
  }
  return secret;
}

function parseClaim(value: unknown): ReminderClaim | null {
  if (value === null) return null;
  const claim = value as Partial<ReminderClaim> | undefined;
  if (
    typeof claim?.reminderId !== "string" ||
    typeof claim.attemptCount !== "number" ||
    typeof claim.anonKey !== "string" ||
    typeof claim.startsAt !== "string" ||
    typeof claim.venueDistrict !== "string"
  ) {
    throw new Error("Reminder claim has an invalid shape.");
  }
  return claim as ReminderClaim;
}

export function createSupabaseDependencies(
  client: SupabaseClient,
  invocationSecret: string,
  send: ((claim: ReminderClaim) => Promise<SendOutcome>) | null,
): ReminderDependencies {
  return {
    now: () => new Date(),
    elapsedMs: () => performance.now(),
    createInvocationId: () => crypto.randomUUID(),
    async authorize(token) {
      return (
        token !== null && (await constantTimeEqual(token, invocationSecret))
      );
    },
    isConfigured: send !== null,
    async deleteStartedRecipients(now) {
      const { data, error } = await client.rpc(
        "delete_started_toss_recipients",
        { p_now: now.toISOString() },
      );
      if (error !== null || typeof data !== "number") {
        throw error ?? new Error("Recipient cleanup returned no count.");
      }
      return data;
    },
    async listCandidates(now) {
      const { data, error } = await client.rpc(
        "list_attendance_reminder_candidates",
        { p_now: now.toISOString() },
      );
      if (error !== null || !Array.isArray(data)) {
        throw error ?? new Error("Reminder candidates are invalid.");
      }
      return data.map((row: unknown) =>
        typeof row === "string"
          ? row
          : String(
              (row as { list_attendance_reminder_candidates?: unknown })
                .list_attendance_reminder_candidates,
            ),
      );
    },
    async claim(applicationId, now) {
      const { data, error } = await client.rpc("claim_attendance_reminder", {
        p_application_id: applicationId,
        p_kind: "day_before",
        p_now: now.toISOString(),
      });
      if (error !== null) throw error;
      return parseClaim(data);
    },
    send:
      send ??
      (() => Promise.reject(new Error("Reminder sending is not configured."))),
    async finish(reminderId, result, failureCode, now) {
      const { data, error } = await client.rpc("finish_attendance_reminder", {
        p_reminder_id: reminderId,
        p_result: result,
        p_failure_code: failureCode,
        p_now: now.toISOString(),
      });
      if (error !== null) throw error;
      return data === true;
    },
    async release(reminderId) {
      const { data, error } = await client.rpc(
        "release_attendance_reminder_claim",
        { p_reminder_id: reminderId },
      );
      if (error !== null) throw error;
      return data === true;
    },
    reportError: (message, error) => console.error(message, error),
  };
}

if (import.meta.main) {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Reminder server environment is not configured.");
  }
  const invocationSecret = validateReminderInvocationSecret(
    Deno.env.get("ATTENDANCE_REMINDER_TOKEN"),
    serviceRoleKey,
  );
  const certPem = Deno.env.get("TOSS_PARTNER_CERT_PEM");
  const keyPem = Deno.env.get("TOSS_PARTNER_KEY_PEM");
  const templateSetCode = Deno.env.get("TOSS_REMINDER_TEMPLATE_SET_CODE");

  // Unverified until GitHub issue #16: whether the hosted Edge Runtime
  // presents this client certificate is the open question in the spec.
  let send: ((claim: ReminderClaim) => Promise<SendOutcome>) | null = null;
  if (certPem && keyPem && templateSetCode?.startsWith("model-pass-")) {
    const httpClient = Deno.createHttpClient({ cert: certPem, key: keyPem });
    send = createTossMessageSender({
      templateSetCode,
      fetchImpl: (url, init) => fetch(url, { ...init, client: httpClient }),
    });
  }

  const client = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });
  Deno.serve(
    createSendAttendanceRemindersHandler(
      createSupabaseDependencies(client, invocationSecret, send),
    ),
  );
}
