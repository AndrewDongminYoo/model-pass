import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { attendanceAccessToken } from "../_shared/attendance-access.ts";
import type {
  AttendanceEventType,
  AttendanceParty,
  AttendanceResolution,
} from "../../../src/features/attendance/domain/attendance.ts";

const MAX_BODY_BYTES = 4 * 1024;
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type AttendanceActor =
  | { party: "applicant" }
  | { party: "recruiter" | "operator"; userId: string | null };

interface AttendanceCapability {
  applicationId: string;
  opportunityId: string;
  submissionAttemptId?: string;
}

interface RecordAttendanceCommand extends AttendanceCapability {
  actor: AttendanceActor;
  eventType: AttendanceEventType;
  party: AttendanceParty;
  relatedEventId?: string;
  resolution?: AttendanceResolution;
}

interface AttendanceAccess {
  actor: AttendanceActor;
  startsAt: string;
  selected: boolean;
}

export interface RecordAttendanceDependencies {
  now: () => Date;
  resolveAccess: (
    capability: AttendanceCapability,
    accessToken: string | undefined,
  ) => Promise<AttendanceAccess | null>;
  recordEvent: (command: RecordAttendanceCommand) => Promise<unknown>;
}

class AttendanceRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "AttendanceRequestError";
  }
}

export function createRecordAttendanceHandler(
  dependencies: RecordAttendanceDependencies,
  platformAnonToken?: string,
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
      const bearerToken = readBearerToken(request.headers.get("Authorization"));
      const access = await dependencies.resolveAccess(
        input,
        attendanceAccessToken(
          input.submissionAttemptId !== undefined,
          bearerToken,
          platformAnonToken,
        ),
      );
      if (access === null) {
        throw new AttendanceRequestError("Attendance access denied.", 403);
      }
      if (!access.selected) {
        throw new AttendanceRequestError(
          "Attendance is unavailable until recruiter selection.",
          409,
        );
      }
      if (
        access.actor.party === "applicant" &&
        input.submissionAttemptId === undefined
      ) {
        throw new AttendanceRequestError("Attendance access denied.", 403);
      }
      assertActorPermission(access.actor, input);
      assertEventTime(input.eventType, access.startsAt, dependencies.now());
      const result = await dependencies.recordEvent({
        ...input,
        actor: access.actor,
      });
      return jsonResponse(result, 201);
    } catch (error) {
      if (error instanceof AttendanceRequestError) {
        return jsonResponse({ error: error.message }, error.status);
      }
      if (error instanceof SyntaxError) {
        return jsonResponse({ error: "Invalid attendance request." }, 400);
      }
      console.error(error);
      return jsonResponse({ error: "Unable to record attendance." }, 500);
    }
  };
}

function assertEventTime(
  eventType: AttendanceEventType,
  startsAtValue: string,
  now: Date,
): void {
  const startsAt = new Date(startsAtValue);
  if (Number.isNaN(startsAt.getTime())) {
    throw new Error("Attendance appointment time is invalid.");
  }
  const isConfirmation =
    eventType === "recruiter_confirmed" || eventType === "applicant_confirmed";
  const isCancellation =
    eventType === "recruiter_cancelled" || eventType === "applicant_cancelled";
  const isPostAppointmentOutcome = new Set<AttendanceEventType>([
    "completed",
    "recruiter_no_show",
    "applicant_no_show",
  ]).has(eventType);
  if (isConfirmation && now >= startsAt) {
    throw new AttendanceRequestError(
      "Attendance confirmation is only available before the appointment.",
      409,
    );
  }
  if (isCancellation && now >= startsAt) {
    throw new AttendanceRequestError(
      "Attendance cancellation is only available before the appointment.",
      409,
    );
  }
  if (isPostAppointmentOutcome && now < startsAt) {
    throw new AttendanceRequestError(
      "Attendance outcomes are only available after the appointment starts.",
      409,
    );
  }
}

function assertActorPermission(
  actor: AttendanceActor,
  input: ReturnType<typeof parseInput>,
): void {
  if (input.eventType === "dispute_resolved") {
    if (actor.party !== "operator") {
      throw new AttendanceRequestError(
        "Operator authorization is required.",
        403,
      );
    }
    return;
  }
  if (actor.party === "operator") {
    throw new AttendanceRequestError(
      "Operators may only resolve disputes.",
      403,
    );
  }
  if (input.eventType === "dispute_opened") {
    if (actor.party !== input.party) {
      throw new AttendanceRequestError(
        "A participant may only dispute an event for its own party.",
        403,
      );
    }
    return;
  }
  const allowed =
    actor.party === "recruiter"
      ? new Set<AttendanceEventType>([
          "recruiter_confirmed",
          "recruiter_cancelled",
          "completed",
          "applicant_no_show",
        ])
      : new Set<AttendanceEventType>([
          "applicant_confirmed",
          "applicant_cancelled",
          "completed",
          "recruiter_no_show",
        ]);
  if (!allowed.has(input.eventType)) {
    throw new AttendanceRequestError(
      "This actor cannot record that event.",
      403,
    );
  }
  const expectedParty = partyForEvent(input.eventType, actor.party);
  if (input.party !== expectedParty) {
    throw new AttendanceRequestError(
      "Attendance party does not match the event.",
      403,
    );
  }
}

function partyForEvent(
  eventType: AttendanceEventType,
  actorParty: AttendanceParty,
): AttendanceParty {
  if (eventType.startsWith("recruiter_")) return "recruiter";
  if (eventType.startsWith("applicant_")) return "applicant";
  return actorParty;
}

function parseInput(value: unknown) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new AttendanceRequestError("Invalid attendance request.", 400);
  }
  const input = value as Record<string, unknown>;
  const allowedKeys = new Set([
    "applicationId",
    "opportunityId",
    "submissionAttemptId",
    "eventType",
    "party",
    "relatedEventId",
    "resolution",
  ]);
  if (Object.keys(input).some((key) => !allowedKeys.has(key))) {
    throw new AttendanceRequestError("Invalid attendance request.", 400);
  }
  for (const key of ["applicationId", "opportunityId"] as const) {
    if (typeof input[key] !== "string" || !uuidPattern.test(input[key])) {
      throw new AttendanceRequestError("Invalid attendance request.", 400);
    }
  }
  const submissionAttemptId = optionalUuid(input.submissionAttemptId);
  if (!isEventType(input.eventType) || !isParty(input.party)) {
    throw new AttendanceRequestError("Invalid attendance request.", 400);
  }
  const relatedEventId = optionalUuid(input.relatedEventId);
  const resolution = input.resolution;
  if (
    (input.eventType === "dispute_opened" ||
      input.eventType === "dispute_resolved") !==
      (relatedEventId !== undefined) ||
    (input.eventType === "dispute_resolved") !== isResolution(resolution)
  ) {
    throw new AttendanceRequestError("Invalid attendance request.", 400);
  }
  return {
    applicationId: input.applicationId as string,
    opportunityId: input.opportunityId as string,
    ...(submissionAttemptId ? { submissionAttemptId } : {}),
    eventType: input.eventType,
    party: input.party,
    ...(relatedEventId ? { relatedEventId } : {}),
    ...(isResolution(resolution) ? { resolution } : {}),
  };
}

function isEventType(value: unknown): value is AttendanceEventType {
  return (
    typeof value === "string" &&
    new Set<AttendanceEventType>([
      "recruiter_confirmed",
      "applicant_confirmed",
      "completed",
      "recruiter_cancelled",
      "applicant_cancelled",
      "recruiter_no_show",
      "applicant_no_show",
      "dispute_opened",
      "dispute_resolved",
    ]).has(value as AttendanceEventType)
  );
}

function isParty(value: unknown): value is AttendanceParty {
  return value === "recruiter" || value === "applicant";
}

function isResolution(value: unknown): value is AttendanceResolution {
  return value === "confirmed" || value === "rejected";
}

function optionalUuid(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !uuidPattern.test(value)) {
    throw new AttendanceRequestError("Invalid attendance request.", 400);
  }
  return value;
}

async function readBoundedJson(request: Request): Promise<unknown> {
  const contentLength = request.headers.get("Content-Length");
  if (contentLength !== null) {
    if (!/^(0|[1-9][0-9]*)$/.test(contentLength)) {
      throw new AttendanceRequestError("Invalid Content-Length.", 400);
    }
    if (Number(contentLength) > MAX_BODY_BYTES) {
      throw new AttendanceRequestError("Attendance request is too large.", 413);
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
      throw new AttendanceRequestError("Attendance request is too large.", 413);
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
    throw new AttendanceRequestError("Invalid attendance request.", 400);
  }
  if (body.byteLength > MAX_BODY_BYTES) {
    throw new AttendanceRequestError("Attendance request is too large.", 413);
  }
  return JSON.parse(text) as unknown;
}

function readBearerToken(header: string | null): string | undefined {
  if (header === null) return undefined;
  const token = /^Bearer (\S+)$/.exec(header)?.[1];
  if (token === undefined) {
    throw new AttendanceRequestError("Attendance access denied.", 403);
  }
  return token;
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
  serviceRoleKey: string,
): RecordAttendanceDependencies {
  return {
    now: () => new Date(),
    async resolveAccess(capability, accessToken) {
      let actor: AttendanceActor;
      if (
        accessToken !== undefined &&
        (await constantTimeEqual(accessToken, serviceRoleKey))
      ) {
        actor = { party: "operator", userId: null };
      } else if (accessToken !== undefined) {
        const { data: authData, error: authError } =
          await client.auth.getUser(accessToken);
        if (authError !== null || authData.user === null) return null;
        actor =
          authData.user.app_metadata.role === "operator"
            ? { party: "operator", userId: authData.user.id }
            : { party: "recruiter", userId: authData.user.id };
      } else {
        if (capability.submissionAttemptId === undefined) return null;
        actor = { party: "applicant" };
      }

      let applicationQuery = client
        .from("applications")
        .select("id, selected_at")
        .eq("id", capability.applicationId)
        .eq("opportunity_id", capability.opportunityId)
        .eq("submission_state", "submitted");
      if (actor.party === "applicant") {
        applicationQuery = applicationQuery.eq(
          "submission_attempt_id",
          capability.submissionAttemptId,
        );
      }
      const { data: application, error: applicationError } =
        await applicationQuery.maybeSingle<{
          id: string;
          selected_at: string | null;
        }>();
      if (applicationError !== null) throw applicationError;
      if (application === null) return null;

      let opportunityQuery = client
        .from("opportunities")
        .select("id, starts_at")
        .eq("id", capability.opportunityId);
      if (actor.party === "recruiter") {
        opportunityQuery = opportunityQuery.eq("recruiter_id", actor.userId);
      }
      const { data: opportunity, error: opportunityError } =
        await opportunityQuery.maybeSingle<{
          id: string;
          starts_at: string;
        }>();
      if (opportunityError !== null) throw opportunityError;
      if (opportunity === null) return null;
      return {
        actor,
        startsAt: opportunity.starts_at,
        selected: application.selected_at !== null,
      };
    },
    async recordEvent(command) {
      const { data, error } = await client.rpc(
        "record_attendance_event_authorized",
        {
          p_application_id: command.applicationId,
          p_actor_party: command.actor.party,
          p_recorded_by:
            "userId" in command.actor ? command.actor.userId : null,
          p_event_type: command.eventType,
          p_party: command.party,
          p_related_event_id: command.relatedEventId ?? null,
          p_resolution: command.resolution ?? null,
          p_occurred_at: null,
          p_submission_attempt_id: command.submissionAttemptId ?? null,
        },
      );
      if (error !== null) throw error;
      return data;
    },
  };
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

if (import.meta.main) {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!supabaseUrl || !serviceRoleKey || !anonKey) {
    throw new Error("Attendance server environment is not configured.");
  }
  const client = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });
  Deno.serve(
    createRecordAttendanceHandler(
      createSupabaseDependencies(client, serviceRoleKey),
      anonKey,
    ),
  );
}
