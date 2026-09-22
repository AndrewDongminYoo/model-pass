import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const BUCKET_ID = "application-photos";
const VIEW_LIFETIME_SECONDS = 600;
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface PhotoViewDependencies {
  authenticate: (accessToken: string) => Promise<string | null>;
  loadOwnedPhoto: (
    recruiterId: string,
    applicationId: string,
    photoId: string,
  ) => Promise<{ storagePath: string } | null>;
  createSignedViewUrl: (
    storagePath: string,
    expiresIn: number,
  ) => Promise<string>;
}

interface PhotoRow {
  storage_path: string;
}

interface ApplicationRow {
  opportunity_id: string;
}

const corsHeaders = {
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Origin": "*",
  "Content-Type": "application/json",
};

class PhotoViewError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "PhotoViewError";
  }
}

export function createPhotoViewHandler(dependencies: PhotoViewDependencies) {
  return async (request: Request): Promise<Response> => {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }
    if (request.method !== "POST") {
      return jsonResponse({ error: "Method not allowed." }, 405);
    }

    try {
      const token = readBearerToken(request.headers.get("Authorization"));
      if (token === null) {
        throw new PhotoViewError("Authentication is required.", 401);
      }
      const recruiterId = await dependencies.authenticate(token);
      if (recruiterId === null) {
        throw new PhotoViewError("Authentication is required.", 401);
      }
      const { applicationId, photoId } = parseInput(await request.json());
      const photo = await dependencies.loadOwnedPhoto(
        recruiterId,
        applicationId,
        photoId,
      );
      if (photo === null) {
        throw new PhotoViewError("Photo not found.", 404);
      }
      const viewUrl = await dependencies.createSignedViewUrl(
        photo.storagePath,
        VIEW_LIFETIME_SECONDS,
      );
      return jsonResponse({ viewUrl, expiresIn: VIEW_LIFETIME_SECONDS }, 200);
    } catch (error) {
      if (error instanceof PhotoViewError) {
        return jsonResponse({ error: error.message }, error.status);
      }
      if (error instanceof SyntaxError) {
        return jsonResponse({ error: "Invalid photo view request." }, 400);
      }

      console.error(error);
      return jsonResponse({ error: "Unable to open the photo." }, 500);
    }
  };
}

function readBearerToken(header: string | null): string | null {
  const match = /^Bearer (\S+)$/.exec(header ?? "");
  return match?.[1] ?? null;
}

function parseInput(input: unknown): {
  applicationId: string;
  photoId: string;
} {
  if (typeof input !== "object" || input === null) {
    throw new PhotoViewError("Invalid photo view request.", 400);
  }
  const { applicationId, photoId } = input as Record<string, unknown>;
  if (
    typeof applicationId !== "string" ||
    !uuidPattern.test(applicationId) ||
    typeof photoId !== "string" ||
    !uuidPattern.test(photoId)
  ) {
    throw new PhotoViewError("Invalid photo view request.", 400);
  }
  return { applicationId, photoId };
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}

export function createSupabaseDependencies(
  client: SupabaseClient,
): PhotoViewDependencies {
  return {
    async authenticate(accessToken) {
      const { data, error } = await client.auth.getUser(accessToken);
      if (error !== null || data.user === null) {
        return null;
      }
      return data.user.id;
    },
    async loadOwnedPhoto(recruiterId, applicationId, photoId) {
      const { data: photo, error: photoError } = await client
        .from("application_photos")
        .select("storage_path")
        .eq("id", photoId)
        .eq("application_id", applicationId)
        .maybeSingle<PhotoRow>();
      if (photoError !== null) {
        throw new Error(`Failed to load photo: ${photoError.message}`);
      }
      if (photo === null) {
        return null;
      }

      const { data: application, error: applicationError } = await client
        .from("applications")
        .select("opportunity_id")
        .eq("id", applicationId)
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
        .select("id")
        .eq("id", application.opportunity_id)
        .eq("recruiter_id", recruiterId)
        .maybeSingle<{ id: string }>();
      if (opportunityError !== null) {
        throw new Error(
          `Failed to verify photo owner: ${opportunityError.message}`,
        );
      }
      return opportunity === null ? null : { storagePath: photo.storage_path };
    },
    async createSignedViewUrl(storagePath, expiresIn) {
      const { data, error } = await client.storage
        .from(BUCKET_ID)
        .createSignedUrl(storagePath, expiresIn);
      if (error !== null) {
        throw new Error(`Failed to sign photo URL: ${error.message}`);
      }
      return data.signedUrl;
    },
  };
}

if (import.meta.main) {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (supabaseUrl === undefined || serviceRoleKey === undefined) {
    throw new Error("Photo view server environment is not configured.");
  }

  const client = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });
  Deno.serve(createPhotoViewHandler(createSupabaseDependencies(client)));
}
