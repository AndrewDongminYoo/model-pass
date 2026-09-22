import { execFileSync } from "node:child_process";

export interface LocalSupabaseEnvironment {
  apiUrl: string;
  anonKey: string;
  serviceRoleKey: string;
}

export type LocalSupabasePublicEnvironment = Omit<
  LocalSupabaseEnvironment,
  "serviceRoleKey"
>;

export function resolveLocalSupabasePublicEnvironment(): LocalSupabasePublicEnvironment {
  const values = readLocalSupabaseStatus();
  if (
    typeof values.API_URL !== "string" ||
    typeof values.ANON_KEY !== "string"
  ) {
    throw unavailableError();
  }
  return { apiUrl: values.API_URL, anonKey: values.ANON_KEY };
}

export function resolveLocalSupabaseEnvironment(): LocalSupabaseEnvironment {
  const values = readLocalSupabaseStatus();
  if (
    typeof values.API_URL !== "string" ||
    typeof values.ANON_KEY !== "string" ||
    typeof values.SERVICE_ROLE_KEY !== "string"
  ) {
    throw unavailableError();
  }
  return {
    apiUrl: values.API_URL,
    anonKey: values.ANON_KEY,
    serviceRoleKey: values.SERVICE_ROLE_KEY,
  };
}

function readLocalSupabaseStatus(): Record<string, unknown> {
  try {
    const output = execFileSync("supabase", ["status", "-o", "json"], {
      cwd: process.cwd(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    const status: unknown = JSON.parse(output);
    if (typeof status !== "object" || status === null) {
      throw new Error("Invalid local Supabase status.");
    }
    return status as Record<string, unknown>;
  } catch {
    throw unavailableError();
  }
}

function unavailableError(): Error {
  return new Error(
    "Local Supabase is unavailable. Run `supabase db reset` before `pnpm test:e2e`.",
  );
}
