import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { attendanceAccessToken } from "../_shared/attendance-access.ts";
import type {
  AttendanceEvent,
  AttendanceEventType,
  AttendanceParty,
  AttendanceResolution,
} from "../../../src/features/attendance/domain/attendance.ts";

const MAX_BODY_BYTES = 4 * 1024;
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type AttendanceActor =
  | { party: "applicant" }
  | { party: "recruiter" | "operator"; userId: string | null };

interface AttendanceCapability {
  applicationId: string;
  opportunityId: string;
  submissionAttemptId?: string;
}

interface AttendanceAccess {
  actor: AttendanceActor;
  startsAt: string;
  selected: boolean;
}

export interface GetAttendanceDependencies {
  now: () => Date;
  resolveAccess: (
    capability: AttendanceCapability,
    accessToken: string | undefined,
  ) => Promise<AttendanceAccess | null>;
  loadEvents: (applicationId: string) => Promise<AttendanceEvent[]>;
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

export function createGetAttendanceHandler(
  dependencies: GetAttendanceDependencies,
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
      if (
        access === null ||
        access.actor.party === "operator" ||
        (access.actor.party === "applicant" &&
          input.submissionAttemptId === undefined)
      ) {
        throw new AttendanceRequestError("Attendance access denied.", 403);
      }
      if (!access.selected) {
        return jsonResponse(
          {
            applicationId: input.applicationId,
            viewerParty: access.actor.party,
            selected: false,
            allowedActions: [],
            events: [],
          },
          200,
        );
      }
      const events = filterEvents(
        await dependencies.loadEvents(input.applicationId),
        access.actor.party,
      );
      return jsonResponse(
        {
          applicationId: input.applicationId,
          viewerParty: access.actor.party,
          selected: true,
          allowedActions: allowedActions(
            access.actor.party,
            access.startsAt,
            dependencies.now(),
          ),
          events,
        },
        200,
      );
    } catch (error) {
      if (error instanceof AttendanceRequestError) {
        return jsonResponse({ error: error.message }, error.status);
      }
      if (error instanceof SyntaxError) {
        return jsonResponse({ error: "Invalid attendance request." }, 400);
      }
      console.error(error);
      return jsonResponse({ error: "Unable to load attendance." }, 500);
    }
  };
}

function allowedActions(
  party: AttendanceParty,
  startsAtValue: string,
  now: Date,
): AttendanceEventType[] {
  const startsAt = new Date(startsAtValue);
  if (Number.isNaN(startsAt.getTime())) {
    throw new Error("Attendance appointment time is invalid.");
  }
  if (now < startsAt) {
    return [
      party === "recruiter" ? "recruiter_confirmed" : "applicant_confirmed",
      party === "recruiter" ? "recruiter_cancelled" : "applicant_cancelled",
    ];
  }
  return party === "recruiter"
    ? ["completed", "applicant_no_show"]
    : ["completed", "recruiter_no_show"];
}

function filterEvents(
  events: AttendanceEvent[],
  viewerParty: AttendanceParty,
): AttendanceEvent[] {
  const eventsById = new Map(events.map((event) => [event.id, event]));
  const disputesByNoShow = new Map<string, AttendanceEvent>();
  const resolutionsByDispute = new Map<string, AttendanceEvent>();
  for (const event of events) {
    if (event.eventType === "dispute_opened" && event.relatedEventId) {
      disputesByNoShow.set(event.relatedEventId, event);
    } else if (event.eventType === "dispute_resolved" && event.relatedEventId) {
      resolutionsByDispute.set(event.relatedEventId, event);
    }
  }

  const noShowIsVisible = (noShow: AttendanceEvent): boolean => {
    if (noShow.party === viewerParty) return true;
    const dispute = disputesByNoShow.get(noShow.id);
    return (
      dispute === undefined ||
      resolutionsByDispute.get(dispute.id)?.resolution === "confirmed"
    );
  };

  return events.filter((event) => {
    if (
      event.eventType === "recruiter_no_show" ||
      event.eventType === "applicant_no_show"
    ) {
      return noShowIsVisible(event);
    }
    if (event.eventType === "dispute_opened") {
      const noShow =
        event.relatedEventId === undefined
          ? undefined
          : eventsById.get(event.relatedEventId);
      return noShow !== undefined && noShowIsVisible(noShow);
    }
    if (event.eventType === "dispute_resolved") {
      const dispute =
        event.relatedEventId === undefined
          ? undefined
          : eventsById.get(event.relatedEventId);
      const noShow =
        dispute?.relatedEventId === undefined
          ? undefined
          : eventsById.get(dispute.relatedEventId);
      return noShow !== undefined && noShowIsVisible(noShow);
    }
    return true;
  });
}

function parseInput(value: unknown): AttendanceCapability {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new AttendanceRequestError("Invalid attendance request.", 400);
  }
  const input = value as Record<string, unknown>;
  const allowedKeys = new Set([
    "applicationId",
    "opportunityId",
    "submissionAttemptId",
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
  return {
    applicationId: input.applicationId as string,
    opportunityId: input.opportunityId as string,
    ...(submissionAttemptId ? { submissionAttemptId } : {}),
  };
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
  const body = new Uint8Array(await request.arrayBuffer());
  if (body.byteLength > MAX_BODY_BYTES) {
    throw new AttendanceRequestError("Attendance request is too large.", 413);
  }
  try {
    return JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(body),
    ) as unknown;
  } catch (error) {
    if (error instanceof AttendanceRequestError) throw error;
    throw new AttendanceRequestError("Invalid attendance request.", 400);
  }
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

interface AttendanceEventRow {
  id: string;
  party: string;
  event_type: string;
  occurred_at: string;
  related_event_id: string | null;
  resolution: string | null;
}

export function createSupabaseDependencies(
  client: SupabaseClient,
  serviceRoleKey: string,
): GetAttendanceDependencies {
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
    async loadEvents(applicationId) {
      const { data, error } = await client
        .from("attendance_events")
        .select(
          "id, party, event_type, occurred_at, related_event_id, resolution",
        )
        .eq("application_id", applicationId)
        .order("occurred_at", { ascending: true })
        .order("id", { ascending: true });
      if (error !== null) throw error;
      return (data as AttendanceEventRow[]).map(parseEvent);
    },
  };
}

function parseEvent(row: AttendanceEventRow): AttendanceEvent {
  if (!isParty(row.party) || !isEventType(row.event_type)) {
    throw new Error("Attendance history is invalid.");
  }
  if (row.resolution !== null && !isResolution(row.resolution)) {
    throw new Error("Attendance history is invalid.");
  }
  return {
    id: row.id,
    party: row.party,
    eventType: row.event_type,
    occurredAt: row.occurred_at,
    ...(row.related_event_id === null
      ? {}
      : { relatedEventId: row.related_event_id }),
    ...(row.resolution === null ? {} : { resolution: row.resolution }),
  };
}

function isParty(value: string): value is AttendanceParty {
  return value === "recruiter" || value === "applicant";
}

function isEventType(value: string): value is AttendanceEventType {
  return new Set<AttendanceEventType>([
    "recruiter_confirmed",
    "applicant_confirmed",
    "completed",
    "recruiter_cancelled",
    "applicant_cancelled",
    "recruiter_no_show",
    "applicant_no_show",
    "dispute_opened",
    "dispute_resolved",
  ]).has(value as AttendanceEventType);
}

function isResolution(value: string): value is AttendanceResolution {
  return value === "confirmed" || value === "rejected";
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
    createGetAttendanceHandler(
      createSupabaseDependencies(client, serviceRoleKey),
      anonKey,
    ),
  );
}
