import { FunctionsHttpError } from "@supabase/supabase-js";
import { getSupabaseClient } from "../../../lib/supabase/client";
import type {
  AttendanceEvent,
  AttendanceEventType,
  AttendanceParty,
  AttendanceResolution,
} from "../../attendance/domain/attendance";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface AttendanceCapability {
  applicationId: string;
  opportunityId: string;
  submissionAttemptId?: string;
}

export interface AttendanceStatus {
  applicationId: string;
  viewerParty: AttendanceParty;
  selected: boolean;
  allowedActions: AttendanceEventType[];
  events: AttendanceEvent[];
}

export interface ApplicationSelection {
  applicationId: string;
  selectedAt: string;
}

export interface ApplicationUnselection {
  applicationId: string;
}

export interface RecordAttendanceInput extends AttendanceCapability {
  eventType: AttendanceEventType;
  party: AttendanceParty;
  relatedEventId?: string;
  resolution?: AttendanceResolution;
}

export class AttendanceRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AttendanceRequestError";
  }
}

export async function getAttendance(
  capability: AttendanceCapability,
): Promise<AttendanceStatus> {
  const { data, error } = await getSupabaseClient().functions.invoke(
    "get-attendance",
    { body: capabilityBody(capability) },
  );
  if (error !== null) {
    throw (await parseAttendanceHttpError(error)) ?? error;
  }
  if (!isAttendanceStatus(data, capability.applicationId)) {
    throw new Error("The attendance response is invalid.");
  }
  return data;
}

export async function selectApplication(
  capability: Pick<AttendanceCapability, "applicationId" | "opportunityId">,
): Promise<ApplicationSelection> {
  const { data, error } = await getSupabaseClient().functions.invoke(
    "select-application",
    { body: capabilityBody(capability) },
  );
  if (error !== null) {
    throw (await parseAttendanceHttpError(error)) ?? error;
  }
  if (!isApplicationSelection(data, capability.applicationId)) {
    throw new Error("The selection response is invalid.");
  }
  return data;
}

export async function unselectApplication(
  capability: Pick<AttendanceCapability, "applicationId" | "opportunityId">,
): Promise<ApplicationUnselection> {
  const { data, error } = await getSupabaseClient().functions.invoke(
    "select-application",
    { body: { ...capabilityBody(capability), action: "unselect" } },
  );
  if (error !== null) {
    throw (await parseAttendanceHttpError(error)) ?? error;
  }
  if (
    typeof data !== "object" ||
    data === null ||
    (data as { applicationId?: unknown }).applicationId !==
      capability.applicationId
  ) {
    throw new Error("The selection reversal response is invalid.");
  }
  return data as ApplicationUnselection;
}

export async function recordAttendance(
  input: RecordAttendanceInput,
): Promise<AttendanceEvent> {
  const { data, error } = await getSupabaseClient().functions.invoke(
    "record-attendance",
    {
      body: {
        ...capabilityBody(input),
        eventType: input.eventType,
        party: input.party,
        ...(input.relatedEventId === undefined
          ? {}
          : { relatedEventId: input.relatedEventId }),
        ...(input.resolution === undefined
          ? {}
          : { resolution: input.resolution }),
      },
    },
  );
  if (error !== null) {
    throw (await parseAttendanceHttpError(error)) ?? error;
  }
  const event = parseAttendanceEvent(data);
  if (event === null) {
    throw new Error("The attendance response is invalid.");
  }
  return event;
}

function capabilityBody(capability: AttendanceCapability) {
  return {
    applicationId: capability.applicationId,
    opportunityId: capability.opportunityId,
    ...(capability.submissionAttemptId === undefined
      ? {}
      : { submissionAttemptId: capability.submissionAttemptId }),
  };
}

async function parseAttendanceHttpError(
  error: unknown,
): Promise<AttendanceRequestError | null> {
  if (
    !(error instanceof FunctionsHttpError) ||
    !(error.context instanceof Response)
  ) {
    return null;
  }
  try {
    const body: unknown = await error.context.json();
    const message =
      typeof body === "object" &&
      body !== null &&
      typeof (body as { error?: unknown }).error === "string"
        ? (body as { error: string }).error
        : undefined;
    return message !== undefined && message.length > 0 && message.length <= 500
      ? new AttendanceRequestError(message)
      : null;
  } catch {
    return null;
  }
}

function isAttendanceStatus(
  value: unknown,
  expectedApplicationId: string,
): value is AttendanceStatus {
  if (typeof value !== "object" || value === null) return false;
  const result = value as Record<string, unknown>;
  return (
    result.applicationId === expectedApplicationId &&
    isParty(result.viewerParty) &&
    typeof result.selected === "boolean" &&
    Array.isArray(result.allowedActions) &&
    result.allowedActions.every(isEventType) &&
    Array.isArray(result.events) &&
    result.events.every((event) => parseAttendanceEvent(event) !== null)
  );
}

function isApplicationSelection(
  value: unknown,
  expectedApplicationId: string,
): value is ApplicationSelection {
  if (typeof value !== "object" || value === null) return false;
  const selection = value as Record<string, unknown>;
  return (
    selection.applicationId === expectedApplicationId &&
    typeof selection.selectedAt === "string" &&
    Number.isFinite(Date.parse(selection.selectedAt))
  );
}

function parseAttendanceEvent(value: unknown): AttendanceEvent | null {
  if (typeof value !== "object" || value === null) return null;
  const event = value as Record<string, unknown>;
  if (
    typeof event.id !== "string" ||
    !uuidPattern.test(event.id) ||
    !isEventType(event.eventType) ||
    !isParty(event.party) ||
    typeof event.occurredAt !== "string" ||
    !Number.isFinite(Date.parse(event.occurredAt)) ||
    (event.relatedEventId !== undefined &&
      event.relatedEventId !== null &&
      (typeof event.relatedEventId !== "string" ||
        !uuidPattern.test(event.relatedEventId))) ||
    (event.resolution !== undefined &&
      event.resolution !== null &&
      !isResolution(event.resolution))
  ) {
    return null;
  }
  return {
    id: event.id,
    eventType: event.eventType,
    party: event.party,
    occurredAt: event.occurredAt,
    ...(typeof event.relatedEventId === "string"
      ? { relatedEventId: event.relatedEventId }
      : {}),
    ...(isResolution(event.resolution) ? { resolution: event.resolution } : {}),
  };
}

function isParty(value: unknown): value is AttendanceParty {
  return value === "recruiter" || value === "applicant";
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

function isResolution(value: unknown): value is AttendanceResolution {
  return value === "confirmed" || value === "rejected";
}
