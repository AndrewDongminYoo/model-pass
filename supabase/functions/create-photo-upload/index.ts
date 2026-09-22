import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const BUCKET_ID = "application-photos";
const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
const UPLOAD_LIFETIME_SECONDS = 600;
const RETENTION_DAYS = 30;
const ALLOWED_CONTENT_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/heic",
  "image/heif",
]);
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface PhotoApplication {
  applicationId: string;
  opportunityId: string;
  submissionAttemptId: string;
  closesAt: string;
  closedAt: string | null;
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
  expiresAt: string;
}

export interface PhotoUploadDependencies {
  now: () => Date;
  createPhotoId: () => string;
  signingSecret: string;
  loadApplication: (
    input: PhotoApplicationLookup,
  ) => Promise<PhotoApplication | null>;
  uploadObject: (
    path: string,
    body: Uint8Array,
    contentType: string,
    options: { upsert: false },
  ) => Promise<void>;
  insertMetadata: (metadata: PhotoMetadata) => Promise<void>;
  removeObject: (path: string) => Promise<void>;
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
  retentionExpiresAt: string;
}

interface ApplicationRow {
  id: string;
  opportunity_id: string;
  submission_attempt_id: string;
}

interface OpportunityRow {
  closes_at: string;
  closed_at: string | null;
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
        const input = parseGrantInput(await request.json());
        const application = await dependencies.loadApplication(input);
        if (application === null) {
          throw new PhotoUploadError("Application not found.", 404);
        }

        const photoId = dependencies.createPhotoId();
        const storagePath =
          `opportunity/${application.opportunityId}` +
          `/application/${application.applicationId}/${photoId}`;
        const expiresAtSeconds =
          Math.floor(dependencies.now().getTime() / 1_000) +
          UPLOAD_LIFETIME_SECONDS;
        const retentionBase = new Date(
          application.closedAt ?? application.closesAt,
        );
        const retentionExpiresAt = new Date(retentionBase);
        retentionExpiresAt.setUTCDate(
          retentionExpiresAt.getUTCDate() + RETENTION_DAYS,
        );
        const claims: UploadClaims = {
          ...input,
          photoId,
          storagePath,
          expiresAtSeconds,
          retentionExpiresAt: retentionExpiresAt.toISOString(),
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

        const contentLength = request.headers.get("Content-Length");
        if (
          contentLength !== null &&
          Number.parseInt(contentLength, 10) !== claims.byteSize
        ) {
          throw new PhotoUploadError(
            "Photo size does not match the grant.",
            413,
          );
        }
        const body = new Uint8Array(await request.arrayBuffer());
        if (
          body.byteLength !== claims.byteSize ||
          body.byteLength > MAX_PHOTO_BYTES
        ) {
          throw new PhotoUploadError(
            "Photo size does not match the grant.",
            413,
          );
        }

        await dependencies.uploadObject(
          claims.storagePath,
          body,
          claims.contentType,
          { upsert: false },
        );

        try {
          await dependencies.insertMetadata({
            id: claims.photoId,
            applicationId: claims.applicationId,
            storagePath: claims.storagePath,
            contentType: claims.contentType,
            byteSize: claims.byteSize,
            expiresAt: claims.retentionExpiresAt,
          });
        } catch (error) {
          try {
            await dependencies.removeObject(claims.storagePath);
          } catch (compensationError) {
            dependencies.reportError(
              "Photo upload compensation failed.",
              compensationError,
            );
          }
          throw error;
        }

        return jsonResponse({ photoId: claims.photoId }, 201);
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
    !Number.isSafeInteger(claims.expiresAtSeconds) ||
    typeof claims.retentionExpiresAt !== "string" ||
    !Number.isFinite(Date.parse(claims.retentionExpiresAt))
  ) {
    throw new PhotoUploadError("Invalid upload grant.", 401);
  }
  return claims;
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

export function createSupabaseDependencies(
  client: SupabaseClient,
  signingSecret: string,
): PhotoUploadDependencies {
  return {
    now: () => new Date(),
    createPhotoId: () => crypto.randomUUID(),
    signingSecret,
    async loadApplication(input) {
      const { data: application, error: applicationError } = await client
        .from("applications")
        .select("id, opportunity_id, submission_attempt_id")
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

      const { data: opportunity, error: opportunityError } = await client
        .from("opportunities")
        .select("closes_at, closed_at")
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
      };
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
    async insertMetadata(metadata) {
      const { error } = await client.from("application_photos").insert({
        id: metadata.id,
        application_id: metadata.applicationId,
        storage_path: metadata.storagePath,
        content_type: metadata.contentType,
        byte_size: metadata.byteSize,
        expires_at: metadata.expiresAt,
      });
      if (error !== null) {
        throw new Error(`Failed to record photo metadata: ${error.message}`);
      }
    },
    async removeObject(path) {
      const { error } = await client.storage.from(BUCKET_ID).remove([path]);
      if (error !== null) {
        throw new Error(`Failed to remove photo: ${error.message}`);
      }
    },
    reportError(message, error) {
      console.error(message, error);
    },
  };
}

if (import.meta.main) {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const signingSecret = Deno.env.get("PHOTO_UPLOAD_SIGNING_SECRET");
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
