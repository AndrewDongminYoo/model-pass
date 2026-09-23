import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { hashAnonymousRequestSource } from "../_shared/anonymous-quota.ts";
import {
  ImageMagick,
  initializeImageMagick,
  MagickFormat,
} from "@imagemagick/magick-wasm";
import { isEvaluationResult } from "../../../src/features/applications/domain/application.ts";
import { parseRuleDefinitions } from "../../../src/features/eligibility/domain/types.ts";

const BUCKET_ID = "application-photos";
const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
const MAX_GRANT_BODY_BYTES = 4 * 1024;
const UPLOAD_LIFETIME_SECONDS = 600;
const DOCUMENTED_SIGNING_SECRET_PLACEHOLDER =
  "replace-with-at-least-32-random-bytes";
const ALLOWED_CONTENT_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/heic",
  "image/heif",
]);
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
let imageMagickReady: Promise<void> | undefined;

export interface PhotoApplication {
  applicationId: string;
  opportunityId: string;
  submissionAttemptId: string;
  closesAt: string;
  closedAt: string | null;
  status: string;
  photoRequired: boolean;
  submissionState: "pending_photo" | "submitted";
}

interface PhotoApplicationLookup {
  applicationId: string;
  opportunityId: string;
  submissionAttemptId: string;
}

export interface PhotoMetadata {
  id: string;
  applicationId: string;
  storagePath: string;
  contentType: string;
  byteSize: number;
}

export type PhotoUploadReservation = PhotoMetadata;

export interface PhotoUploadResult {
  applicationId: string;
  photoId: string;
  submissionState: "submitted";
}

export interface PhotoUploadDependencies {
  now: () => Date;
  createPhotoId: () => string;
  signingSecret: string;
  consumeQuota: (opportunityId: string, sourceHash: string) => Promise<boolean>;
  sanitizePhoto: (body: Uint8Array, contentType: string) => Promise<Uint8Array>;
  loadApplication: (
    input: PhotoApplicationLookup,
  ) => Promise<PhotoApplication | null>;
  reserveUpload: (reservation: PhotoUploadReservation) => Promise<void>;
  uploadObject: (
    path: string,
    body: Uint8Array,
    contentType: string,
    options: { upsert: false },
  ) => Promise<void>;
  finalizeUpload: (
    metadata: PhotoMetadata,
    tuple: PhotoApplicationLookup,
  ) => Promise<PhotoUploadResult>;
  removeObject: (path: string) => Promise<void>;
  releaseReservation: (storagePath: string) => Promise<void>;
  loadCompletedPhoto: (
    input: PhotoApplicationLookup,
  ) => Promise<PhotoUploadResult | null>;
  reportError: (message: string, error: unknown) => void;
}

interface UploadGrantInput extends PhotoApplicationLookup {
  contentType: string;
  byteSize: number;
}

interface UploadClaims extends UploadGrantInput {
  photoId: string;
  storagePath: string;
  expiresAtSeconds: number;
}

interface ApplicationRow {
  id: string;
  opportunity_id: string;
  submission_attempt_id: string;
  submission_state: string;
  rules_snapshot: unknown;
  evaluation_snapshot: unknown;
}

interface PhotoRow {
  id: string;
  application_id: string;
}

interface OpportunityRow {
  closes_at: string;
  closed_at: string | null;
  status: string;
}

const corsHeaders = {
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-photo-storage-path",
  "Access-Control-Allow-Methods": "POST, PUT, OPTIONS",
  "Access-Control-Allow-Origin": "*",
  "Content-Type": "application/json",
};

export class PhotoUploadError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "PhotoUploadError";
  }
}

export class PhotoFinalizationRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PhotoFinalizationRejectedError";
  }
}

export function createPhotoUploadHandler(
  dependencies: PhotoUploadDependencies,
  fixedFunctionUrl?: string,
) {
  return async (request: Request): Promise<Response> => {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    try {
      if (request.method === "POST") {
        const functionUrl = fixedFunctionUrl ?? baseRequestUrl(request.url);
        const requestBody = await readBoundedJson(
          request,
          MAX_GRANT_BODY_BYTES,
        );
        if (isStatusAction(requestBody)) {
          const input = parseApplicationLookup(requestBody);
          const application = await dependencies.loadApplication(input);
          if (application === null || !application.photoRequired) {
            return jsonResponse({ status: "unavailable" }, 200);
          }
          if (application.submissionState === "submitted") {
            const completed = await dependencies.loadCompletedPhoto(input);
            if (
              completed !== null &&
              completed.applicationId === input.applicationId
            ) {
              return jsonResponse(
                {
                  status: "submitted",
                  applicationId: completed.applicationId,
                  photoId: completed.photoId,
                },
                200,
              );
            }
            return jsonResponse({ status: "unavailable" }, 200);
          }
          if (!isUploadWindowOpen(application, dependencies.now())) {
            return jsonResponse({ status: "unavailable" }, 200);
          }
          return jsonResponse({ status: "pending" }, 200);
        }

        const input = parseGrantInput(requestBody);
        const application = await dependencies.loadApplication(input);
        if (application === null) {
          throw new PhotoUploadError("Application not found.", 404);
        }
        assertPhotoRequired(application);
        if (application.submissionState === "submitted") {
          const completed = await dependencies.loadCompletedPhoto(input);
          if (completed !== null) {
            return jsonResponse(completed, 200);
          }
          throw new PhotoUploadError(
            "This application does not accept a photo upload.",
            409,
          );
        }
        assertUploadWindowOpen(application, dependencies.now());

        const sourceHash = await hashAnonymousRequestSource(
          request,
          dependencies.signingSecret,
        );
        if (sourceHash === null) {
          throw new PhotoUploadError("Request source is unavailable.", 503);
        }
        if (
          !(await dependencies.consumeQuota(
            application.opportunityId,
            sourceHash,
          ))
        ) {
          throw new PhotoUploadError(
            "Too many photo upload requests. Please try again later.",
            429,
          );
        }

        const photoId = dependencies.createPhotoId();
        const storagePath =
          `opportunity/${application.opportunityId}` +
          `/application/${application.applicationId}/${photoId}`;
        const expiresAtSeconds =
          Math.floor(dependencies.now().getTime() / 1_000) +
          UPLOAD_LIFETIME_SECONDS;
        const claims: UploadClaims = {
          ...input,
          photoId,
          storagePath,
          expiresAtSeconds,
        };
        const token = await signClaims(claims, dependencies.signingSecret);
        const uploadUrl = new URL(functionUrl);
        uploadUrl.searchParams.set("token", token);
        uploadUrl.searchParams.set("path", storagePath);

        return jsonResponse(
          {
            uploadUrl: uploadUrl.toString(),
            storagePath,
            expiresAt: new Date(expiresAtSeconds * 1_000).toISOString(),
          },
          200,
        );
      }

      if (request.method === "PUT") {
        const requestUrl = new URL(request.url);
        const token = requestUrl.searchParams.get("token");
        if (token === null) {
          throw new PhotoUploadError("Invalid upload grant.", 401);
        }
        const claims = await verifyClaims(
          token,
          dependencies.signingSecret,
          dependencies.now(),
        );
        if (
          requestUrl.searchParams.get("path") !== claims.storagePath ||
          request.headers.get("X-Photo-Storage-Path") !== claims.storagePath
        ) {
          throw new PhotoUploadError(
            "Upload path does not match the grant.",
            403,
          );
        }
        if (request.headers.get("Content-Type") !== claims.contentType) {
          throw new PhotoUploadError(
            "Photo content type does not match the grant.",
            415,
          );
        }

        validateContentLength(
          request.headers.get("Content-Length"),
          claims.byteSize,
          claims.byteSize,
        );
        const application = await dependencies.loadApplication(claims);
        if (application === null) {
          throw new PhotoUploadError("Application not found.", 404);
        }
        assertPhotoRequired(application);
        assertPhotoPending(application);
        assertUploadWindowOpen(application, dependencies.now());

        const body = await readBoundedBytes(request, claims.byteSize);
        if (body.byteLength !== claims.byteSize) {
          throw new PhotoUploadError(
            "Photo size does not match the grant.",
            413,
          );
        }

        const sanitizedBody = await dependencies.sanitizePhoto(
          body,
          claims.contentType,
        );

        const reservation: PhotoUploadReservation = {
          id: claims.photoId,
          applicationId: claims.applicationId,
          storagePath: claims.storagePath,
          contentType: "image/jpeg",
          byteSize: sanitizedBody.byteLength,
        };
        await dependencies.reserveUpload(reservation);

        try {
          await dependencies.uploadObject(
            claims.storagePath,
            sanitizedBody,
            reservation.contentType,
            { upsert: false },
          );
        } catch (error) {
          await releaseReservationAfterFailure(
            dependencies,
            claims.storagePath,
          );
          throw error;
        }

        let metadata: PhotoMetadata;
        try {
          const currentApplication = await dependencies.loadApplication(claims);
          if (currentApplication === null) {
            throw new PhotoUploadError("Application not found.", 404);
          }
          assertPhotoRequired(currentApplication);
          assertUploadWindowOpen(currentApplication, dependencies.now());
          metadata = reservation;
        } catch (preFinalizationError) {
          await compensateUploadFailure(dependencies, claims.storagePath);
          throw preFinalizationError;
        }

        try {
          const result = assertExactFinalizationResult(
            await dependencies.finalizeUpload(metadata, claims),
            metadata,
          );
          return jsonResponse(result, 201);
        } catch (firstError) {
          if (firstError instanceof PhotoFinalizationRejectedError) {
            await compensateUploadFailure(dependencies, claims.storagePath);
            throw firstError;
          }

          try {
            const result = assertExactFinalizationResult(
              await dependencies.finalizeUpload(metadata, claims),
              metadata,
            );
            return jsonResponse(result, 201);
          } catch (retryError) {
            if (retryError instanceof PhotoFinalizationRejectedError) {
              await compensateUploadFailure(dependencies, claims.storagePath);
              throw retryError;
            }
            dependencies.reportError(
              "Photo finalization remained ambiguous after retry.",
              { firstError, retryError },
            );
            throw new PhotoUploadError(
              "Unable to verify the photo upload result.",
              500,
            );
          }
        }
      }

      return jsonResponse({ error: "Method not allowed." }, 405);
    } catch (error) {
      if (error instanceof PhotoUploadError) {
        return jsonResponse({ error: error.message }, error.status);
      }
      if (error instanceof SyntaxError) {
        return jsonResponse({ error: "Invalid photo upload request." }, 400);
      }

      dependencies.reportError("Photo upload failed.", error);
      return jsonResponse({ error: "Unable to upload the photo." }, 500);
    }
  };
}

function parseGrantInput(input: unknown): UploadGrantInput {
  if (typeof input !== "object" || input === null) {
    throw new PhotoUploadError("Invalid photo upload request.", 400);
  }
  const value = input as Partial<Record<keyof UploadGrantInput, unknown>>;
  for (const field of [
    "applicationId",
    "opportunityId",
    "submissionAttemptId",
  ] as const) {
    if (typeof value[field] !== "string" || !uuidPattern.test(value[field])) {
      throw new PhotoUploadError("Invalid photo upload request.", 400);
    }
  }
  if (
    typeof value.contentType !== "string" ||
    !ALLOWED_CONTENT_TYPES.has(value.contentType)
  ) {
    throw new PhotoUploadError("Photo type is not supported.", 415);
  }
  if (
    typeof value.byteSize !== "number" ||
    !Number.isSafeInteger(value.byteSize) ||
    value.byteSize <= 0
  ) {
    throw new PhotoUploadError("Invalid photo upload request.", 400);
  }
  if (value.byteSize > MAX_PHOTO_BYTES) {
    throw new PhotoUploadError("Photo exceeds the 10 MiB limit.", 413);
  }

  return value as UploadGrantInput;
}

function isStatusAction(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { action?: unknown }).action === "status"
  );
}

function parseApplicationLookup(input: unknown): PhotoApplicationLookup {
  if (typeof input !== "object" || input === null) {
    throw new PhotoUploadError("Invalid photo upload request.", 400);
  }
  const value = input as Partial<Record<keyof PhotoApplicationLookup, unknown>>;
  for (const field of [
    "applicationId",
    "opportunityId",
    "submissionAttemptId",
  ] as const) {
    if (typeof value[field] !== "string" || !uuidPattern.test(value[field])) {
      throw new PhotoUploadError("Invalid photo upload request.", 400);
    }
  }
  return value as PhotoApplicationLookup;
}

function assertExactFinalizationResult(
  result: PhotoUploadResult,
  metadata: PhotoMetadata,
): PhotoUploadResult {
  if (
    result.applicationId !== metadata.applicationId ||
    result.photoId !== metadata.id ||
    result.submissionState !== "submitted"
  ) {
    throw new Error("Photo finalization returned a mismatched result.");
  }
  return result;
}

async function signClaims(
  claims: UploadClaims,
  secret: string,
): Promise<string> {
  const payload = encodeBase64Url(
    new TextEncoder().encode(JSON.stringify(claims)),
  );
  const signature = await hmac(payload, secret);
  return `${payload}.${encodeBase64Url(signature)}`;
}

async function verifyClaims(
  token: string,
  secret: string,
  now: Date,
): Promise<UploadClaims> {
  const [payload, encodedSignature, extra] = token.split(".");
  if (
    payload === undefined ||
    encodedSignature === undefined ||
    extra !== undefined
  ) {
    throw new PhotoUploadError("Invalid upload grant.", 401);
  }

  try {
    const expectedSignature = await hmac(payload, secret);
    const actualSignature = decodeBase64Url(encodedSignature);
    if (!constantTimeEqual(actualSignature, expectedSignature)) {
      throw new PhotoUploadError("Invalid upload grant.", 401);
    }
    const parsed: unknown = JSON.parse(
      new TextDecoder().decode(decodeBase64Url(payload)),
    );
    const claims = parseClaims(parsed);
    if (claims.expiresAtSeconds <= Math.floor(now.getTime() / 1_000)) {
      throw new PhotoUploadError("Upload grant expired.", 401);
    }
    return claims;
  } catch (error) {
    if (error instanceof PhotoUploadError) {
      throw error;
    }
    throw new PhotoUploadError("Invalid upload grant.", 401);
  }
}

function parseClaims(value: unknown): UploadClaims {
  const input = parseGrantInput(value);
  const claims = value as UploadClaims;
  if (
    typeof claims.photoId !== "string" ||
    !uuidPattern.test(claims.photoId) ||
    typeof claims.storagePath !== "string" ||
    claims.storagePath !==
      `opportunity/${input.opportunityId}/application/${input.applicationId}/${claims.photoId}` ||
    typeof claims.expiresAtSeconds !== "number" ||
    !Number.isSafeInteger(claims.expiresAtSeconds)
  ) {
    throw new PhotoUploadError("Invalid upload grant.", 401);
  }
  return claims;
}

export function validatePhotoUploadSigningSecret(
  secret: string | undefined,
): string {
  if (
    secret === undefined ||
    secret === DOCUMENTED_SIGNING_SECRET_PLACEHOLDER ||
    new TextEncoder().encode(secret).byteLength < 32
  ) {
    throw new Error(
      "PHOTO_UPLOAD_SIGNING_SECRET must contain at least 32 random UTF-8 bytes and must not use the documented placeholder.",
    );
  }
  return secret;
}

function assertUploadWindowOpen(
  application: PhotoApplication,
  now: Date,
): void {
  if (
    application.status !== "published" ||
    application.closedAt !== null ||
    Date.parse(application.closesAt) <= now.getTime()
  ) {
    throw new PhotoUploadError("Photo uploads are closed.", 409);
  }
}

function isUploadWindowOpen(application: PhotoApplication, now: Date): boolean {
  return (
    application.status === "published" &&
    application.closedAt === null &&
    Date.parse(application.closesAt) > now.getTime()
  );
}

function assertPhotoRequired(application: PhotoApplication): void {
  if (!application.photoRequired) {
    throw new PhotoUploadError(
      "This application does not require a photo.",
      409,
    );
  }
}

function assertPhotoPending(application: PhotoApplication): void {
  if (application.submissionState !== "pending_photo") {
    throw new PhotoUploadError(
      "This application does not accept a photo upload.",
      409,
    );
  }
}

async function readBoundedJson(
  request: Request,
  maximumBytes: number,
): Promise<unknown> {
  validateContentLength(request.headers.get("Content-Length"), maximumBytes);
  const bytes = await readBoundedBytes(request, maximumBytes);
  return JSON.parse(new TextDecoder().decode(bytes));
}

function validateContentLength(
  header: string | null,
  maximumBytes: number,
  exactBytes?: number,
): void {
  if (header === null) {
    return;
  }
  if (!/^(0|[1-9][0-9]*)$/.test(header)) {
    throw new PhotoUploadError("Invalid Content-Length header.", 400);
  }
  const length = Number(header);
  if (
    length > maximumBytes ||
    (exactBytes !== undefined && length !== exactBytes)
  ) {
    throw new PhotoUploadError("Request body exceeds its allowed size.", 413);
  }
}

async function readBoundedBytes(
  request: Request,
  maximumBytes: number,
): Promise<Uint8Array> {
  if (request.body === null) {
    return new Uint8Array();
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
    if (totalBytes > maximumBytes) {
      await reader.cancel();
      throw new PhotoUploadError("Request body exceeds its allowed size.", 413);
    }
    chunks.push(value);
  }

  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

async function releaseReservationAfterFailure(
  dependencies: PhotoUploadDependencies,
  storagePath: string,
): Promise<void> {
  try {
    await dependencies.releaseReservation(storagePath);
  } catch (error) {
    dependencies.reportError("Photo upload reservation cleanup failed.", error);
  }
}

async function compensateUploadFailure(
  dependencies: PhotoUploadDependencies,
  storagePath: string,
): Promise<void> {
  try {
    await dependencies.removeObject(storagePath);
    await releaseReservationAfterFailure(dependencies, storagePath);
  } catch (error) {
    dependencies.reportError("Photo upload compensation failed.", error);
  }
}

async function hmac(payload: string, secret: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload)),
  );
}

function constantTimeEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) {
    return false;
  }
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left[index] ^ right[index];
  }
  return difference === 0;
}

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

function decodeBase64Url(value: string): Uint8Array {
  const base64 = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function baseRequestUrl(requestUrl: string): string {
  const url = new URL(requestUrl);
  url.search = "";
  return url.toString();
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}

export async function sanitizeUploadedPhoto(
  body: Uint8Array,
  contentType: string,
): Promise<Uint8Array> {
  const jpeg =
    body.length >= 3 &&
    body[0] === 0xff &&
    body[1] === 0xd8 &&
    body[2] === 0xff;
  const png =
    body.length >= 8 &&
    [137, 80, 78, 71, 13, 10, 26, 10].every(
      (byte, index) => body[index] === byte,
    );
  const heif =
    body.length >= 12 &&
    new TextDecoder().decode(body.subarray(4, 8)) === "ftyp" &&
    ["heic", "heix", "hevc", "hevx", "mif1", "msf1"].includes(
      new TextDecoder().decode(body.subarray(8, 12)),
    );
  if (!(
    (contentType === "image/jpeg" && jpeg) ||
    (contentType === "image/png" && png) ||
    ((contentType === "image/heic" || contentType === "image/heif") && heif)
  )) {
    throw new PhotoUploadError("Photo content does not match its type.", 415);
  }

  imageMagickReady ??= Deno.readFile(
    new URL("./magick.wasm", import.meta.url),
  ).then(initializeImageMagick);
  await imageMagickReady;

  try {
    const output = ImageMagick.read(body, (image): Uint8Array => {
      const acceptedFormat =
        contentType === "image/jpeg"
          ? image.format === MagickFormat.Jpeg
          : contentType === "image/png"
            ? image.format === MagickFormat.Png
            : image.format === MagickFormat.Heic ||
              image.format === MagickFormat.Heif;
      if (!acceptedFormat || image.width * image.height > 16_000_000) {
        throw new PhotoUploadError(
          "Photo format or dimensions are invalid.",
          415,
        );
      }
      image.strip();
      image.quality = 85;
      return image.write(MagickFormat.Jpeg, (data) => Uint8Array.from(data));
    });
    if (output.length === 0 || output.length > MAX_PHOTO_BYTES) {
      throw new PhotoUploadError(
        "Re-encoded photo exceeds the size limit.",
        413,
      );
    }
    return output;
  } catch (error) {
    if (error instanceof PhotoUploadError) throw error;
    throw new PhotoUploadError("Photo could not be decoded.", 415);
  }
}

export function createSupabaseDependencies(
  client: SupabaseClient,
  signingSecret: string,
): PhotoUploadDependencies {
  const validatedSigningSecret =
    validatePhotoUploadSigningSecret(signingSecret);
  return {
    now: () => new Date(),
    createPhotoId: () => crypto.randomUUID(),
    signingSecret: validatedSigningSecret,
    sanitizePhoto: sanitizeUploadedPhoto,
    async consumeQuota(opportunityId, sourceHash) {
      const { data, error } = await client.rpc(
        "consume_anonymous_request_quota",
        {
          p_opportunity_id: opportunityId,
          p_action: "create_photo_upload",
          p_source_hash: sourceHash,
          p_limit: 20,
        },
      );
      if (error !== null || typeof data !== "boolean") {
        throw new Error("Failed to check anonymous photo grant quota.");
      }
      return data;
    },
    async loadApplication(input) {
      const { data: application, error: applicationError } = await client
        .from("applications")
        .select(
          "id, opportunity_id, submission_attempt_id, submission_state, rules_snapshot, evaluation_snapshot",
        )
        .eq("id", input.applicationId)
        .eq("opportunity_id", input.opportunityId)
        .eq("submission_attempt_id", input.submissionAttemptId)
        .maybeSingle<ApplicationRow>();
      if (applicationError !== null) {
        throw new Error(
          `Failed to load application: ${applicationError.message}`,
        );
      }
      if (application === null) {
        return null;
      }
      if (
        application.submission_state !== "pending_photo" &&
        application.submission_state !== "submitted"
      ) {
        throw new Error("Stored application submission state is invalid.");
      }
      const rules = parseRuleDefinitions(application.rules_snapshot);
      if (!isEvaluationResult(application.evaluation_snapshot)) {
        throw new Error("Stored application evaluation is invalid.");
      }
      const reviewRuleIds = new Set(
        rules
          .filter(
            (rule) =>
              rule.effect === "needs_review" &&
              rule.field.toLowerCase().includes("photo"),
          )
          .map((rule) => rule.id),
      );
      const photoRequired = application.evaluation_snapshot.reviews.some(
        (outcome) =>
          outcome.effect === "needs_review" &&
          reviewRuleIds.has(outcome.ruleId),
      );

      const { data: opportunity, error: opportunityError } = await client
        .from("opportunities")
        .select("closes_at, closed_at, status")
        .eq("id", application.opportunity_id)
        .maybeSingle<OpportunityRow>();
      if (opportunityError !== null) {
        throw new Error(
          `Failed to load opportunity: ${opportunityError.message}`,
        );
      }
      if (opportunity === null) {
        return null;
      }

      return {
        applicationId: application.id,
        opportunityId: application.opportunity_id,
        submissionAttemptId: application.submission_attempt_id,
        closesAt: opportunity.closes_at,
        closedAt: opportunity.closed_at,
        status: opportunity.status,
        photoRequired,
        submissionState: application.submission_state,
      };
    },
    async reserveUpload(reservation) {
      const { error } = await client
        .from("application_photo_upload_reservations")
        .insert({
          id: reservation.id,
          application_id: reservation.applicationId,
          storage_path: reservation.storagePath,
          content_type: reservation.contentType,
          byte_size: reservation.byteSize,
        });
      if (error !== null) {
        if (error.code === "23505") {
          throw new PhotoUploadError(
            "This photo upload was already used.",
            409,
          );
        }
        throw new Error(`Failed to reserve photo upload: ${error.message}`);
      }
    },
    async uploadObject(path, body, contentType, options) {
      const { error } = await client.storage
        .from(BUCKET_ID)
        .upload(path, body, { contentType, upsert: options.upsert });
      if (error !== null) {
        if (error.message.toLowerCase().includes("already exists")) {
          throw new PhotoUploadError("This photo was already uploaded.", 409);
        }
        throw new Error(`Failed to store photo: ${error.message}`);
      }
    },
    async finalizeUpload(metadata, tuple) {
      const { data, error, status } = await client.rpc(
        "finalize_application_photo",
        {
          p_photo_id: metadata.id,
          p_application_id: metadata.applicationId,
          p_opportunity_id: tuple.opportunityId,
          p_submission_attempt_id: tuple.submissionAttemptId,
          p_storage_path: metadata.storagePath,
          p_content_type: metadata.contentType,
          p_byte_size: metadata.byteSize,
        },
      );
      if (error !== null) {
        const errorCode =
          typeof error.code === "string" ? error.code.trim() : "";
        if (status >= 400 && status < 500 && errorCode.length > 0) {
          throw new PhotoFinalizationRejectedError(
            `Failed to finalize photo upload: ${error.message}`,
          );
        }
        throw new Error(
          `Photo finalization outcome is ambiguous: ${error.message}`,
        );
      }
      if (
        typeof data !== "object" ||
        data === null ||
        (data as { applicationId?: unknown }).applicationId !==
          metadata.applicationId ||
        (data as { photoId?: unknown }).photoId !== metadata.id ||
        (data as { submissionState?: unknown }).submissionState !== "submitted"
      ) {
        throw new Error("Photo finalization returned an invalid result.");
      }
      return data as PhotoUploadResult;
    },
    async removeObject(path) {
      const { error } = await client.storage.from(BUCKET_ID).remove([path]);
      if (error !== null) {
        throw new Error(`Failed to remove photo: ${error.message}`);
      }
    },
    async releaseReservation(storagePath) {
      const { error } = await client
        .from("application_photo_upload_reservations")
        .delete()
        .eq("storage_path", storagePath);
      if (error !== null) {
        throw new Error(`Failed to release photo upload: ${error.message}`);
      }
    },
    async loadCompletedPhoto(input) {
      const { data, error } = await client
        .from("application_photos")
        .select("id, application_id")
        .eq("application_id", input.applicationId)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle<PhotoRow>();
      if (error !== null) {
        throw new Error(`Failed to load completed photo: ${error.message}`);
      }
      return data === null
        ? null
        : {
            applicationId: data.application_id,
            photoId: data.id,
            submissionState: "submitted",
          };
    },
    reportError(message, error) {
      console.error(message, error);
    },
  };
}

if (import.meta.main) {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const signingSecret = validatePhotoUploadSigningSecret(
    Deno.env.get("PHOTO_UPLOAD_SIGNING_SECRET"),
  );
  if (
    supabaseUrl === undefined ||
    serviceRoleKey === undefined ||
    signingSecret === undefined
  ) {
    throw new Error("Photo upload server environment is not configured.");
  }

  const client = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });
  Deno.serve(
    createPhotoUploadHandler(createSupabaseDependencies(client, signingSecret)),
  );
}
