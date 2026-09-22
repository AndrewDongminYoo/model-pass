import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const BUCKET_ID = "application-photos";
const MAX_BODY_BYTES = 1024;

export interface CleanupPhoto {
  id: string;
  storagePath: string;
  expiresAt: string;
  held: boolean;
}

export interface StaleReservation {
  id: string;
  applicationId: string;
  storagePath: string;
  metadataExists: boolean;
}

export interface CleanupDependencies {
  now: () => Date;
  createInvocationId: () => string;
  authorize: (accessToken: string | null) => Promise<boolean>;
  listExpiredPhotos: (now: string) => Promise<CleanupPhoto[]>;
  listStaleReservations: (now: string) => Promise<StaleReservation[]>;
  claimPhoto: (input: {
    id: string;
    invocationId: string;
    claimedAt: string;
  }) => Promise<boolean>;
  removeObject: (storagePath: string) => Promise<void>;
  releasePhotoClaim: (input: {
    id: string;
    invocationId: string;
  }) => Promise<boolean>;
  finalizePhotoDeletion: (input: {
    id: string;
    invocationId: string;
    deletedAt: string;
    reason: "retention_expired";
  }) => Promise<boolean>;
  deleteReservation: (reservation: StaleReservation) => Promise<boolean>;
  countPendingDrafts: (now: string) => Promise<number>;
  deletePendingDrafts: (now: string) => Promise<number>;
  reportError: (message: string, error: unknown) => void;
}

interface CleanupResult {
  invocationId: string;
  dryRun: boolean;
  photos: { eligible: number; held: number; deleted: number; failed: number };
  reservations: {
    eligible: number;
    metadataMatched: number;
    orphansDeleted: number;
    failed: number;
  };
  pendingDrafts: { eligible: number; deleted: number };
}

class CleanupRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "CleanupRequestError";
  }
}

export async function cleanupExpiredPhotos(
  dryRun: boolean,
  dependencies: CleanupDependencies,
): Promise<CleanupResult> {
  const now = dependencies.now().toISOString();
  const invocationId = dependencies.createInvocationId();
  const photos = await dependencies.listExpiredPhotos(now);
  const reservations = await dependencies.listStaleReservations(now);
  const pendingDraftsEligible = await dependencies.countPendingDrafts(now);
  const result: CleanupResult = {
    invocationId,
    dryRun,
    photos: {
      eligible: photos.filter((photo) => !photo.held).length,
      held: photos.filter((photo) => photo.held).length,
      deleted: 0,
      failed: 0,
    },
    reservations: {
      eligible: reservations.length,
      metadataMatched: 0,
      orphansDeleted: 0,
      failed: 0,
    },
    pendingDrafts: { eligible: pendingDraftsEligible, deleted: 0 },
  };

  if (dryRun) return result;

  for (const photo of photos) {
    if (photo.held) continue;
    let claimed = false;
    let storageRemoved = false;
    try {
      claimed = await dependencies.claimPhoto({
        id: photo.id,
        invocationId,
        claimedAt: now,
      });
      if (!claimed) continue;
      await dependencies.removeObject(photo.storagePath);
      storageRemoved = true;
      const marked = await dependencies.finalizePhotoDeletion({
        id: photo.id,
        invocationId,
        deletedAt: now,
        reason: "retention_expired",
      });
      if (!marked) {
        throw new Error("Photo deletion metadata was not recorded.");
      }
      result.photos.deleted += 1;
    } catch (error) {
      if (claimed && !storageRemoved) {
        try {
          const released = await dependencies.releasePhotoClaim({
            id: photo.id,
            invocationId,
          });
          if (!released) {
            throw new Error("Photo cleanup claim was not released.", {
              cause: error,
            });
          }
        } catch (releaseError) {
          dependencies.reportError(
            `Photo cleanup claim release failed for ${photo.id}.`,
            releaseError,
          );
        }
      }
      result.photos.failed += 1;
      dependencies.reportError(`Photo cleanup failed for ${photo.id}.`, error);
    }
  }

  for (const reservation of reservations) {
    try {
      if (!reservation.metadataExists) {
        await dependencies.removeObject(reservation.storagePath);
      }
      const deleted = await dependencies.deleteReservation(reservation);
      if (!deleted) {
        throw new Error("Photo reservation was not removed.");
      }
      if (reservation.metadataExists) {
        result.reservations.metadataMatched += 1;
      } else {
        result.reservations.orphansDeleted += 1;
      }
    } catch (error) {
      result.reservations.failed += 1;
      dependencies.reportError(
        `Reservation cleanup failed for ${reservation.id}.`,
        error,
      );
    }
  }

  result.pendingDrafts.deleted = await dependencies.deletePendingDrafts(now);
  return result;
}

export function createCleanupExpiredPhotosHandler(
  dependencies: CleanupDependencies,
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
        throw new CleanupRequestError(
          "Operator authorization is required.",
          401,
        );
      }
      const body = await readBoundedJson(request);
      if (
        typeof body !== "object" ||
        body === null ||
        Array.isArray(body) ||
        Object.keys(body).some((key) => key !== "dryRun") ||
        typeof (body as { dryRun?: unknown }).dryRun !== "boolean"
      ) {
        throw new CleanupRequestError("Invalid cleanup request.", 400);
      }
      return jsonResponse(
        await cleanupExpiredPhotos(
          (body as { dryRun: boolean }).dryRun,
          dependencies,
        ),
        200,
      );
    } catch (error) {
      if (error instanceof CleanupRequestError) {
        return jsonResponse({ error: error.message }, error.status);
      }
      if (error instanceof SyntaxError) {
        return jsonResponse({ error: "Invalid cleanup request." }, 400);
      }
      dependencies.reportError("Cleanup invocation failed.", error);
      return jsonResponse({ error: "Cleanup invocation failed." }, 500);
    }
  };
}

function readBearerToken(header: string | null): string | null {
  return /^Bearer (\S+)$/.exec(header ?? "")?.[1] ?? null;
}

async function readBoundedJson(request: Request): Promise<unknown> {
  const contentLength = request.headers.get("Content-Length");
  if (contentLength !== null) {
    if (!/^(0|[1-9][0-9]*)$/.test(contentLength)) {
      throw new CleanupRequestError("Invalid Content-Length.", 400);
    }
    if (Number(contentLength) > MAX_BODY_BYTES) {
      throw new CleanupRequestError("Cleanup request is too large.", 413);
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
      throw new CleanupRequestError("Cleanup request is too large.", 413);
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
    throw new CleanupRequestError("Invalid cleanup request.", 400);
  }
  if (body.byteLength > MAX_BODY_BYTES) {
    throw new CleanupRequestError("Cleanup request is too large.", 413);
  }
  return JSON.parse(text) as unknown;
}

function jsonResponse(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

interface CleanupPhotoRow {
  id: string;
  storage_path: string;
  expires_at: string;
  held: boolean;
}

interface ReservationRow {
  id: string;
  application_id: string;
  storage_path: string;
  metadata_exists: boolean;
}

export function createSupabaseDependencies(
  client: SupabaseClient,
  serviceRoleKey: string,
): CleanupDependencies {
  return {
    now: () => new Date(),
    createInvocationId: () => crypto.randomUUID(),
    async authorize(accessToken) {
      if (
        accessToken !== null &&
        (await constantTimeEqual(accessToken, serviceRoleKey))
      )
        return true;
      if (accessToken === null) return false;
      const { data, error } = await client.auth.getUser(accessToken);
      return error === null && data.user?.app_metadata.role === "operator";
    },
    async listExpiredPhotos(now) {
      const { data, error } = await client.rpc(
        "list_expired_photo_cleanup_candidates",
        {
          p_now: now,
        },
      );
      if (error !== null) throw error;
      return ((data ?? []) as CleanupPhotoRow[]).map((row) => ({
        id: row.id,
        storagePath: row.storage_path,
        expiresAt: row.expires_at,
        held: row.held,
      }));
    },
    async listStaleReservations(now) {
      const { data, error } = await client.rpc(
        "list_stale_photo_reservations",
        {
          p_now: now,
        },
      );
      if (error !== null) throw error;
      return ((data ?? []) as ReservationRow[]).map((row) => ({
        id: row.id,
        applicationId: row.application_id,
        storagePath: row.storage_path,
        metadataExists: row.metadata_exists,
      }));
    },
    async claimPhoto(input) {
      const { data, error } = await client.rpc(
        "claim_application_photo_cleanup",
        {
          p_photo_id: input.id,
          p_invocation_id: input.invocationId,
          p_claimed_at: input.claimedAt,
        },
      );
      if (error !== null) throw error;
      return data === true;
    },
    async removeObject(storagePath) {
      const { error } = await client.storage
        .from(BUCKET_ID)
        .remove([storagePath]);
      if (error !== null) throw error;
    },
    async releasePhotoClaim(input) {
      const { data, error } = await client.rpc(
        "release_application_photo_cleanup_claim",
        {
          p_photo_id: input.id,
          p_invocation_id: input.invocationId,
        },
      );
      if (error !== null) throw error;
      return data === true;
    },
    async finalizePhotoDeletion(input) {
      const { data, error } = await client.rpc(
        "finalize_application_photo_cleanup",
        {
          p_photo_id: input.id,
          p_invocation_id: input.invocationId,
          p_deleted_at: input.deletedAt,
          p_reason: input.reason,
        },
      );
      if (error !== null) throw error;
      return data === true;
    },
    async deleteReservation(reservation) {
      const { data, error } = await client.rpc(
        "delete_reconciled_photo_reservation",
        {
          p_reservation_id: reservation.id,
          p_application_id: reservation.applicationId,
          p_storage_path: reservation.storagePath,
        },
      );
      if (error !== null) throw error;
      return data === true;
    },
    async countPendingDrafts(now) {
      const { data, error } = await client.rpc(
        "count_abandoned_pending_photo_drafts",
        { p_now: now },
      );
      if (error !== null) throw error;
      return Number(data);
    },
    async deletePendingDrafts(now) {
      const { data, error } = await client.rpc(
        "delete_abandoned_pending_photo_drafts",
        {
          p_now: now,
        },
      );
      if (error !== null) throw error;
      return Number(data);
    },
    reportError(message, error) {
      console.error(message, error);
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
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Cleanup server environment is not configured.");
  }
  const client = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });
  Deno.serve(
    createCleanupExpiredPhotosHandler(
      createSupabaseDependencies(client, serviceRoleKey),
    ),
  );
}
