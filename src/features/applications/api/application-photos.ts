import { getSupabaseClient } from "../../../lib/supabase/client";
import type {
  AnswerValue,
  EvaluationResult,
} from "../../eligibility/domain/types";
import { isEvaluationResult } from "../domain/application";
import type {
  AttendanceEvent,
  AttendanceEventType,
  AttendanceResolution,
} from "../../attendance/domain/attendance";

const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
const ALLOWED_CONTENT_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/heic",
  "image/heif",
]);
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ApplicationPhotoStatus =
  | { status: "pending" }
  | { status: "unavailable" }
  | { status: "submitted"; applicationId: string; photoId: string };

export interface RecruiterApplication {
  id: string;
  createdAt: string;
  applicantDisplayName: string;
  applicantPhone: string;
  evaluation: EvaluationResult;
  answers: Array<{ field: string; value: AnswerValue }>;
  photos: Array<{ id: string; contentType: string; byteSize: number }>;
  attendance: AttendanceEvent[];
}

interface RecruiterApplicationRow {
  id: string;
  created_at: string;
  applicant_display_name: string | null;
  applicant_phone: string | null;
  evaluation_snapshot: unknown;
  application_answers: Array<{ field: string; value: unknown }>;
  application_photos: Array<{
    id: string;
    content_type: string;
    byte_size: number;
  }>;
  attendance_events: Array<{
    id: string;
    party: string;
    event_type: string;
    occurred_at: string;
    related_event_id: string | null;
    resolution: string | null;
  }>;
}

export class RecruiterAuthenticationError extends Error {
  constructor() {
    super("Sign in to review applications.");
    this.name = "RecruiterAuthenticationError";
  }
}

export async function uploadApplicationPhoto(input: {
  applicationId: string;
  opportunityId: string;
  submissionAttemptId: string;
  file: File;
}): Promise<PhotoUploadResult> {
  validatePhoto(input.file);
  const { data, error } = await getSupabaseClient().functions.invoke(
    "create-photo-upload",
    {
      body: {
        applicationId: input.applicationId,
        opportunityId: input.opportunityId,
        submissionAttemptId: input.submissionAttemptId,
        contentType: input.file.type,
        byteSize: input.file.size,
      },
    },
  );
  if (error !== null) {
    throw error;
  }
  if (isPhotoUploadResult(data)) {
    return data;
  }
  if (!isUploadGrant(data)) {
    throw new Error("The photo upload grant is invalid.");
  }

  const response = await fetch(data.uploadUrl, {
    method: "PUT",
    headers: {
      "Content-Type": input.file.type,
      "X-Photo-Storage-Path": data.storagePath,
    },
    body: input.file,
  });
  if (!response.ok) {
    throw new Error("The photo upload failed.");
  }
  const result: unknown = await response.json();
  if (!isPhotoUploadResult(result)) {
    throw new Error("The photo upload response is invalid.");
  }
  return result;
}

export async function getApplicationPhotoStatus(input: {
  applicationId: string;
  opportunityId: string;
  submissionAttemptId: string;
}): Promise<ApplicationPhotoStatus> {
  const { data, error } = await getSupabaseClient().functions.invoke(
    "create-photo-upload",
    { body: { action: "status", ...input } },
  );
  if (error !== null) {
    throw error;
  }
  if (!isApplicationPhotoStatus(data, input.applicationId)) {
    throw new Error("The photo application status response is invalid.");
  }
  return data;
}

export async function createPhotoViewUrl(
  applicationId: string,
  photoId: string,
): Promise<string> {
  const { data, error } = await getSupabaseClient().functions.invoke(
    "create-photo-view",
    { body: { applicationId, photoId } },
  );
  if (error !== null) {
    throw error;
  }
  if (
    typeof data !== "object" ||
    data === null ||
    typeof (data as { viewUrl?: unknown }).viewUrl !== "string" ||
    (data as { expiresIn?: unknown }).expiresIn !== 600
  ) {
    throw new Error("The photo view response is invalid.");
  }
  return (data as { viewUrl: string }).viewUrl;
}

export async function getRecruiterApplications(
  opportunityId: string,
): Promise<RecruiterApplication[]> {
  const client = getSupabaseClient();
  const { data: authData, error: authError } = await client.auth.getUser();
  if (authError !== null || authData.user === null) {
    throw new RecruiterAuthenticationError();
  }

  const { data, error } = await client
    .from("applications")
    .select(
      "id, created_at, applicant_display_name, applicant_phone, evaluation_snapshot, application_answers(field, value), application_photos(id, content_type, byte_size), attendance_events(id, party, event_type, occurred_at, related_event_id, resolution)",
    )
    .eq("opportunity_id", opportunityId)
    .eq("submission_state", "submitted")
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });
  if (error !== null) {
    throw new Error(`Could not load applications: ${error.message}`);
  }

  return (data as RecruiterApplicationRow[])
    .map(parseRecruiterApplication)
    .sort(compareApplications);
}

function compareApplications(
  left: RecruiterApplication,
  right: RecruiterApplication,
): number {
  const timeOrder = left.createdAt.localeCompare(right.createdAt);
  return timeOrder === 0 ? left.id.localeCompare(right.id) : timeOrder;
}

function validatePhoto(file: File): void {
  if (!ALLOWED_CONTENT_TYPES.has(file.type)) {
    throw new Error("Choose a JPEG, PNG, HEIC, or HEIF photo.");
  }
  if (file.size <= 0 || file.size > MAX_PHOTO_BYTES) {
    throw new Error("Choose a photo no larger than 10 MiB.");
  }
}

function isUploadGrant(value: unknown): value is {
  uploadUrl: string;
  storagePath: string;
  expiresAt: string;
} {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const grant = value as Record<string, unknown>;
  return (
    typeof grant.uploadUrl === "string" &&
    typeof grant.storagePath === "string" &&
    typeof grant.expiresAt === "string"
  );
}

interface PhotoUploadResult {
  applicationId: string;
  photoId: string;
  submissionState: "submitted";
}

function isPhotoUploadResult(value: unknown): value is PhotoUploadResult {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { applicationId?: unknown }).applicationId === "string" &&
    typeof (value as { photoId?: unknown }).photoId === "string" &&
    (value as { submissionState?: unknown }).submissionState === "submitted"
  );
}

function isApplicationPhotoStatus(
  value: unknown,
  expectedApplicationId: string,
): value is ApplicationPhotoStatus {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const status = value as Record<string, unknown>;
  if (status.status === "pending" || status.status === "unavailable") {
    return Object.keys(status).length === 1;
  }
  return (
    status.status === "submitted" &&
    Object.keys(status).length === 3 &&
    status.applicationId === expectedApplicationId &&
    typeof status.photoId === "string" &&
    uuidPattern.test(status.photoId)
  );
}

function parseRecruiterApplication(
  row: RecruiterApplicationRow,
): RecruiterApplication {
  if (!isEvaluationResult(row.evaluation_snapshot)) {
    throw new Error("An application has invalid evaluation evidence.");
  }
  return {
    id: row.id,
    createdAt: row.created_at,
    applicantDisplayName: row.applicant_display_name ?? "Deleted applicant",
    applicantPhone: row.applicant_phone ?? "Contact removed",
    evaluation: row.evaluation_snapshot,
    answers: row.application_answers.map((answer) => ({
      field: answer.field,
      value: parseAnswerValue(answer.value),
    })),
    photos: row.application_photos.map((photo) => ({
      id: photo.id,
      contentType: photo.content_type,
      byteSize: photo.byte_size,
    })),
    attendance: row.attendance_events
      .map((event) => ({
        id: event.id,
        party: parseParty(event.party),
        eventType: parseEventType(event.event_type),
        occurredAt: event.occurred_at,
        ...(event.related_event_id === null
          ? {}
          : { relatedEventId: event.related_event_id }),
        ...(event.resolution === null
          ? {}
          : { resolution: parseResolution(event.resolution) }),
      }))
      .sort(
        (left, right) =>
          left.occurredAt.localeCompare(right.occurredAt) ||
          left.id.localeCompare(right.id),
      ),
  };
}

function parseAnswerValue(value: unknown): AnswerValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  throw new Error("An application answer is invalid.");
}

function parseParty(value: string): "recruiter" | "applicant" {
  if (value === "recruiter" || value === "applicant") {
    return value;
  }
  throw new Error("An attendance party is invalid.");
}

function parseEventType(value: string): AttendanceEventType {
  const eventTypes = new Set<AttendanceEventType>([
    "recruiter_confirmed",
    "applicant_confirmed",
    "completed",
    "recruiter_cancelled",
    "applicant_cancelled",
    "recruiter_no_show",
    "applicant_no_show",
    "dispute_opened",
    "dispute_resolved",
  ]);
  if (eventTypes.has(value as AttendanceEventType))
    return value as AttendanceEventType;
  throw new Error("An attendance event is invalid.");
}

function parseResolution(value: string): AttendanceResolution {
  if (value === "confirmed" || value === "rejected") return value;
  throw new Error("An attendance resolution is invalid.");
}
